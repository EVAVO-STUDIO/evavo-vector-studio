import assert from "node:assert/strict";
import test from "node:test";
import {
  RasterRuntimeGuardError,
  createRasterRuntimeGuard,
  resolveRasterRuntimeGuardConfig,
} from "./runtime-guard.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

test("aborts a lease at the configured execution timeout", async () => {
  const guard = createRasterRuntimeGuard({ timeoutMs: 5_000, maxConcurrent: 1, retryAfterSeconds: 1 });
  const lease = guard.acquire();
  const originalSetTimeout = globalThis.setTimeout;
  lease.release();

  const fastGuard = createRasterRuntimeGuard({ timeoutMs: 5_000, maxConcurrent: 1, retryAfterSeconds: 1 });
  const fastLease = fastGuard.acquire();
  const timeoutHandle = originalSetTimeout(() => undefined, 0);
  clearTimeout(timeoutHandle);
  assert.equal(fastLease.timedOut(), false);
  fastLease.release();
});

test("forwards request cancellation without marking a runtime timeout", () => {
  const request = new AbortController();
  const guard = createRasterRuntimeGuard({ timeoutMs: 10_000, maxConcurrent: 1, retryAfterSeconds: 1 });
  const lease = guard.acquire(request.signal);
  request.abort(new DOMException("Client disconnected", "AbortError"));
  assert.equal(lease.signal.aborted, true);
  assert.equal(lease.timedOut(), false);
  lease.release();
});

test("marks an actual timeout using a temporarily accelerated timer", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = new Map<object, () => void>();

  globalThis.setTimeout = ((callback: (...args: never[]) => void) => {
    const handle = { unref: () => handle };
    scheduled.set(handle, () => callback());
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    scheduled.delete(handle as unknown as object);
  }) as typeof clearTimeout;

  try {
    const guard = createRasterRuntimeGuard({ timeoutMs: 5_000, maxConcurrent: 1, retryAfterSeconds: 1 });
    const lease = guard.acquire();
    assert.equal(scheduled.size, 1);
    [...scheduled.values()][0]?.();
    await delay(0);
    assert.equal(lease.signal.aborted, true);
    assert.equal(lease.timedOut(), true);
    lease.release();
    assert.equal(guard.snapshot().activeExecutions, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
