import assert from "node:assert/strict";
import test from "node:test";
import {
  RasterRuntimeGuardError,
  createRasterRuntimeGuard,
  resolveRasterRuntimeGuardConfig,
  type RasterRuntimeTimer,
} from "./runtime-guard.js";

function controlledTimer(): Readonly<{
  timer: RasterRuntimeTimer;
  fire: () => void;
  cleared: () => boolean;
}> {
  let callback: (() => void) | null = null;
  let wasCleared = false;
  const handle = { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
  return Object.freeze({
    timer: Object.freeze({
      now: () => 1_700_000_000_000,
      setTimeout: (next) => {
        callback = next;
        return handle;
      },
      clearTimeout: () => {
        wasCleared = true;
        callback = null;
      },
    }),
    fire: () => callback?.(),
    cleared: () => wasCleared,
  });
}

test("resolves defaults and bounded environment-style values", () => {
  const defaults = resolveRasterRuntimeGuardConfig();
  assert.equal(defaults.timeoutMs, 45_000);
  assert.equal(defaults.maxConcurrent, 1);
  assert.equal(defaults.retryAfterSeconds, 5);

  const configured = resolveRasterRuntimeGuardConfig({
    timeoutMs: "12000",
    maxConcurrent: "2",
    retryAfterSeconds: "9",
  });
  assert.deepEqual(configured, { timeoutMs: 12_000, maxConcurrent: 2, retryAfterSeconds: 9 });
});

test("rejects invalid runtime configuration", () => {
  assert.throws(
    () => resolveRasterRuntimeGuardConfig({ maxConcurrent: "0" }),
    (error: unknown) => error instanceof RasterRuntimeGuardError && error.code === "RASTER_RUNTIME_CONFIG_INVALID",
  );
  assert.throws(
    () => resolveRasterRuntimeGuardConfig({ timeoutMs: "181000" }),
    (error: unknown) => error instanceof RasterRuntimeGuardError && error.code === "RASTER_RUNTIME_CONFIG_INVALID",
  );
});

test("rejects work above the concurrency ceiling and recovers after release", () => {
  const guard = createRasterRuntimeGuard({ timeoutMs: 10_000, maxConcurrent: 1, retryAfterSeconds: 7 });
  const first = guard.acquire();
  assert.equal(guard.snapshot().activeExecutions, 1);
  assert.throws(
    () => guard.acquire(),
    (error: unknown) =>
      error instanceof RasterRuntimeGuardError &&
      error.code === "RASTER_RUNTIME_BUSY" &&
      error.status === 429 &&
      error.retryAfterSeconds === 7,
  );

  first.release();
  first.release();
  assert.equal(guard.snapshot().activeExecutions, 0);
  const second = guard.acquire();
  second.release();
  assert.equal(guard.snapshot().activeExecutions, 0);
});

test("aborts at the execution timeout and releases the runtime slot", () => {
  const controlled = controlledTimer();
  const guard = createRasterRuntimeGuard(
    { timeoutMs: 5_000, maxConcurrent: 1, retryAfterSeconds: 1 },
    controlled.timer,
  );
  const lease = guard.acquire();
  assert.equal(lease.startedAt, 1_700_000_000_000);
  assert.equal(lease.signal.aborted, false);
  controlled.fire();
  assert.equal(lease.signal.aborted, true);
  assert.equal(lease.signal.reason instanceof DOMException, true);
  assert.equal((lease.signal.reason as DOMException).name, "TimeoutError");
  assert.equal(lease.timedOut(), true);
  lease.release();
  assert.equal(controlled.cleared(), true);
  assert.equal(guard.snapshot().activeExecutions, 0);
});

test("forwards request cancellation without later misclassifying it as a timeout", () => {
  const controlled = controlledTimer();
  const request = new AbortController();
  const guard = createRasterRuntimeGuard(
    { timeoutMs: 10_000, maxConcurrent: 1, retryAfterSeconds: 1 },
    controlled.timer,
  );
  const lease = guard.acquire(request.signal);
  request.abort(new DOMException("Client disconnected", "AbortError"));
  controlled.fire();
  assert.equal(lease.signal.aborted, true);
  assert.equal((lease.signal.reason as DOMException).name, "AbortError");
  assert.equal(lease.timedOut(), false);
  lease.release();
});
