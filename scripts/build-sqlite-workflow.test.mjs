import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);

test("SQLite is the only workflow and cannot deploy Pages", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));
  assert.deepEqual(files, ["build-sqlite.yml"]);

  const workflow = readFileSync(new URL("build-sqlite.yml", WORKFLOWS), "utf8");
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(
    workflow,
    /write-artifact-manifest\.mjs[^\n]+apps\/web\/static\/data\/rule1-artifact-manifest\.json\n\s+pnpm build/,
  );
  assert.match(workflow, /apps\/web\/build\/data\/rule1-artifact-manifest\.json/);
  assert.match(workflow, / {12}ingestion\/validation-contract\.json/);
  assert.doesNotMatch(workflow, /deploy-pages|upload-pages-artifact|configure-pages|pages:\s*write/);
  assert.doesNotMatch(workflow, /environment:\s*github-pages/);
});
