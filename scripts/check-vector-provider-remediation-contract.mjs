import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const checkedFiles = new Set();

async function read(relativePath) {
  checkedFiles.add(relativePath);
  try {
    return (await fs.readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    errors.push(
      `Missing or unreadable provider-remediation file: ${relativePath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return "";
  }
}

function exactKeys(label, value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    errors.push(`${label} fields drifted.`);
  }
}

function requireTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      errors.push(`${relativePath} is missing provider-remediation token: ${token}`);
    }
  }
}

function forbidTokens(relativePath, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) {
      errors.push(`${relativePath} contains prohibited provider-remediation token: ${token}`);
    }
  }
}

function count(source, token) {
  return source.split(token).length - 1;
}

const files = Object.freeze({
  project: "ops/provider/vector-studio-vercel-project-v1.json",
  remediation: "ops/provider/vector-studio-provider-remediation-v1.json",
  workflow: ".github/workflows/governance-contract.yml",
  checker: "scripts/check-vector-provider-remediation-contract.mjs",
  documentation: "docs/VERCEL-REMEDIATION.md",
});

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)]),
  ),
);

let project = null;
let remediation = null;
for (const [label, key] of [
  ["project contract", "project"],
  ["remediation contract", "remediation"],
]) {
  try {
    const value = JSON.parse(sources[key] || "{}");
    if (key === "project") project = value;
    else remediation = value;
  } catch (error) {
    errors.push(
      `Invalid ${label} JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const EXPECTED_STATES = Object.freeze([
  "source-ready",
  "project-created",
  "project-configured",
  "domain-verified",
  "production-deployed",
  "owner-launch-proven",
  "client-launch-proven",
  "replay-rejection-proven",
  "release-promoted",
]);

const EXPECTED_ACTIONS = Object.freeze([
  [1, "CONFIRM_SOURCE_CONTROL_BOUNDARY", "project-source-control", "EVAVO-STUDIO/evavo-vector-studio", false, "provider-read", "matching-github-link-or-api-managed-project"],
  [2, "SET_ROOT_DIRECTORY", "project-settings", "apps/web", true, "protected-provider-apply", "root-directory-matches"],
  [3, "SET_FRAMEWORK", "project-settings", "nextjs", true, "protected-provider-apply", "framework-matches"],
  [4, "SET_NODE_VERSION", "project-settings", "22.x", true, "protected-provider-apply", "node-version-matches"],
  [5, "SET_INSTALL_COMMAND", "project-settings", "cd ../.. && pnpm install --frozen-lockfile", true, "protected-provider-apply", "install-command-matches"],
  [6, "SET_BUILD_COMMAND", "project-settings", "cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web", true, "protected-provider-apply", "build-command-matches"],
  [7, "CONFIGURE_RUNTIME_AUTHORITIES", "production-environment", "all-required-production-authorities-valid-and-separated", true, "protected-provider-apply", "authority-readiness-receipt"],
  [8, "ATTACH_CANONICAL_DOMAIN", "production-domain", "vector.evavo.com.au", true, "protected-provider-apply", "canonical-domain-verified"],
  [9, "DEPLOY_EXACT_SOURCE", "production-deployment", "exact-current-main", true, "protected-production-deploy", "ready-production-deployment-bound-to-source"],
  [10, "VERIFY_LIVE_RUNTIME", "public-runtime-proof", "readiness-and-capabilities-verified", false, "read-only-verification", "bounded-live-runtime-receipt"],
  [11, "RUN_SIGNED_LAUNCH_PROOFS", "release-evidence", "owner-client-and-replay-proven", false, "human-approved-proof", "one-time-launch-and-replay-rejection-receipts"],
  [12, "PROMOTE_FROM_CENTRAL_HUB", "release-policy", "explicit-human-approved-promotion", true, "central-human-promotion", "reviewed-release-policy-commit"],
]);

if (remediation) {
  exactKeys("Provider remediation contract", remediation, [
    "actions",
    "contractVersion",
    "mutationAuthority",
    "project",
    "projectContract",
    "provider",
    "release",
    "secretValuesIncluded",
    "sourcePolicy",
    "stateModel",
  ]);
  exactKeys("Provider remediation project", remediation.project, [
    "buildCommand",
    "canonicalDomain",
    "framework",
    "id",
    "installCommand",
    "name",
    "nodeVersion",
    "repository",
    "rootDirectory",
    "teamId",
  ]);
  exactKeys("Provider remediation source policy", remediation.sourcePolicy, [
    "branch",
    "exactCurrentMainRequired",
    "sourceProofRequired",
  ]);
  exactKeys("Provider remediation release", remediation.release, [
    "automaticPromotionAllowed",
    "canonicalDomainProofRequired",
    "centralHumanPromotionRequired",
    "clientLaunchProofRequired",
    "clientReleaseEligible",
    "exactProductionDeploymentProofRequired",
    "liveRuntimeProofRequired",
    "ownerLaunchProofRequired",
    "providerConfigurationProofRequired",
    "replayRejectionProofRequired",
  ]);

  if (
    remediation.contractVersion !== "1.0" ||
    remediation.provider !== "vercel" ||
    remediation.projectContract !== files.project ||
    remediation.mutationAuthority !== "repository-owned-guarded-workflows" ||
    remediation.secretValuesIncluded !== false
  ) {
    errors.push("Provider remediation identity or safety posture drifted.");
  }

  const expectedProject = {
    id: "prj_Nb5IcrF5Fd0xhwDoUfZPJYmwSo6L",
    name: "evavo-vector-studio",
    teamId: "team_ckKLAnG3MGJK0mMpIVpjbogl",
    repository: "EVAVO-STUDIO/evavo-vector-studio",
    rootDirectory: "apps/web",
    framework: "nextjs",
    nodeVersion: "22.x",
    installCommand: "cd ../.. && pnpm install --frozen-lockfile",
    buildCommand: "cd ../.. && pnpm exec turbo run build --filter=@evavo/vector-web",
    canonicalDomain: "vector.evavo.com.au",
  };
  for (const [field, expected] of Object.entries(expectedProject)) {
    if (remediation.project?.[field] !== expected) {
      errors.push(`Provider remediation project field ${field} drifted.`);
    }
  }

  if (
    remediation.sourcePolicy?.branch !== "main" ||
    remediation.sourcePolicy?.exactCurrentMainRequired !== true ||
    remediation.sourcePolicy?.sourceProofRequired !== true
  ) {
    errors.push("Provider remediation source policy must remain exact-current-main and source-proofed.");
  }

  if (
    !Array.isArray(remediation.stateModel) ||
    remediation.stateModel.length !== EXPECTED_STATES.length ||
    remediation.stateModel.some((state, index) => state !== EXPECTED_STATES[index])
  ) {
    errors.push("Provider remediation state model drifted.");
  }

  if (!Array.isArray(remediation.actions) || remediation.actions.length !== EXPECTED_ACTIONS.length) {
    errors.push("Provider remediation action count drifted.");
  } else {
    const codes = new Set();
    for (let index = 0; index < EXPECTED_ACTIONS.length; index += 1) {
      const action = remediation.actions[index];
      const [sequence, code, scope, target, mutationRequired, authority, completionEvidence] =
        EXPECTED_ACTIONS[index];
      exactKeys(`Provider remediation action ${sequence}`, action, [
        "authority",
        "code",
        "completionEvidence",
        "mutationRequired",
        "scope",
        "sequence",
        "target",
      ]);
      if (
        action?.sequence !== sequence ||
        action?.code !== code ||
        action?.scope !== scope ||
        action?.target !== target ||
        action?.mutationRequired !== mutationRequired ||
        action?.authority !== authority ||
        action?.completionEvidence !== completionEvidence
      ) {
        errors.push(`Provider remediation action ${sequence} drifted.`);
      }
      if (codes.has(action?.code)) {
        errors.push(`Duplicate provider remediation action code: ${action?.code}`);
      }
      codes.add(action?.code);
      if ("observed" in (action ?? {}) || "complete" in (action ?? {}) || "performed" in (action ?? {})) {
        errors.push(`Canonical provider action ${sequence} must not embed mutable observed or completion state.`);
      }
    }
  }

  for (const field of [
    "providerConfigurationProofRequired",
    "canonicalDomainProofRequired",
    "exactProductionDeploymentProofRequired",
    "liveRuntimeProofRequired",
    "ownerLaunchProofRequired",
    "clientLaunchProofRequired",
    "replayRejectionProofRequired",
    "centralHumanPromotionRequired",
  ]) {
    if (remediation.release?.[field] !== true) {
      errors.push(`Provider remediation release field ${field} must remain required.`);
    }
  }
  if (
    remediation.release?.clientReleaseEligible !== false ||
    remediation.release?.automaticPromotionAllowed !== false
  ) {
    errors.push("Provider remediation release must remain fail-closed.");
  }
}

if (project && remediation) {
  const projectPairs = [
    ["id", project.project?.id],
    ["name", project.project?.name],
    ["repository", project.project?.repository],
    ["rootDirectory", project.project?.rootDirectory],
    ["framework", project.project?.framework],
    ["nodeVersion", project.project?.nodeVersion],
    ["installCommand", project.project?.installCommand],
    ["buildCommand", project.project?.buildCommand],
  ];
  for (const [field, value] of projectPairs) {
    if (remediation.project?.[field] !== value) {
      errors.push(`Provider remediation ${field} no longer matches the Vercel project contract.`);
    }
  }
  if (
    remediation.project?.teamId !== project.team?.id ||
    remediation.project?.canonicalDomain !== project.production?.domain ||
    remediation.stateModel?.some((state, index) => state !== project.stateModel?.[index])
  ) {
    errors.push("Provider remediation project, domain or state model no longer matches the Vercel project contract.");
  }
  if (
    project.clientReleaseEligible !== false ||
    project.mutationAuthority !== remediation.mutationAuthority ||
    project.secretValuesIncluded !== false
  ) {
    errors.push("Vercel project and remediation safety boundaries diverged.");
  }
}

for (const relativePath of [files.remediation, files.checker, files.documentation]) {
  if (count(sources.workflow, `      - "${relativePath}"`) !== 2) {
    errors.push(`Governance workflow path coverage drifted for ${relativePath}.`);
  }
}

requireTokens(files.workflow, sources.workflow, [
  "Vector Studio source governance",
  "contents: read",
  "statuses: write",
  "persist-credentials: false",
  "Verify provider remediation contract",
  "id: provider_remediation",
  "node scripts/check-vector-provider-remediation-contract.mjs",
  "PROVIDER_REMEDIATION_OUTCOME",
  "provider/vector-remediation-contract",
  'test "$PROVIDER_REMEDIATION_OUTCOME" = "success"',
]);
forbidTokens(files.workflow, sources.workflow, [
  "contents: write",
  "actions: write",
  "secrets.",
  "git push",
  "vercel deploy",
  "vercel --prod",
]);

requireTokens(files.documentation, sources.documentation, [
  "# Vector Studio provider remediation contract",
  files.remediation,
  "exact current main",
  "CONFIRM_SOURCE_CONTROL_BOUNDARY",
  "ATTACH_CANONICAL_DOMAIN",
  "DEPLOY_EXACT_SOURCE",
  "RUN_SIGNED_LAUNCH_PROOFS",
  "PROMOTE_FROM_CENTRAL_HUB",
  "source contract, not a live provider receipt",
  "The domain is attached and verified before the exact production deployment proof",
  "`clientReleaseEligible` and `automaticPromotionAllowed` remain `false`",
  "The contract does not deploy",
]);
forbidTokens(files.documentation, sources.documentation, [
  "VERCEL_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
]);
forbidTokens(files.remediation, sources.remediation, [
  "VERCEL_TOKEN",
  "EVAVO_CLIENT_APP_LAUNCH_SECRET",
  "EVAVO_VECTOR_PRIVATE_SIGNING_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "VECTOR_API_TOKEN",
  "VECTOR_WORKER_API_TOKEN",
  '"clientReleaseEligible": true',
  '"automaticPromotionAllowed": true',
]);

const destructiveFixtures = [
  ["action order", [...(remediation?.actions ?? [])].reverse(), (value) =>
    value.every((action, index) => action.sequence === index + 1)],
  ["automatic promotion", { ...(remediation?.release ?? {}), automaticPromotionAllowed: true }, (value) =>
    value.automaticPromotionAllowed === false],
  ["client release", { ...(remediation?.release ?? {}), clientReleaseEligible: true }, (value) =>
    value.clientReleaseEligible === false],
  ["embedded completion", { ...(remediation?.actions?.[0] ?? {}), complete: true }, (value) =>
    !("complete" in value)],
];
for (const [label, value, passes] of destructiveFixtures) {
  if (passes(value)) {
    errors.push(`Destructive provider-remediation ${label} fixture did not fail closed.`);
  }
}

if (errors.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        check: "vector-studio-provider-remediation",
        ok: false,
        contractVersion: "1.0",
        errors,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      check: "vector-studio-provider-remediation",
      ok: true,
      contractVersion: remediation.contractVersion,
      provider: remediation.provider,
      projectId: remediation.project.id,
      actionCount: remediation.actions.length,
      stateCount: remediation.stateModel.length,
      domainBeforeDeployment:
        remediation.actions[7].code === "ATTACH_CANONICAL_DOMAIN" &&
        remediation.actions[8].code === "DEPLOY_EXACT_SOURCE",
      clientReleaseEligible: remediation.release.clientReleaseEligible,
      automaticPromotionAllowed: remediation.release.automaticPromotionAllowed,
      mutationPerformed: false,
      sensitiveValuesRecorded: false,
      checkedFiles: [...checkedFiles].sort(),
    },
    null,
    2,
  )}\n`,
);
