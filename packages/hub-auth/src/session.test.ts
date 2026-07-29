import assert from "node:assert/strict";
import test from "node:test";
import {
  VECTOR_HUB_APPLICATION_KEY,
  VECTOR_HUB_APPLICATION_LABEL,
  VECTOR_HUB_LAUNCH_ISSUER,
  VECTOR_HUB_LAUNCH_TTL_SECONDS,
  VECTOR_HUB_LAUNCH_VERSION,
  VECTOR_HUB_TARGET_HOST,
  type VectorHubLaunchClaims,
} from "./launch.js";
import {
  VECTOR_WORKSPACE_SESSION_TTL_SECONDS,
  createVectorWorkspaceSessionToken,
  localVectorWorkspaceContext,
  vectorWorkspaceContextFromClaims,
  verifyVectorWorkspaceSessionToken,
} from "./session.js";

const PRIVATE_SECRET = "private-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const WRONG_SECRET = "another-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const NOW = 1_785_286_400;

const launchClaims: VectorHubLaunchClaims = Object.freeze({
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
});

test("exchanges verified hub claims for an app-private eight-hour session", () => {
  const created = createVectorWorkspaceSessionToken({
    secret: PRIVATE_SECRET,
    launchClaims,
    sessionId: "session_0123456789abcdefghijklmnopqrstuv",
    now: NOW,
  });
  assert.equal(created.claims.expiresAt - created.claims.issuedAt, VECTOR_WORKSPACE_SESSION_TTL_SECONDS);
  const verified = verifyVectorWorkspaceSessionToken({
    token: created.token,
    secret: PRIVATE_SECRET,
    now: NOW + 60,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  const context = vectorWorkspaceContextFromClaims(verified.claims);
  assert.equal(context.actorType, "client");
  assert.equal(context.workspace.id, launchClaims.workspaceId);
  assert.equal(context.organisation.name, launchClaims.organisationName);
  assert.equal(context.application.key, "vector-studio");
});

test("the hub handoff authority cannot forge an app-private session", () => {
  const created = createVectorWorkspaceSessionToken({
    secret: PRIVATE_SECRET,
    launchClaims,
    sessionId: "session_0123456789abcdefghijklmnopqrstuv",
    now: NOW,
  });
  assert.deepEqual(
    verifyVectorWorkspaceSessionToken({
      token: created.token,
      secret: WRONG_SECRET,
      now: NOW + 60,
    }),
    { ok: false, reason: "VECTOR_HUB_SESSION_SIGNATURE_INVALID" },
  );
  assert.deepEqual(
    verifyVectorWorkspaceSessionToken({
      token: created.token,
      secret: PRIVATE_SECRET,
      now: NOW + VECTOR_WORKSPACE_SESSION_TTL_SECONDS + 16,
    }),
    { ok: false, reason: "VECTOR_HUB_SESSION_EXPIRED" },
  );
});

test("local development context is explicit and never presented as a client session", () => {
  const context = localVectorWorkspaceContext();
  assert.equal(context.actorType, "local-development");
  assert.equal(context.workspace.id, "local");
  assert.equal(context.expiresAt, null);
});
