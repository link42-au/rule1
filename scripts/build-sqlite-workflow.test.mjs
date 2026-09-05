import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);

test("SQLite workflow publishes its verified build to Pages", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));
  assert.deepEqual(files, ["build-sqlite.yml", "generate-annotations.yml"]);

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
  assert.equal([...workflow.matchAll(publicationCondition)].length, 4);
  assert.match(buildJob, /python -m rule1_ingest\.annotations check[\s\S]*--require-complete/);
  assert.match(buildJob, /--require-complete-annotations/);
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

test("annotation generation is manual, secret-scoped, checkpointed, and review-gated", () => {
  const workflow = readFileSync(new URL("generate-annotations.yml", WORKFLOWS), "utf8");
  const annotationGeneration = workflow.slice(
    0,
    workflow.indexOf("      - name: Generate conservative mitigation canary"),
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /generation_target:[\s\S]*default: annotations[\s\S]*- mitigation-mappings[\s\S]*- mitigation-canary/,
  );
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /permissions:\n\s+actions: write\n\s+contents: write\n\s+pull-requests: write/);
  assert.match(workflow, /OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/);
  assert.equal(annotationGeneration.match(/OPENROUTER_API_KEY/g)?.length, 3);
  assert.match(workflow, /ref: \$\{\{ github\.ref_name \}\}/);
  assert.match(workflow, /--batch-size 1/);
  assert.match(workflow, /--require-complete/);
  assert.match(workflow, /--write-contract/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /git add -- annotations\/ism\.json ingestion\/validation-contract\.json/);
  assert.match(workflow, /gh pr create/);
  assert.match(workflow, /gh workflow run build-sqlite\.yml --ref "\$branch"/);
  assert.doesNotMatch(workflow, /OPENROUTER_API_KEY:\s*sk-/);
});

test("mitigation backfill uses eight recoverable shards and a fail-closed merge", () => {
  const workflow = readFileSync(new URL("generate-annotations.yml", WORKFLOWS), "utf8");
  const shards = workflow.slice(
    workflow.indexOf("  mitigation-shards:"),
    workflow.indexOf("  merge-mitigation-shards:"),
  );
  const merge = workflow.slice(workflow.indexOf("  merge-mitigation-shards:"));

  assert.match(shards, /if: inputs\.generation_target == 'mitigation-mappings'/);
  assert.match(shards, /permissions:\n\s+actions: write\n\s+contents: read/);
  assert.match(shards, /fail-fast: false/);
  assert.match(shards, /shard: \[0, 1, 2, 3, 4, 5, 6, 7\]/);
  assert.match(shards, /OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/);
  assert.match(shards, /python -m rule1_ingest\.mitigation_mappings generate-shard/);
  assert.match(shards, /--shard-index \$\{\{ matrix\.shard \}\}/);
  assert.match(shards, /--tracked-cache mappings\/ism-attack-mitigation-assessments\.json/);
  assert.match(shards, /--cache build\/mitigation-shards\/shard-\$\{\{ matrix\.shard \}\}\.json/);
  assert.match(shards, /--batch-size 20/);
  assert.match(shards, /- name: Retain shard checkpoint\n\s+if: always\(\)/);
  assert.match(shards, /name: ism-attack-mitigation-shard-\$\{\{ matrix\.shard \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(shards, /path: build\/mitigation-shards\/shard-\$\{\{ matrix\.shard \}\}\.json/);

  assert.match(merge, /if: always\(\) && inputs\.generation_target == 'mitigation-mappings'/);
  assert.match(merge, /needs: mitigation-shards/);
  assert.match(merge, /permissions:\n\s+actions: write\n\s+contents: read/);
  assert.match(merge, /continue-on-error: true[\s\S]*actions\/download-artifact@v4/);
  assert.match(merge, /pattern: ism-attack-mitigation-shard-\*-\$\{\{ github\.run_id \}\}/);
  assert.match(merge, /merge-multiple: true/);
  assert.match(merge, /python -m rule1_ingest\.mitigation_mappings merge-shards/);
  assert.match(merge, /--shard-dir build\/mitigation-shards/);
  assert.equal(merge.match(/--require-complete/g)?.length, 1);
  assert.match(merge, /if: needs\.mitigation-shards\.result == 'success'[\s\S]*--require-complete/);
  assert.match(merge, /- name: Retain combined mitigation checkpoint\n\s+if: always\(\)/);
  assert.match(merge, /name: ism-attack-mitigation-combined-\$\{\{ github\.run_id \}\}/);

  const mitigationJobs = `${shards}\n${merge}`;
  assert.doesNotMatch(mitigationJobs, /git (?:switch|add|commit|push)/);
  assert.doesNotMatch(mitigationJobs, /gh (?:pr|workflow)/);
  assert.doesNotMatch(mitigationJobs, /deploy-pages|upload-pages-artifact|pages:\s*write/);
  assert.doesNotMatch(mitigationJobs, /python -m rule1_ingest\.(?:build|validate)/);
});

test("mitigation canary uses a fixed isolated cache and retains verified evidence", () => {
  const workflow = readFileSync(new URL("generate-annotations.yml", WORKFLOWS), "utf8");
  const canary = workflow.slice(
    workflow.indexOf("      - name: Generate conservative mitigation canary"),
    workflow.indexOf("  mitigation-shards:"),
  );

  assert.match(canary, /if: inputs\.generation_target == 'mitigation-canary'/);
  assert.match(canary, /python -m rule1_ingest\.mitigation_mappings generate-canary/);
  assert.match(canary, /--cache build\/ism-attack-mitigation-canary\.json/);
  assert.match(canary, /--batch-size 7/);
  assert.match(canary, /if: always\(\) && inputs\.generation_target == 'mitigation-canary'/);
  assert.match(canary, /name: ism-attack-mitigation-canary-\$\{\{ github\.run_id \}\}/);
  assert.match(canary, /python -m rule1_ingest\.mitigation_mappings verify-canary/);
  assert.doesNotMatch(canary, /mappings\/ism-attack-mitigation-assessments\.json/);
  assert.doesNotMatch(canary, /git (?:switch|add|commit|push)|gh (?:pr|workflow)/);
});
