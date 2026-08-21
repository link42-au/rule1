import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const buildDirectory = resolve("apps/web/build");
const indexPath = resolve(buildDirectory, "index.html");
const index = await readFile(indexPath, "utf8");

await stat(resolve(buildDirectory, "favicon.svg"));

if (!index.includes('assets: "/rule1"')) {
  throw new Error("Static runtime does not retain the /rule1 base path.");
}

if (!index.includes('href="./_app/') && !index.includes('src="./_app/')) {
  throw new Error("Static entry does not reference its generated assets.");
}

if (index.includes('src="/_app/') || index.includes('href="/_app/')) {
  throw new Error("Static entry contains an asset URL that escapes the /rule1/ base path.");
}

console.log("Static /rule1/ entry and assets verified.");
