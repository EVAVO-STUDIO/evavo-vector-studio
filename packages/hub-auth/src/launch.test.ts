import assert from "node:assert/strict";
import test from "node:test";
import {
  VECTOR_HUB_APPLICATION_KEY,
  VECTOR_HUB_APPLICATION_LABEL,
  VECTOR_HUB_LAUNCH_ISSUER,
  VECTOR_HUB_LAUNCH_TTL_SECONDS,
  VECTOR_HUB_LAUNCH_VERSION,
  VECTOR_HUB_TARGET_HOST,
  assertVectorHubSecretsSeparated,
  createVectorHubLaunchFixtureToken,
  verifyVectorHubLaunchToken,
  type VectorHubLaunchClaims,
} from "./launch.js";
import { VectorHubAuthError } from "./errors.js";

const LAUNCH_SECRET = "launch-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const PRIVATE_SECRET = "private-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const NOW = 1_785_286_400;

function claims(
  overrides: Partial<VectorHubLaunchClaims> = {},
): VectorHubLaunchClaims {
  return Object.freeze({
    version: VECTOR_HUB_LAUNCH_VERSION,
    issuer: VECTOR_HUB_LAUNCH_ISSUER,
    audience: VECTOR_HUB_TARGET_HOST,
    subject: "b86f66cd-14c1-4f66-8d95-5b7adb17a791",
    email: "client@example.com",
    organisationId: "67fd5804-5df2-4d88-b8c0-e09d54aa44a3",
    organisationName: "Example Organisation",
    workspaceId: "c4713368-c9ec-4a6a-9b91-6a40f3c451df",
    workspaceName: "Brand Workspace",
    applicationKey: VECTOR_HUB_APPLICATION_KEY,
    applicationLabel: VECTOR_HUB_APPLICATION_LABEL,
    targetHost: VECTOR_HUB_TARGET_HOST,
    issuedAt: NOW,
    expiresAt: NOW + VECTOR_HUB_LAUNCH_TTL_SECONDS,
    nonce: "0123456789abcdefghijklmnopqrstuv",
    ...overrides,
  });
}

test("verifies the exact generic EVAVO hub handoff for Vector Studio", () => {
  const token = createVectorHubLaunchFixtureToken({
    secret: LAUNCH_SECRET,
    claims: claims(),
  });
  const verified = verifyVectorHubLaunchToken({
    token,
    secret: LAUNCH_SECRET,
    now: NOW + 20,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.claims.applicationKey, "vector-studio");
  assert.equal(verified.claims.applicationLabel, "EVAVO Vector Studio");
  assert.equal(verified.claims.targetHost, "vector.evavo.com.au");
  assert.match(verified.tokenSha256, /^[a-f0-9]{64}$/);
  assert.match(verified.replayKey, /^evavo:vector:hub-launch:[a-f0-9]{64}$/);
  assert.equal(verified.replayTtlSeconds, 115);
});

test("rejects tampering, wrong audience, unknown fields and expired handoffs", () => {
  const token = createVectorHubLaunchFixtureToken({
    secret: LAUNCH_SECRET,
    claims: claims(),
  });
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(
    verifyVectorHubLaunchToken({ token: tampered, secret: LAUNCH_SECRET, now: NOW }).ok,
    false,
  );

  assert.throws(
    () => createVectorHubLaunchFixtureToken({
      secret: LAUNCH_SECRET,
      claims: claims({ audience: "other.evavo.com.au" as typeof VECTOR_HUB_TARGET_HOST }),
    }),
    (error: unknown) =>
      error instanceof VectorHubAuthError &&
      error.code === "VECTOR_HUB_LAUNCH_TOKEN_INVALID",
  );

  const [payload, signature] = token.split(".");
  assert.ok(payload && signature);
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  decoded.unexpected = true;
  const invalidPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
  const invalidToken = `${invalidPayload}.${signature}`;
  assert.equal(
    verifyVectorHubLaunchToken({ token: invalidToken, secret: LAUNCH_SECRET, now: NOW }).ok,
    false,
  );

  const expired = verifyVectorHubLaunchToken({
    token,
    secret: LAUNCH_SECRET,
    now: NOW + VECTOR_HUB_LAUNCH_TTL_SECONDS + 16,
  });
  assert.deepEqual(expired, {
    ok: false,
    reason: "VECTOR_HUB_LAUNCH_EXPIRED",
  });
});

test("requires separate hub and Vector Studio private signing authorities", () => {
  assert.doesNotThrow(() =>
    assertVectorHubSecretsSeparated(LAUNCH_SECRET, PRIVATE_SECRET)
  );
  assert.throws(
    () => assertVectorHubSecretsSeparated(LAUNCH_SECRET, LAUNCH_SECRET),
    (error: unknown) =>
      error instanceof VectorHubAuthError &&
      error.code === "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
  );
  assert.throws(
    () => assertVectorHubSecretsSeparated(" short ", PRIVATE_SECRET),
    (error: unknown) =>
      error instanceof VectorHubAuthError &&
      error.code === "VECTOR_HUB_AUTH_CONFIGURATION_INVALID",
  );
});
