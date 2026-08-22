import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const buildDirectory = resolve("apps/web/build");
const routes = [
  "",
  "about",
  "api",
  "bypass-eligibility",
  "changelog",
  "compare",
  "explorer",
  "glossary",
  "guide",
  "licence",
  "privacy",
];
const retiredRenderedHosts = ["api.rule1.link42.app", "login2.link42.app", "rule1.link42.app"];

const routeDocuments = await Promise.all(
  routes.map(async (route) => {
    const path = resolve(buildDirectory, route, "index.html");
    return { route: route ? `/rule1/${route}/` : "/rule1/", html: await readFile(path, "utf8") };
  }),
);
const fallback = await readFile(resolve(buildDirectory, "404.html"), "utf8");
const builtFiles = await readdir(buildDirectory, { recursive: true });
const renderedAssets = await Promise.all(
  builtFiles
    .filter((path) => path.endsWith(".html") || path.endsWith(".css"))
    .map((path) => readFile(resolve(buildDirectory, path), "utf8")),
);

await Promise.all([
  stat(resolve(buildDirectory, "favicon.svg")),
  stat(resolve(buildDirectory, "data/rule1.sqlite3")),
  stat(resolve(buildDirectory, "data/rule1-artifact-manifest.json")),
  stat(resolve(buildDirectory, "vendor/sqlite/index.mjs")),
  stat(resolve(buildDirectory, "vendor/sqlite/sqlite3.wasm")),
]);

const index = routeDocuments[0].html;
if (!index.includes('assets: "/rule1"')) {
  throw new Error("Static runtime does not retain the /rule1 base path.");
}
if (!index.includes('href="./_app/') && !index.includes('src="./_app/')) {
  throw new Error("Static entry does not reference its generated assets.");
}

for (const { route, html } of routeDocuments) {
  if (/\b(?:href|src)="\/(?!rule1(?:\/|"))/.test(html)) {
    throw new Error(`${route} contains a URL that escapes the /rule1/ base path.`);
  }
  for (const host of retiredRenderedHosts) {
    if (html.includes(host)) throw new Error(`${route} renders a link to retired host ${host}.`);
  }
}

if (/\b(?:href|src)="\/(?!rule1\/)/.test(fallback)) {
  throw new Error("Static not-found page contains a URL that escapes the /rule1/ base path.");
}
if (renderedAssets.some((asset) => /fonts\.(?:googleapis|gstatic)\.com/.test(asset))) {
  throw new Error("Static build contains an external Google Fonts request.");
}

console.log(
  `Verified ${routeDocuments.length} static routes, fallback, local database, and SQLite assets beneath /rule1/.`,
);
