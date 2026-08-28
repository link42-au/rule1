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
