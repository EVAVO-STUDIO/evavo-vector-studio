import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVectorMcpPathPolicy, VectorMcpPathError } from "./path-policy.js";

async function fixture(): Promise<Readonly<{ base: string; root: string; outside: string }>> {
  const base = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-policy-"));
  const root = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  await Promise.all([mkdir(root), mkdir(outside)]);
  return Object.freeze({ base, root, outside });
}

function code(expected: VectorMcpPathError["code"]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof VectorMcpPathError && error.code === expected;
}

test("resolves existing inputs and new nested outputs beneath an allowed root", async () => {
  const { base, root } = await fixture();
  try {
    const input = path.join(root, "source.png");
    await writeFile(input, "source", "utf8");
    const policy = await createVectorMcpPathPolicy({ cwd: root, allowedRoots: [root] });
    assert.equal(await policy.resolveInputFile("source.png"), input);
    assert.equal(
      await policy.resolveOutputFile(path.join("nested", "output.svg")),
      path.join(root, "nested", "output.svg"),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rejects inputs and outputs outside every allowed root", async () => {
  const { base, root, outside } = await fixture();
  try {
    const outsideInput = path.join(outside, "source.png");
    await writeFile(outsideInput, "source", "utf8");
    const policy = await createVectorMcpPathPolicy({ cwd: root, allowedRoots: [root] });
    await assert.rejects(() => policy.resolveInputFile(outsideInput), code("VECTOR_MCP_PATH_OUTSIDE_ROOT"));
    await assert.rejects(
      () => policy.resolveOutputFile(path.join(outside, "output.svg")),
      code("VECTOR_MCP_PATH_OUTSIDE_ROOT"),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rejects existing outputs and path collisions", async () => {
  const { base, root } = await fixture();
  try {
    const input = path.join(root, "source.svg");
    const output = path.join(root, "output.svg");
    await Promise.all([writeFile(input, "source", "utf8"), writeFile(output, "existing", "utf8")]);
    const policy = await createVectorMcpPathPolicy({ cwd: root, allowedRoots: [root] });
    await assert.rejects(() => policy.resolveOutputFile(output), code("VECTOR_MCP_OUTPUT_EXISTS"));
    assert.throws(() => policy.assertDistinct([input, input]), code("VECTOR_MCP_PATH_COLLISION"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rejects an output routed through a symlinked directory outside the root", async (context) => {
  const { base, root, outside } = await fixture();
  try {
    const linkPath = path.join(root, "escape");
    try {
      await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        context.skip("Symlink creation is unavailable in this environment.");
        return;
      }
      throw error;
    }
    const policy = await createVectorMcpPathPolicy({ cwd: root, allowedRoots: [root] });
    await assert.rejects(
      () => policy.resolveOutputFile(path.join(linkPath, "escaped.svg")),
      code("VECTOR_MCP_PATH_OUTSIDE_ROOT"),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
