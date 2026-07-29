import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  VECTOR_HUB_APPLICATION_KEY,
  VECTOR_HUB_APPLICATION_LABEL,
  VECTOR_HUB_LAUNCH_VERSION,
  VECTOR_HUB_TARGET_HOST,
  verifyVectorHubLaunchToken,
  type VectorHubLaunchClaims,
} from "./launch.js";

type NextWebsiteLaunchFixture = Readonly<{
  fixtureVersion: 1;
  producer: string;
  producerContract: string;
  consumer: string;
  testOnlySecret: string;
  evaluationTime: number;
  canonicalPayloadJson: string;
  token: string;
  claims: VectorHubLaunchClaims;
}>;

const FIXTURE_URL = new URL(
  "../fixtures/next-website-vector-studio-launch-v1.json",
  import.meta.url,
);

async function fixture(): Promise<NextWebsiteLaunchFixture> {
  return JSON.parse(await readFile(FIXTURE_URL, "utf8")) as NextWebsiteLaunchFixture;
}

test("accepts the exact independent next-website Vector Studio handoff fixture", async () => {
  const value = await fixture();
  assert.deepEqual(Object.keys(value), [
    "fixtureVersion",
    "producer",
    "producerContract",
    "consumer",
    "testOnlySecret",
    "evaluationTime",
    "canonicalPayloadJson",
    "token",
    "claims",
  ]);
  assert.equal(value.fixtureVersion, 1);
  assert.equal(
    value.producer,
    "EVAVO-STUDIO/next-website createClientApplicationLaunchToken",
  );
  assert.equal(value.producerContract, VECTOR_HUB_LAUNCH_VERSION);
  assert.equal(
    value.consumer,
    "EVAVO-STUDIO/evavo-vector-studio @evavo/hub-auth",
  );
  assert.match(value.testOnlySecret, /^next-website-fixture-launch-secret-/);

  const parts = value.token.split(".");
  assert.equal(parts.length, 2);
  const payload = parts[0];
  const signature = parts[1];
  assert.ok(payload && signature);
  assert.equal(
    Buffer.from(payload, "base64url").toString("utf8"),
    value.canonicalPayloadJson,
  );
  assert.equal(
    signature,
    createHmac("sha256", value.testOnlySecret)
      .update(payload)
      .digest("base64url"),
  );
  assert.deepEqual(JSON.parse(value.canonicalPayloadJson), value.claims);

  const verified = verifyVectorHubLaunchToken({
    token: value.token,
    secret: value.testOnlySecret,
    now: value.evaluationTime,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.deepEqual(verified.claims, value.claims);
  assert.equal(verified.claims.version, VECTOR_HUB_LAUNCH_VERSION);
  assert.equal(verified.claims.applicationKey, VECTOR_HUB_APPLICATION_KEY);
  assert.equal(verified.claims.applicationLabel, VECTOR_HUB_APPLICATION_LABEL);
  assert.equal(verified.claims.audience, VECTOR_HUB_TARGET_HOST);
  assert.equal(verified.claims.targetHost, VECTOR_HUB_TARGET_HOST);
  assert.equal(verified.replayTtlSeconds, 115);
  assert.match(verified.tokenSha256, /^[a-f0-9]{64}$/);
  assert.match(verified.replayKey, /^evavo:vector:hub-launch:[a-f0-9]{64}$/);
});

test("keeps the compatibility fixture explicitly test-only and non-authoritative", async () => {
  const value = await fixture();
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /EVAVO_CLIENT_APP_LAUNCH_SECRET/);
  assert.doesNotMatch(serialized, /EVAVO_VECTOR_PRIVATE_SIGNING_SECRET/);
  assert.doesNotMatch(serialized, /UPSTASH_REDIS_REST_TOKEN/);
  assert.doesNotMatch(serialized, /C:\\/);
  assert.equal(value.claims.applicationKey, "vector-studio");
  assert.equal(value.claims.targetHost, "vector.evavo.com.au");
});
