import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  copySqliteWasmAssets,
  installedPackageRoot,
  SQLITE_WASM_ASSETS,
  SQLITE_WASM_LICENSE,
  SQLITE_WASM_LICENSE_SOURCE,
} from "./copy-sqlite-wasm-assets.mjs";

test("copies the official SQLite runtime and its Apache licence", () => {
  const directory = mkdtempSync(join(tmpdir(), "rule1-sqlite-wasm-"));
  const packageRoot = installedPackageRoot();
  const targetRoot = join(directory, "static");

  copySqliteWasmAssets({ packageRoot, targetRoot });

  assert.equal(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version, "3.53.0-build1");
  assert.deepEqual(SQLITE_WASM_ASSETS, ["index.mjs", "sqlite3.wasm"]);
  for (const asset of SQLITE_WASM_ASSETS) {
    assert.deepEqual(readFileSync(join(targetRoot, asset)), readFileSync(join(packageRoot, "dist", asset)));
  }
  const copiedLicense = readFileSync(join(targetRoot, SQLITE_WASM_LICENSE), "utf8");
  assert.equal(copiedLicense, readFileSync(SQLITE_WASM_LICENSE_SOURCE, "utf8"));
  assert.match(copiedLicense, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(copiedLicense, /http:\/\/www\.apache\.org\/licenses\//);
  assert.equal(existsSync(join(targetRoot, "node.mjs")), false);
});
