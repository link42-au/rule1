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
  const verifyPosition = buildJob.indexOf("run: pnpm verify");
  const repeatBuildPosition = buildJob.indexOf("--output build/rule1-repeat.sqlite3");
  const artifactPosition = buildJob.indexOf("actions/upload-artifact@v4");
  const pagesArtifactPosition = buildJob.indexOf(
    "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
  );

  assert.match(workflow, /pnpm exec playwright install --with-deps chromium/);
  assert.match(buildJob, /run: pnpm validate:sources/);
  assert.equal(buildJob.match(/run: pnpm verify/g)?.length, 1);
  assert.ok(verifyPosition > 0, "the complete verification command must run in the build job");
  assert.ok(repeatBuildPosition > verifyPosition, "the repeat database build must follow the verified primary build");
  assert.ok(artifactPosition > repeatBuildPosition, "artifacts must only be uploaded after determinism passes");
  assert.ok(pagesArtifactPosition > artifactPosition, "the Pages artifact must use the verified build");
  assert.match(buildJob, /UV_FROZEN: "true"\n\s+run: pnpm verify/);
  assert.match(buildJob, /cmp --silent build\/rule1\.sqlite3 build\/rule1-repeat\.sqlite3/);
  assert.match(buildJob, /cmp --silent build\/rule1\.sqlite3 apps\/web\/static\/data\/rule1\.sqlite3/);
  assert.match(buildJob, /cmp --silent build\/rule1\.sqlite3 apps\/web\/build\/data\/rule1\.sqlite3/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /apps\/web\/build\/data\/rule1-artifact-manifest\.json/);
  assert.match(workflow, / {12}ingestion\/validation-contract\.json/);
  assert.match(workflow, / {12}scripts\/post-deploy-canary\.mjs/);
  assert.match(buildJob, /actions\/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5/);
  assert.match(buildJob, /actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5/);
  assert.match(buildJob, /path: apps\/web\/build/);
  assert.doesNotMatch(buildJob, /pages:\s*write|id-token:\s*write/);

  const publicationCondition = /if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/g;
  assert.equal([...workflow.matchAll(publicationCondition)].length, 3);
  assert.match(deployJob, /needs: build-sqlite/);
  assert.match(deployJob, /actions:\s*read/);
  assert.match(deployJob, /pages:\s*write/);
  assert.match(deployJob, /id-token:\s*write/);
  assert.doesNotMatch(deployJob, /contents:\s*write/);
  assert.match(deployJob, /environment:\n\s+name: github-pages/);
  assert.match(deployJob, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  assert.match(deployJob, /actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5/);
  assert.match(deployJob, /actions\/setup-node@v4/);
  assert.match(deployJob, /node-version: 22\.23\.1/);
  assert.match(deployJob, /actions\/download-artifact@v4/);
  assert.match(deployJob, /name: rule1-sqlite\n\s+path: \.canary/);
  assert.match(
    deployJob,
    /node \.canary\/scripts\/post-deploy-canary\.mjs\n\s+"\$\{\{ steps\.deployment\.outputs\.page_url \}\}"\n\s+\.canary\/apps\/web\/build\/data\/rule1-artifact-manifest\.json/,
  );
  assert.ok(
    deployJob.indexOf("post-deploy-canary.mjs") > deployJob.indexOf("actions/deploy-pages@v5"),
    "the deployed-origin canary must run after Pages deployment",
  );
});
