import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);

test("SQLite workflow publishes its verified build to Pages", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));
  assert.deepEqual(files, ["build-sqlite.yml", "generate-annotations.yml"]);

  const workflow = readFileSync(new URL("build-sqlite.yml", WORKFLOWS), "utf8");
  const buildJob = workflow.slice(workflow.indexOf("  build-sqlite:"), workflow.indexOf("  deploy-pages:"));
  const deployJob = workflow.slice(workflow.indexOf("  deploy-pages:"), workflow.indexOf("  publish-container:"));
  const containerJob = workflow.slice(workflow.indexOf("  publish-container:"));
  const verifyPosition = buildJob.indexOf("run: pnpm verify");
  const repeatBuildPosition = buildJob.indexOf("--output build/rule1-repeat.sqlite3");
  const artifactPosition = buildJob.indexOf("actions/upload-artifact@v4");
  const pagesArtifactPosition = buildJob.indexOf(
    "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
  );

  const mainPushTrigger = workflow.slice(workflow.indexOf("  push:"), workflow.indexOf("  pull_request:"));
  for (const deployablePath of [
    ".dockerignore",
    ".github/workflows/build-sqlite.yml",
    "Dockerfile",
    "annotations/**",
    "apps/web/**",
    "data/**",
    "deploy/container/**",
    "ingestion/**",
    "package.json",
    "packages/**",
    "pnpm-lock.yaml",
    "pyproject.toml",
    "scripts/write-artifact-manifest.mjs",
    "uv.lock",
  ]) {
    assert.match(mainPushTrigger, new RegExp(`^ {6}- ${deployablePath.replaceAll("*", "\\*")}$`, "m"));
  }
  for (const nonDeployablePath of ["README.md", "PLAN.md", "docs/**", "scripts/*.test.mjs", "e2e/**"]) {
    assert.doesNotMatch(mainPushTrigger, new RegExp(nonDeployablePath.replaceAll("*", "\\*")));
  }
  assert.match(workflow, /^ {2}pull_request:$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);

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
  assert.match(buildJob, /--build-arg "BUILD_DATE=\$\(date -u/);
  assert.match(buildJob, /--build-arg "VERSION=\$\{GITHUB_SHA\}"/);
  assert.match(buildJob, /--build-arg "VCS_REF=\$\{GITHUB_SHA\}"/);
  assert.match(buildJob, /docker run --detach --publish 127\.0\.0\.1:18080:80 rule1:ci/);
  assert.match(buildJob, /node scripts\/post-deploy-canary\.mjs[\s\S]*http:\/\/127\.0\.0\.1:18080\//);
  assert.match(buildJob, /name: rule1-container-site[\s\S]*path: apps\/web\/build/);
  assert.match(buildJob, /actions\/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5/);
  assert.match(buildJob, /actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5/);
  assert.match(buildJob, /path: apps\/web\/build/);
  assert.doesNotMatch(buildJob, /pages:\s*write|id-token:\s*write/);

  const publicationCondition = /if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/g;
  assert.equal([...workflow.matchAll(publicationCondition)].length, 6);
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

  assert.match(containerJob, /needs: build-sqlite/);
  assert.match(containerJob, /packages:\s*write/);
  assert.doesNotMatch(containerJob, /contents:\s*write/);
  assert.match(containerJob, /name: rule1-container-site\n\s+path: apps\/web\/build/);
  assert.match(containerJob, /images: ghcr\.io\/\$\{\{ github\.repository \}\}/);
  assert.match(containerJob, /type=raw,value=latest/);
  assert.match(containerJob, /type=sha,format=long,prefix=sha-/);
  assert.match(containerJob, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(containerJob, /push: true/);
  assert.match(containerJob, /provenance: false/);
  assert.match(containerJob, /sbom: false/);
  assert.match(containerJob, /BUILD_DATE=\$\{\{ github\.event\.repository\.updated_at \}\}/);
  assert.match(containerJob, /VERSION=\$\{\{ github\.sha \}\}/);
  assert.match(containerJob, /VCS_REF=\$\{\{ github\.sha \}\}/);
});

test("annotation generation is manual, secret-scoped, checkpointed, and review-gated", () => {
  const workflow = readFileSync(new URL("generate-annotations.yml", WORKFLOWS), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /permissions:\n\s+actions: write\n\s+contents: write\n\s+pull-requests: write/);
  assert.match(workflow, /OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/);
  assert.equal(workflow.match(/OPENROUTER_API_KEY/g)?.length, 3);
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
