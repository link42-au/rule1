import { createHash } from "node:crypto";
import { statSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export const createArtifactManifest = (databasePath, contractPath) => ({
  format_version: 1,
  database: {
    path: basename(databasePath),
    sha256: sha256(databasePath),
    size_bytes: statSync(databasePath).size,
  },
  validation_contract: {
    path: "ingestion/validation-contract.json",
    sha256: sha256(contractPath),
  },
});

if (process.argv[1]?.endsWith("write-artifact-manifest.mjs")) {
  const [, , databasePath, contractPath, outputPath] = process.argv;
  if (!databasePath || !contractPath || !outputPath) {
    throw new Error("usage: write-artifact-manifest.mjs DATABASE CONTRACT OUTPUT");
  }
  writeFileSync(outputPath, `${JSON.stringify(createArtifactManifest(databasePath, contractPath), null, 2)}\n`);
}
