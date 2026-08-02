import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const qualityPath = path.join(root, ".github/workflows/quality.yml");

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`VECTOR_QUALITY_MATERIALIZE_TARGET_INVALID:${label}:${count}`);
  }
  return source.replace(before, after);
}

let qualitySource = fs.readFileSync(qualityPath, "utf8").replace(/^\uFEFF/, "");
qualitySource = replaceOnce(
  qualitySource,
  "      - name: Use Node.js 22 without package-manager caching\n" +
    "        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n" +
    "        with:\n" +
    "          node-version: 22\n" +
    "          package-manager-cache: false\n",
  "      - name: Use the repository Node.js version without package-manager caching\n" +
    "        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n" +
    "        with:\n" +
    "          node-version-file: .nvmrc\n" +
    "          package-manager-cache: false\n",
  "node-version",
);

const contracts = Object.freeze([
  ["Verify runtime version contract", "contract_runtime", "scripts/check-runtime-version.mjs"],
  ["Verify release contract", "contract_release", "scripts/check-release-contract.mjs"],
  ["Verify release proof contract", "contract_release_proof", "scripts/check-release-proof-contract.mjs"],
  ["Verify capability discovery contract", "contract_capabilities", "scripts/check-capability-discovery.mjs"],
  ["Verify print preflight API contract", "contract_print_api", "scripts/check-print-preflight-api-contract.mjs"],
  ["Verify Hub integration contract", "contract_hub", "scripts/check-hub-integration-contract.mjs"],
  ["Verify private response contract", "contract_private_response", "scripts/check-private-response-contract.mjs"],
  ["Verify Vercel deployment contract", "contract_vercel", "scripts/check-vercel-deployment-contract.mjs"],
  ["Verify Vercel project provisioning contract", "contract_vercel_provision", "scripts/check-vercel-project-provisioning-contract.mjs"],
  ["Verify Vercel provisioning plan receipt contract", "contract_vercel_provision_plan", "scripts/check-vercel-provisioning-plan-receipt-contract.mjs"],
  ["Verify Vercel deployment plan receipt contract", "contract_vercel_plan", "scripts/check-vercel-deployment-plan-receipt-contract.mjs"],
  ["Verify Vercel production deployment contract", "contract_vercel_production", "scripts/check-vercel-production-deployment-contract.mjs"],
  ["Verify topology contract", "contract_topology", "scripts/check-topology-contract.mjs"],
  ["Verify browser evidence contract", "contract_browser_evidence", "scripts/check-browser-evidence-contract.mjs"],
  ["Verify MCP contract", "contract_mcp", "scripts/check-mcp-contract.mjs"],
  ["Verify motion contract", "contract_motion", "scripts/check-motion-contract.mjs"],
  ["Verify motion API contract", "contract_motion_api", "scripts/check-motion-api-contract.mjs"],
  ["Verify Motion Director contract", "contract_motion_workspace", "scripts/check-motion-workspace-contract.mjs"],
  ["Verify native runtime boundary", "contract_native", "scripts/check-native-runtime-boundary.mjs"],
  ["Verify Lottie core contract", "contract_lottie", "scripts/check-lottie-contract.mjs"],
  ["Verify Lottie API contract", "contract_lottie_api", "scripts/check-lottie-api-contract.mjs"],
  ["Verify browser Lottie contract", "contract_lottie_workspace", "scripts/check-lottie-workspace-contract.mjs"],
  ["Verify dotLottie archive contract", "contract_dotlottie", "scripts/check-dotlottie-contract.mjs"],
  ["Verify dotLottie API contract", "contract_dotlottie_api", "scripts/check-dotlottie-api-contract.mjs"],
  ["Verify browser dotLottie contract", "contract_dotlottie_workspace", "scripts/check-dotlottie-workspace-contract.mjs"],
  ["Verify durable batch contract", "contract_batch", "scripts/check-batch-contract.mjs"],
  ["Verify hosted job control contract", "contract_hosted_jobs", "scripts/check-hosted-job-contract.mjs"],
  ["Verify worker execution contract", "contract_worker", "scripts/check-worker-contract.mjs"],
  ["Verify local worker process contract", "contract_local_worker", "scripts/check-local-worker-contract.mjs"],
  ["Verify worker control API contract", "contract_worker_api", "scripts/check-worker-api-contract.mjs"],
  ["Verify worker control client contract", "contract_worker_client", "scripts/check-worker-client-contract.mjs"],
  ["Verify HTTP-coordinated worker contract", "contract_http_worker", "scripts/check-http-worker-contract.mjs"],
  ["Verify worker object-transfer API contract", "contract_object_transfer", "scripts/check-object-transfer-api-contract.mjs"],
]);

const expression = (value) => `$\{\{ ${value} }\}`;
const explicit = [];
for (const [name, stepId, script] of contracts) {
  explicit.push(
    `      - name: ${name}`,
    `        id: ${stepId}`,
    `        if: ${expression("!cancelled() && steps.install.outcome == 'success'")}`,
    "        continue-on-error: true",
    "        shell: bash",
    "        run: |",
    "          mkdir -p .ci/contracts",
    "          set -o pipefail",
    `          node ${script} 2>&1 | tee .ci/contracts/${stepId}.log`,
    "",
  );
}

explicit.push(
  "      - name: Aggregate governed source contracts",
  "        id: contracts",
  `        if: ${expression("!cancelled() && steps.install.outcome == 'success'")}`,
  "        continue-on-error: true",
  "        shell: bash",
  "        env:",
);
for (const [, stepId] of contracts) {
  explicit.push(
    `          ${stepId.toUpperCase()}_OUTCOME: ${expression(`steps.${stepId}.outcome`)}`,
  );
}
explicit.push(
  "        run: |",
  "          mkdir -p .ci",
  "          cat .ci/contracts/*.log > .ci/contracts.log",
  "          outcomes=(",
);
for (const [, stepId] of contracts) {
  explicit.push(`            \"$${stepId.toUpperCase()}_OUTCOME\"`);
}
explicit.push(
  "          )",
  "          status=0",
  "          for outcome in \"${outcomes[@]}\"; do",
  "            if [ \"$outcome\" != \"success\" ]; then",
  "              status=1",
  "            fi",
  "          done",
  "          exit \"$status\"",
  "",
  "",
);

const startToken = "      - name: Run governed source contracts\n";
const endToken = "      - name: Run lint\n";
const start = qualitySource.indexOf(startToken);
const end = qualitySource.indexOf(endToken, start + startToken.length);
if (start < 0 || end <= start) {
  throw new Error("VECTOR_QUALITY_MATERIALIZE_BLOCK_INVALID");
}
qualitySource = qualitySource.slice(0, start) + explicit.join("\n") + qualitySource.slice(end);
fs.writeFileSync(qualityPath, qualitySource, "utf8");

process.stdout.write(`${JSON.stringify({
  check: "vector-quality-workflow-materialization",
  ok: true,
  explicitContractStepCount: contracts.length,
  exactNodeSelector: ".nvmrc",
  productionApproval: false,
}, null, 2)}\n`);
