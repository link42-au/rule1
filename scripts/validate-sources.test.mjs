import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { validateSourceLedger } from "./validate-sources.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rule1-sources-"));
  await mkdir(join(root, "data/test"), { recursive: true });
  const content = "approved source\n";
  await writeFile(join(root, "data/test/source.txt"), content);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const ledger = {
    sources: [
      {
        framework: "test",
        version: "1",
        date: "2026-01-01",
        path: "data/test/source.txt",
        origin: "https://example.test/source",
        sha256,
      },
    ],
  };
  await writeFile(join(root, "data/source-ledger.json"), `${JSON.stringify(ledger)}\n`);
  return root;
}

test("accepts the committed source archive", async () => {
  assert.equal(await validateSourceLedger(process.cwd()), 81);
});

test("rejects a changed source", async () => {
  const root = await fixture();
  await writeFile(join(root, "data/test/source.txt"), "changed\n");
  await assert.rejects(validateSourceLedger(root), /Checksum mismatch/);
});

test("rejects an unrecorded source", async () => {
  const root = await fixture();
  await writeFile(join(root, "data/test/extra.txt"), "extra\n");
  await assert.rejects(validateSourceLedger(root), /file set does not match/);
});
