import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CliOutputTransactionError, commitNewOutputFiles } from "./output-transaction.js";

async function temporary(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evavo-vector-cli-output-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("commits new multi-file output with SHA-256 receipts", async () => {
  await temporary(async (directory) => {
    const svgPath = path.join(directory, "mark.svg");
    const evidencePath = path.join(directory, "mark.evidence.json");
    const receipts = await commitNewOutputFiles([
      { path: svgPath, data: "<svg/>\n", mimeType: "image/svg+xml" },
      { path: evidencePath, data: "{}\n", mimeType: "application/json" },
    ]);
    assert.equal(receipts.length, 2);
    assert.equal(await readFile(svgPath, "utf8"), "<svg/>\n");
    assert.equal(await readFile(evidencePath, "utf8"), "{}\n");
    assert.match(receipts[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  });
});

test("does not overwrite and rolls back an earlier file in the transaction", async () => {
  await temporary(async (directory) => {
    const firstPath = path.join(directory, "first.svg");
    const occupiedPath = path.join(directory, "occupied.json");
    await writeFile(occupiedPath, "existing", "utf8");
    await assert.rejects(
      () => commitNewOutputFiles([
        { path: firstPath, data: "first", mimeType: "image/svg+xml" },
        { path: occupiedPath, data: "replacement", mimeType: "application/json" },
      ]),
      (error: unknown) => error instanceof CliOutputTransactionError,
    );
    await assert.rejects(
      () => readFile(firstPath),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    assert.equal(await readFile(occupiedPath, "utf8"), "existing");
  });
});
