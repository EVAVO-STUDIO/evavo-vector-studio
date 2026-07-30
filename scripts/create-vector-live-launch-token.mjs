import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT_VERSION = "1.0";
const REPOSITORY = "EVAVO-STUDIO/evavo-vector-studio";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const PROFILE_NAMES = Object.freeze(["owner", "client"]);
const MAX_RECEIPT_BYTES = 64 * 1024;

const PROFILE_CLAIMS = Object.freeze({
  owner: Object.freeze({
    subjectPrefix: "vector-live-owner",
    email: "vector-owner-proof@evavo.com.au",
    organisationId: "evavo-studio",
    organisationName: "EVAVO Studio",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    workspaceName: "EVAVO Owner Workspace",
  }),
  client: Object.freeze({
    subjectPrefix: "vector-live-client",
    email: "vector-client-proof@evavo.com.au",
    organisationId: "evavo-client-proof",
    organisationName: "EVAVO Client Proof",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    workspaceName: "Client Proof Workspace",
  }),
});

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const result = {
    profile: null,
    commit: null,
    tokenOut: null,
    receiptOut: null,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (["--profile", "--commit", "--token-out", "--receipt-out"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) fail("VECTOR_LIVE_LAUNCH_ARGUMENT_INVALID", `${argument} requires a value.`);
      index += 1;
      if (argument === "--profile") result.profile = value;
      if (argument === "--commit") result.commit = value;
      if (argument === "--token-out") result.tokenOut = value;
      if (argument === "--receipt-out") result.receiptOut = value;
      continue;
    }
    fail("VECTOR_LIVE_LAUNCH_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  if (result.selfTest) return result;
  if (!PROFILE_NAMES.includes(result.profile)) {
    fail("VECTOR_LIVE_LAUNCH_PROFILE_INVALID", "The live launch profile must be owner or client.");
  }
  if (!result.commit || !SHA_PATTERN.test(result.commit)) {
    fail("VECTOR_LIVE_LAUNCH_COMMIT_INVALID", "Pass a lowercase 40-character Git commit.");
  }
  if (!result.tokenOut || !result.receiptOut) {
    fail("VECTOR_LIVE_LAUNCH_OUTPUT_REQUIRED", "Pass both --token-out and --receipt-out.");
  }
  if (path.resolve(result.tokenOut) === path.resolve(result.receiptOut)) {
    fail("VECTOR_LIVE_LAUNCH_OUTPUT_COLLISION", "Token and receipt outputs must be different files.");
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function profileClaims(profile, commit, issuedAt, nonce, constants) {
  const source = PROFILE_CLAIMS[profile];
  if (!source) fail("VECTOR_LIVE_LAUNCH_PROFILE_INVALID", "Unknown live launch profile.");
  return Object.freeze({
    version: constants.VECTOR_HUB_LAUNCH_VERSION,
    issuer: constants.VECTOR_HUB_LAUNCH_ISSUER,
    audience: constants.VECTOR_HUB_TARGET_HOST,
    subject: `${source.subjectPrefix}:${commit.slice(0, 24)}`,
    email: source.email,
    organisationId: source.organisationId,
    organisationName: source.organisationName,
    workspaceId: source.workspaceId,
    workspaceName: source.workspaceName,
    applicationKey: constants.VECTOR_HUB_APPLICATION_KEY,
    applicationLabel: constants.VECTOR_HUB_APPLICATION_LABEL,
    targetHost: constants.VECTOR_HUB_TARGET_HOST,
    issuedAt,
    expiresAt: issuedAt + constants.VECTOR_HUB_LAUNCH_TTL_SECONDS,
    nonce,
  });
}

async function exclusiveFile(target, source, mode = 0o600) {
  const absolute = path.resolve(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, source, { encoding: "utf8", flag: "wx", mode });
  return absolute;
}

async function runSelfTest() {
  const constants = Object.freeze({
    VECTOR_HUB_LAUNCH_VERSION: "evavo-client-app-launch-v1",
    VECTOR_HUB_LAUNCH_ISSUER: "evavo-client-hub",
    VECTOR_HUB_TARGET_HOST: "vector.evavo.com.au",
    VECTOR_HUB_APPLICATION_KEY: "vector-studio",
    VECTOR_HUB_APPLICATION_LABEL: "EVAVO Vector Studio",
    VECTOR_HUB_LAUNCH_TTL_SECONDS: 120,
  });
  const commit = "a".repeat(40);
  const owner = profileClaims("owner", commit, 1_785_286_400, "ownerproofnonce0123456789abcd", constants);
  const client = profileClaims("client", commit, 1_785_286_400, "clientproofnonce0123456789abc", constants);
  assert.equal(owner.expiresAt - owner.issuedAt, 120);
  assert.equal(client.applicationKey, "vector-studio");
  assert.notEqual(owner.subject, client.subject);
  assert.notEqual(owner.workspaceId, client.workspaceId);
  assert.equal(owner.email, owner.email.toLowerCase());
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "vector-live-launch-token-self-test",
    contractVersion: CONTRACT_VERSION,
    profiles: PROFILE_NAMES,
    tokenBodyRecorded: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await runSelfTest();
    return;
  }

  const launchSecret = String(process.env.EVAVO_CLIENT_APP_LAUNCH_SECRET ?? "");
  const privateSecret = String(process.env.EVAVO_VECTOR_PRIVATE_SIGNING_SECRET ?? "");
  const hubAuth = await import("../packages/hub-auth/dist/index.js");
  hubAuth.assertVectorHubSecretsSeparated(launchSecret, privateSecret);

  const issuedAt = Math.floor(Date.now() / 1_000);
  const nonce = randomBytes(24).toString("base64url");
  const claims = profileClaims(options.profile, options.commit, issuedAt, nonce, hubAuth);
  const token = hubAuth.createVectorHubLaunchFixtureToken({
    secret: launchSecret,
    claims,
  });
  const verification = hubAuth.verifyVectorHubLaunchToken({
    token,
    secret: launchSecret,
    now: issuedAt,
  });
  if (!verification.ok) {
    fail(
      "VECTOR_LIVE_LAUNCH_GENERATION_INVALID",
      "The generated live launch token did not pass the shared receiver contract.",
      { reason: verification.reason },
    );
  }

  const tokenPath = await exclusiveFile(options.tokenOut, `${token}\n`);
  const receipt = Object.freeze({
    version: CONTRACT_VERSION,
    check: "vector-live-launch-token",
    repository: REPOSITORY,
    commit: options.commit,
    profile: options.profile,
    issuedAt: new Date(claims.issuedAt * 1_000).toISOString(),
    expiresAt: new Date(claims.expiresAt * 1_000).toISOString(),
    tokenSha256: verification.tokenSha256,
    replayKeySha256: sha256(verification.replayKey),
    replayTtlSeconds: verification.replayTtlSeconds,
    claims: Object.freeze({
      version: claims.version,
      issuer: claims.issuer,
      audience: claims.audience,
      applicationKey: claims.applicationKey,
      targetHost: claims.targetHost,
      organisationId: claims.organisationId,
      workspaceId: claims.workspaceId,
    }),
    tokenBodyRecorded: false,
    sensitiveValuesRecorded: false,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    fail("VECTOR_LIVE_LAUNCH_RECEIPT_TOO_LARGE", "The live launch receipt exceeded its bound.");
  }
  if (serialized.includes(token) || serialized.includes(launchSecret) || serialized.includes(privateSecret)) {
    fail("VECTOR_LIVE_LAUNCH_SECRET_LEAK", "Sensitive live launch material entered the receipt.");
  }
  const receiptPath = await exclusiveFile(options.receiptOut, serialized, 0o600);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    profile: options.profile,
    commit: options.commit,
    tokenPath,
    receiptPath,
    tokenSha256: verification.tokenSha256,
    tokenBodyRecorded: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error && "code" in error ? error.code : "VECTOR_LIVE_LAUNCH_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error && "details" in error ? error.details : undefined,
    tokenBodyRecorded: false,
    sensitiveValuesRecorded: false,
  }, null, 2)}\n`);
  process.exit(1);
});
