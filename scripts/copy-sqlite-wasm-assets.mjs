import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const SQLITE_WASM_ASSETS = ["index.mjs", "sqlite3.wasm"];

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));

export const installedPackageRoot = () => dirname(webRequire.resolve("@sqlite.org/sqlite-wasm/package.json"));

export const copySqliteWasmAssets = ({
  packageRoot = installedPackageRoot(),
  targetRoot = fileURLToPath(new URL("../apps/web/static/vendor/sqlite/", import.meta.url)),
} = {}) => {
  mkdirSync(targetRoot, { recursive: true });
  for (const asset of SQLITE_WASM_ASSETS) {
    copyFileSync(join(packageRoot, "dist", asset), join(targetRoot, asset));
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copySqliteWasmAssets();
}
