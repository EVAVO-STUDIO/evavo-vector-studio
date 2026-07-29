import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryVectorHubLaunchReplayStore,
  createUpstashVectorHubLaunchReplayStore,
} from "./replay.js";
import { VectorHubAuthError } from "./errors.js";

const REPLAY_KEY = `evavo:vector:hub-launch:${"a".repeat(64)}`;
const TOKEN = "upstash-test-token-at-least-24-characters";

test("permits exactly one concurrent memory replay consume", async () => {
  const store = new MemoryVectorHubLaunchReplayStore();
  const results = await Promise.all(
    Array.from({ length: 32 }, () => store.consume(REPLAY_KEY, 135)),
  );
  assert.equal(results.filter((result) => result === "consumed").length, 1);
  assert.equal(results.filter((result) => result === "replayed").length, 31);
  assert.equal(store.durable, false);
});

test("sends one atomic Upstash SET EX NX command without placing secrets in the URL", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const store = createUpstashVectorHubLaunchReplayStore({
    url: "https://vector-auth-example.upstash.io",
    token: TOKEN,
    async fetch(input, init) {
      requests.push({ url: String(input), init });
      return Response.json({ result: "OK" }, {
        status: 200,
        headers: { "content-length": "15" },
      });
    },
  });
  assert.equal(await store.consume(REPLAY_KEY, 135), "consumed");
  assert.equal(store.durable, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://vector-auth-example.upstash.io/");
  assert.doesNotMatch(requests[0]?.url ?? "", new RegExp(TOKEN));
  assert.equal(
    requests[0]?.init?.body,
    JSON.stringify(["SET", REPLAY_KEY, "1", "EX", 135, "NX"]),
  );
  const headers = requests[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
});

test("treats a null atomic result as replay and fails closed on provider errors", async () => {
  const replay = createUpstashVectorHubLaunchReplayStore({
    url: "https://vector-auth-example.upstash.io",
    token: TOKEN,
    async fetch() {
      return Response.json({ result: null }, { status: 200 });
    },
  });
  assert.equal(await replay.consume(REPLAY_KEY, 120), "replayed");

  const unavailable = createUpstashVectorHubLaunchReplayStore({
    url: "https://vector-auth-example.upstash.io",
    token: TOKEN,
    async fetch() {
      return Response.json({ error: "provider unavailable" }, { status: 503 });
    },
  });
  await assert.rejects(
    unavailable.consume(REPLAY_KEY, 120),
    (error: unknown) =>
      error instanceof VectorHubAuthError &&
      error.code === "VECTOR_HUB_LAUNCH_REPLAY_UNAVAILABLE" &&
      error.retryable,
  );
});

test("rejects non-Upstash origins, raw replay keys and invalid TTL values", async () => {
  assert.throws(
    () => createUpstashVectorHubLaunchReplayStore({
      url: "https://redis.example.com",
      token: TOKEN,
    }),
    (error: unknown) =>
      error instanceof VectorHubAuthError &&
      error.code === "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
  );
  const store = new MemoryVectorHubLaunchReplayStore();
  await assert.rejects(
    store.consume("raw-launch-token", 120),
    (error: unknown) => error instanceof VectorHubAuthError,
  );
  await assert.rejects(
    store.consume(REPLAY_KEY, 151),
    (error: unknown) => error instanceof VectorHubAuthError,
  );
});
