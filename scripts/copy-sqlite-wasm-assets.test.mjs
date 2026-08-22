import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { copySqliteWasmAssets, installedPackageRoot, SQLITE_WASM_ASSETS } from "./copy-sqlite-wasm-assets.mjs";

test("copies only the official SQLite module and WASM bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "rule1-sqlite-wasm-"));
  const packageRoot = installedPackageRoot();
  const targetRoot = join(directory, "static");

  copySqliteWasmAssets({ packageRoot, targetRoot });

  assert.equal(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version, "3.53.0-build1");
  assert.deepEqual(SQLITE_WASM_ASSETS, ["index.mjs", "sqlite3.wasm"]);
  for (const asset of SQLITE_WASM_ASSETS) {
    assert.deepEqual(readFileSync(join(targetRoot, asset)), readFileSync(join(packageRoot, "dist", asset)));
  }
  assert.equal(existsSync(join(targetRoot, "node.mjs")), false);
});
