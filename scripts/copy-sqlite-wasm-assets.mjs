import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const SQLITE_WASM_ASSETS = ["index.mjs", "sqlite3.wasm"];
export const SQLITE_WASM_LICENSE = "LICENSE-Apache-2.0.txt";
export const SQLITE_WASM_LICENSE_SOURCE = fileURLToPath(new URL("../LICENSES/Apache-2.0.txt", import.meta.url));

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));

export const installedPackageRoot = () => dirname(webRequire.resolve("@sqlite.org/sqlite-wasm/package.json"));

export const copySqliteWasmAssets = ({
  packageRoot = installedPackageRoot(),
  targetRoot = fileURLToPath(new URL("../apps/web/static/vendor/sqlite/", import.meta.url)),
  licensePath = SQLITE_WASM_LICENSE_SOURCE,
} = {}) => {
  mkdirSync(targetRoot, { recursive: true });
  for (const asset of SQLITE_WASM_ASSETS) {
    copyFileSync(join(packageRoot, "dist", asset), join(targetRoot, asset));
  }
  copyFileSync(licensePath, join(targetRoot, SQLITE_WASM_LICENSE));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copySqliteWasmAssets();
}
