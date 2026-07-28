import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commitNewVectorFiles, VectorMcpFileCommitError } from "./file-transaction.js";

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-mcp-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("commits multiple new files and returns byte and SHA-256 receipts", async () => {
  await withTempDirectory(async (directory) => {
    const svgPath = path.join(directory, "output", "mark.svg");
    const pngPath = path.join(directory, "output", "mark.diff.png");
    const svg = '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>\n';
    const png = Uint8Array.from([137, 80, 78, 71]);
    const receipts = await commitNewVectorFiles([
      { path: svgPath, data: svg, mimeType: "image/svg+xml" },
      { path: pngPath, data: png, mimeType: "image/png" },
    ]);

    assert.equal(receipts.length, 2);
    assert.equal(await readFile(svgPath, "utf8"), svg);
    assert.deepEqual([...await readFile(pngPath)], [...png]);
    assert.equal(receipts[0]?.bytes, Buffer.byteLength(svg));
    assert.equal(receipts[0]?.sha256, createHash("sha256").update(svg).digest("hex"));
    assert.equal(receipts[1]?.sha256, createHash("sha256").update(png).digest("hex"));
  });
});

test("never overwrites and rolls back files already committed in the same transaction", async () => {
  await withTempDirectory(async (directory) => {
    const firstPath = path.join(directory, "first.svg");
    const occupiedPath = path.join(directory, "occupied.svg");
    await writeFile(occupiedPath, "existing", "utf8");

    await assert.rejects(
      () => commitNewVectorFiles([
        { path: firstPath, data: "first", mimeType: "image/svg+xml" },
        { path: occupiedPath, data: "replacement", mimeType: "image/svg+xml" },
      ]),
      (error: unknown) => error instanceof VectorMcpFileCommitError,
    );

    await assert.rejects(() => readFile(firstPath), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    assert.equal(await readFile(occupiedPath, "utf8"), "existing");
  });
});

test("rejects duplicate outputs before staging", async () => {
  await withTempDirectory(async (directory) => {
    const outputPath = path.join(directory, "same.svg");
    await assert.rejects(
      () => commitNewVectorFiles([
        { path: outputPath, data: "one", mimeType: "image/svg+xml" },
        { path: path.join(directory, ".", "same.svg"), data: "two", mimeType: "image/svg+xml" },
      ]),
      (error: unknown) => error instanceof VectorMcpFileCommitError,
    );
  });
});
