import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const SITE = "https://rule1.link42.app/";
const REPOSITORY = "https://github.com/link42-au/rule1";
const BUG_REPORT = `${REPOSITORY}/issues/new?template=bug_report.yml`;
const SUGGESTION = `${REPOSITORY}/issues/new?template=feature_request.yml`;
const PRIVATE_SECURITY = `${REPOSITORY}/security/advisories/new`;

test("repository guidance documents hosting, technology, and durable feedback routes", () => {
  const readme = read("README.md");
  const contributing = read("CONTRIBUTING.md");

  for (const document of [readme, contributing]) {
    assert.match(document, /link42-au\/rule1/);
    assert.match(document, new RegExp(SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(document.includes(BUG_REPORT));
    assert.ok(document.includes(SUGGESTION));
    assert.ok(document.includes(PRIVATE_SECURITY));
  }

  assert.match(readme, /SvelteKit/);
  assert.match(readme, /TypeScript/);
  assert.match(readme, /SQLite WASM/);
  assert.match(readme, /Python ingestion pipeline/);
  assert.match(readme, /deterministic build/);
  assert.match(readme, /GitHub Pages/);
  assert.match(readme, /docs\/CONTAINER-DEPLOYMENT\.md/);
});

test("container deployment guidance covers publication, operation, updates, and rollback", () => {
  const deployment = read("docs/CONTAINER-DEPLOYMENT.md");

  assert.match(deployment, /ghcr\.io\/link42-au\/rule1/);
  assert.match(deployment, /package as private/);
  assert.match(deployment, /docker login ghcr\.io/);
  assert.match(deployment, /linux\/amd64/);
  assert.match(deployment, /linux\/arm64/);
  assert.match(deployment, /PUID/);
  assert.match(deployment, /PGID/);
  assert.match(deployment, /\/app\/www\/public/);
  assert.match(deployment, /docker compose pull rule1/);
  assert.match(deployment, /docker compose up -d --no-deps rule1/);
  assert.match(deployment, /Rollback is image-based/);
  assert.match(deployment, /not registry-enforced immutable/);
  assert.match(deployment, /ghcr\.io\/link42-au\/rule1@sha256:<index-digest>/);
  assert.match(deployment, /post-deploy-canary\.mjs/);
  assert.match(deployment, /33932765951/);
  assert.match(deployment, /2c3e6f7684e64373dbeaccbc9568a6f5543e03369f6919ee858b47b7105cea47/);
  assert.doesNotMatch(deployment, /\/app\/www\/public:\s*$/m);
});

test("issue forms route bugs and suggestions without enabling public security reports", () => {
  const bug = read(".github/ISSUE_TEMPLATE/bug_report.yml");
  const suggestion = read(".github/ISSUE_TEMPLATE/feature_request.yml");
  const config = read(".github/ISSUE_TEMPLATE/config.yml");

  assert.match(bug, /^name: Bug report$/m);
  assert.match(bug, /^ {2}- bug$/m);
  assert.match(bug, /^ {4}id: reproduction$/m);
  assert.match(bug, /^ {4}id: environment$/m);
  assert.match(bug, /private security reporting link/);

  assert.match(suggestion, /^name: Improvement suggestion$/m);
  assert.match(suggestion, /^ {2}- enhancement$/m);
  assert.match(suggestion, /^ {4}id: problem$/m);
  assert.match(suggestion, /^ {4}id: outcome$/m);

  assert.match(config, /^blank_issues_enabled: false$/m);
  assert.ok(config.includes(`url: ${SITE}`));
  assert.ok(config.includes(`url: ${PRIVATE_SECURITY}`));
  assert.doesNotMatch(config, /blank_issues_enabled: true/);
});
