import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function file(relativePath) {
  return path.join(root, relativePath);
}

function replaceOnce(relativePath, before, after) {
  const target = file(relativePath);
  const source = fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "");
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(
      `VECTOR_ALIGNMENT_TARGET_INVALID:${relativePath}:${count}`,
    );
  }
  fs.writeFileSync(target, source.replace(before, after), "utf8");
}

replaceOnce(
  "docs/CAPABILITIES.md",
  "- MCP stdio transport and its public contract version.\n",
  "- MCP stdio transport and its public contract version;\n" +
    "- MCP contract version, tool count and MCP batch ceiling.\n",
);

replaceOnce(
  "scripts/check-release-contract.mjs",
  'if (rootPackage?.scripts?.["contract:check"] !== "node scripts/check-release-contract.mjs") {\n' +
    '  fail("package.json must expose contract:check through the dependency-free release gate.");\n' +
    "}\n",
  "const dependencyFreeContractCommand =\n" +
    '  "node scripts/check-runtime-version.mjs && node scripts/check-release-contract.mjs";\n' +
    'if (rootPackage?.scripts?.["contract:check"] !== dependencyFreeContractCommand) {\n' +
    '  fail("package.json must expose contract:check through the composed dependency-free runtime and release gates.");\n' +
    "}\n",
);

replaceOnce(
  "packages/mcp/src/server.test.ts",
  "    assert.equal(printPreflight?.approval, \"review-required\");\n" +
    "    const lottie = payload?.lottie as Record<string, unknown> | undefined;\n",
  "    assert.equal(printPreflight?.approval, \"review-required\");\n" +
    "\n" +
    "    const printSourcePath = path.join(root, \"handshake-print.svg\");\n" +
    "    await writeFile(\n" +
    "      printSourcePath,\n" +
    "      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"25mm\" height=\"25mm\" viewBox=\"0 0 25 25\"><title>Handshake print sample</title><rect width=\"25\" height=\"25\" fill=\"#111\"/></svg>',\n" +
    "      \"utf8\",\n" +
    "    );\n" +
    "    const printResult = await client.callTool({\n" +
    "      name: \"vector_preflight_svg_print\",\n" +
    "      arguments: {\n" +
    "        inputPath: printSourcePath,\n" +
    "        profile: \"commercial\",\n" +
    "      },\n" +
    "    });\n" +
    "    assert.notEqual(printResult.isError, true);\n" +
    "    assert.equal(\n" +
    "      (printResult.structuredContent as { outputWritten?: boolean } | undefined)\n" +
    "        ?.outputWritten,\n" +
    "      false,\n" +
    "    );\n" +
    "\n" +
    "    const lottie = payload?.lottie as Record<string, unknown> | undefined;\n",
);

replaceOnce(
  "apps/web/app/motion/components/MotionWorkspace.tsx",
  "function useObjectUrl(blob: Blob | null): string | null {\n" +
    "  const [url, setUrl] = useState<string | null>(null);\n" +
    "  useEffect(() => {\n",
  "function useObjectUrl(blob: Blob | null, revision = 0): string | null {\n" +
    "  const [url, setUrl] = useState<string | null>(null);\n" +
    "  useEffect(() => {\n" +
    "    void revision;\n",
);
replaceOnce(
  "apps/web/app/motion/components/MotionWorkspace.tsx",
  "  }, [blob]);\n",
  "  }, [blob, revision]);\n",
);
replaceOnce(
  "apps/web/app/motion/components/MotionWorkspace.tsx",
  "  const animatedBlob = useMemo(\n" +
    "    () => result ? new Blob([result.response.svg], { type: \"image/svg+xml\" }) : null,\n" +
    "    [result, replayRevision],\n" +
    "  );\n" +
    "  const animatedUrl = useObjectUrl(animatedBlob);\n",
  "  const animatedBlob = useMemo(\n" +
    "    () => result ? new Blob([result.response.svg], { type: \"image/svg+xml\" }) : null,\n" +
    "    [result],\n" +
    "  );\n" +
    "  const animatedUrl = useObjectUrl(animatedBlob, replayRevision);\n",
);

replaceOnce(
  "apps/web/tsconfig.json",
  '    "incremental": true,\n',
  '    "incremental": true,\n    "allowJs": true,\n',
);

replaceOnce(
  ".github/workflows/quality.yml",
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

const expression = (value) => `$\{\{ ${value} }}`;
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
);

const qualityPath = file(".github/workflows/quality.yml");
const qualitySource = fs.readFileSync(qualityPath, "utf8").replace(/^\uFEFF/, "");
const startToken = "      - name: Run governed source contracts\n";
const endToken = "      - name: Run lint\n";
const start = qualitySource.indexOf(startToken);
const end = qualitySource.indexOf(endToken, start + startToken.length);
if (start < 0 || end <= start) {
  throw new Error("VECTOR_ALIGNMENT_QUALITY_BLOCK_INVALID");
}
fs.writeFileSync(
  qualityPath,
  qualitySource.slice(0, start) + explicit.join("\n") + qualitySource.slice(end),
  "utf8",
);

for (const relativePath of [
  ".github/workflows/align-source-contracts-once.yml",
  "scripts/align-source-contracts-once.mjs",
]) {
  fs.unlinkSync(file(relativePath));
}

process.stdout.write(`${JSON.stringify({
  check: "vector-source-contract-alignment",
  ok: true,
  explicitContractStepCount: contracts.length,
  selfDeleting: true,
  productionApproval: false,
}, null, 2)}\n`);
