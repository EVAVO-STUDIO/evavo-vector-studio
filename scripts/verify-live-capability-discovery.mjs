#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const TARGET = "scripts/verify-live-capability-discovery-current.mjs";
const result = spawnSync(process.execPath, [TARGET, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});

if (result.error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: "LIVE_CAPABILITIES_COMPAT_LAUNCH_FAILED",
    message: result.error.message,
    target: TARGET,
    responseBodyRecorded: false,
    sensitiveValuesRecorded: false,
  })}\n`);
  process.exit(1);
}

process.exit(typeof result.status === "number" ? result.status : 1);
