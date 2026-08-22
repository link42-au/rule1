import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);

test("SQLite is the only workflow and publishes its verified build to Pages", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));
  assert.deepEqual(files, ["build-sqlite.yml"]);

  const workflow = readFileSync(new URL("build-sqlite.yml", WORKFLOWS), "utf8");
  const buildJob = workflow.slice(workflow.indexOf("  build-sqlite:"), workflow.indexOf("  deploy-pages:"));
  const deployJob = workflow.slice(workflow.indexOf("  deploy-pages:"));

  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(
    workflow,
    /write-artifact-manifest\.mjs[^\n]+apps\/web\/static\/data\/rule1-artifact-manifest\.json\n\s+pnpm build/,
  );
  assert.match(workflow, /apps\/web\/build\/data\/rule1-artifact-manifest\.json/);
  assert.match(workflow, / {12}ingestion\/validation-contract\.json/);
  assert.match(buildJob, /actions\/configure-pages@v5/);
  assert.match(buildJob, /actions\/upload-pages-artifact@v5/);
  assert.match(buildJob, /path: apps\/web\/build/);
  assert.doesNotMatch(buildJob, /pages:\s*write|id-token:\s*write/);

  const publicationCondition = /if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/g;
  assert.equal([...workflow.matchAll(publicationCondition)].length, 3);
  assert.match(deployJob, /needs: build-sqlite/);
  assert.match(deployJob, /pages:\s*write/);
  assert.match(deployJob, /id-token:\s*write/);
  assert.match(deployJob, /environment:\n\s+name: github-pages/);
  assert.match(deployJob, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  assert.match(deployJob, /actions\/deploy-pages@v5/);
});
