import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createArtifactManifest } from "./write-artifact-manifest.mjs";

test("artifact manifest records database size and both checksums", () => {
  const directory = mkdtempSync(join(tmpdir(), "rule1-artifact-"));
  const database = join(directory, "rule1.sqlite3");
  const contract = join(directory, "validation-contract.json");
  writeFileSync(database, "sqlite");
  writeFileSync(contract, "{}\n");
  const digest = (value) => createHash("sha256").update(value).digest("hex");

  assert.deepEqual(createArtifactManifest(database, contract), {
    format_version: 1,
    database: { path: "rule1.sqlite3", sha256: digest("sqlite"), size_bytes: 6 },
    validation_contract: {
      path: "ingestion/validation-contract.json",
      sha256: digest("{}\n"),
    },
  });
});
