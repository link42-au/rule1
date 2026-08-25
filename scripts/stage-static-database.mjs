import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

import { createArtifactManifest } from "./write-artifact-manifest.mjs";

const source = "build/rule1.sqlite3";
const contract = "ingestion/validation-contract.json";
const directory = "apps/web/static/data";
const database = `${directory}/rule1.sqlite3`;
const manifest = `${directory}/rule1-artifact-manifest.json`;

mkdirSync(directory, { recursive: true });
copyFileSync(source, database);
writeFileSync(manifest, `${JSON.stringify(createArtifactManifest(database, contract), null, 2)}\n`);
