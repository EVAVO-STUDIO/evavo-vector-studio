import fs from 'node:fs';

const errors = [];
const read = (path) => {
  try { return fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''); }
  catch (error) { errors.push(`missing ${path}: ${error instanceof Error ? error.message : String(error)}`); return ''; }
};
const json = (path) => {
  const source = read(path);
  try { return JSON.parse(source); }
  catch (error) { errors.push(`invalid JSON ${path}: ${error instanceof Error ? error.message : String(error)}`); return null; }
};

const manifest = json('evavo.capabilities.json');
const packageSource = read('package.json');
const mcpServer = read('packages/mcp/src/server.ts');
const printTools = read('packages/mcp/src/print-tools.ts');
const lottieTools = read('packages/mcp/src/lottie-tools.ts');
const dotLottieTools = read('packages/mcp/src/dotlottie-tools.ts');
const batchTools = read('packages/mcp/src/batch-tools.ts');

if (manifest?.contractVersion !== 'evavo_repository_capabilities_v1') errors.push('wrong manifest contractVersion');
if (manifest?.repository !== 'EVAVO-STUDIO/evavo-vector-studio') errors.push('wrong repository identity');
if (manifest?.authority !== 'vector-studio') errors.push('wrong authority');
if (!Array.isArray(manifest?.capabilities) || manifest.capabilities.length < 8) errors.push('capability registry is incomplete');
if (manifest?.brain?.consult !== true || manifest?.brain?.sanityCheck !== true) errors.push('brain policy missing');

const ids = new Set();
for (const capability of manifest?.capabilities || []) {
  if (!/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(capability.id || '')) errors.push(`invalid capability id ${capability.id}`);
  if (ids.has(capability.id)) errors.push(`duplicate capability id ${capability.id}`);
  ids.add(capability.id);
  for (const field of ['title', 'description', 'interfaces', 'effects', 'entrypoints', 'tags', 'requires']) {
    if (!(field in capability)) errors.push(`${capability.id} missing ${field}`);
  }
  if ((capability.effects || []).includes('publish')) errors.push(`${capability.id} must not claim Git/release publication`);
}

for (const id of [
  'vector.source.inspect',
  'vector.asset.trace',
  'vector.asset.package',
  'vector.print.preflight',
  'vector.motion.author',
  'vector.lottie.export',
  'vector.batch.run',
  'vector.worker.execute',
  'vector.mcp.serve',
  'vector.validation.execute',
]) if (!ids.has(id)) errors.push(`missing required capability ${id}`);

const requireToken = (path, source, token) => { if (!source.includes(token)) errors.push(`${path} missing source binding ${token}`); };
for (const token of [
  '"vector:trace"',
  '"vector:optimise"',
  '"vector:print:preflight"',
  '"vector:animate-svg"',
  '"vector:lottie:export"',
  '"vector:dotlottie:package"',
  '"vector:batch:run"',
  '"vector:mcp"',
  '"worker:run"',
  '"http-worker:run"',
]) requireToken('package.json', packageSource, token);

for (const token of ['"vector_capabilities"', '"vector_inspect_raster"', '"vector_trace_raster"', '"vector_inspect_svg"', '"vector_optimise_svg"', '"vector_validate_motion_plan"', '"vector_animate_svg"']) {
  requireToken('packages/mcp/src/server.ts', mcpServer, token);
}
requireToken('packages/mcp/src/print-tools.ts', printTools, '"vector_preflight_svg_print"');
requireToken('packages/mcp/src/lottie-tools.ts', lottieTools, 'VECTOR_MCP_LOTTIE_TOOL_NAMES');
requireToken('packages/mcp/src/dotlottie-tools.ts', dotLottieTools, 'VECTOR_MCP_DOTLOTTIE_TOOL_NAMES');
requireToken('packages/mcp/src/batch-tools.ts', batchTools, 'VECTOR_MCP_BATCH_TOOL_NAMES');

const serialized = JSON.stringify(manifest || {});
for (const forbidden of ['productionAutoApprovalAvailable', 'remoteExecutionAvailable":true', 'managedRemoteExecution":true']) {
  if (serialized.includes(forbidden)) errors.push(`manifest contains forbidden capability claim ${forbidden}`);
}

console.log(JSON.stringify({
  check: 'evavo-vector-repository-capability-registry',
  ok: errors.length === 0,
  capabilityCount: ids.size,
  mcpContractExpected: '1.6',
  errors,
}, null, 2));
if (errors.length) process.exitCode = 1;
