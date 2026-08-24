import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = async (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");
const compare = await source("./compare/+page.svelte");
const explorer = await source("./explorer/+page.svelte");
const glossary = await source("./glossary/+page.svelte");
const guide = await source("./guide/+page.svelte");
const privacy = await source("./privacy/+page.svelte");
const redirect = await source("../lib/LegacyRedirect.svelte");
const config = await source("../../svelte.config.js");

describe("standalone comparison route", () => {
  it("uses named local client methods and rejects stale comparison results", () => {
    expect(compare).toContain("client.versions({ framework: nextFramework })");
    expect(compare).toContain("client.compare(selection)");
    expect(compare).toContain("const compareRequests = new LatestRequest()");
    expect(compare).toContain("!compareRequests.isCurrent(request)");
    expect(compare).not.toMatch(/\bfetch\s*\(/);
  });

  it("keeps refresh-safe selection and filtered CSV export", () => {
    expect(compare).toContain('url.searchParams.set("from", from)');
    expect(compare).toContain('url.searchParams.set("to", to)');
    expect(compare).toContain("versionPairFromUrl(requestedUrl ?? new URL(window.location.href), result)");
    expect(compare).toContain("comparisonCsv(filtered)");
    expect(compare).toContain("URL.revokeObjectURL(objectUrl)");
  });

  it("keeps comparison tables horizontally scrollable and other routes vertically scrollable", () => {
    expect(compare).toContain("overflow-x: auto");
    expect(compare).toContain("min-width: 1120px");
    expect(compare).not.toContain("overflow: hidden");
    expect(explorer).not.toContain(":global(body)");
  });

  it("renders structured comparison changes without unsafe HTML", () => {
    expect(compare).toContain("<del>{part.text}</del>");
    expect(compare).toContain("<ins>{part.text}</ins>");
    expect(compare).not.toContain("{@html");
  });
});

describe("standalone glossary route", () => {
  it("reloads terms for every framework and loads selected term history locally", () => {
    expect(glossary).toContain("client.terms({ framework: nextFramework })");
    expect(glossary).toContain("client.term({ framework: requestFramework, id })");
    expect(glossary).toContain("loadTerms(item.id as FrameworkId)");
    expect(glossary).toContain("terms = []");
    expect(glossary).not.toMatch(/\bfetch\s*\(/);
  });

  it("removes stale term state when search or framework changes", () => {
    expect(glossary).toContain("selectedId = null");
    expect(glossary).toContain('url.searchParams.delete("term")');
    expect(glossary).toContain("clearDetail()");
    expect(glossary).toContain("No glossary terms are retained");
  });
});

describe("standalone information and compatibility routes", () => {
  it("removes operated-service claims from guide and privacy content", () => {
    expect(guide).toContain("No operated Rule1 backend");
    expect(guide).toContain("does not provide a runtime API, account system, community service, or bypass tokens");
    expect(privacy).toContain("Rule1 has no application backend receiving those queries");
    expect(privacy).not.toContain("login2.link42.app");
    expect(privacy).not.toContain("api.rule1.link42.app");
  });

  it("states the project licence without relicensing retained framework sources", () => {
    expect(guide).toContain("GNU Affero General Public License v3.0 or later");
    expect(guide).toContain("https://github.com/wan0net/rule1/blob/main/LICENSE");
    expect(guide).toContain("data/");
    expect(guide).toContain("are not relicensed by Rule1");
  });

  it("uses a base-path-aware static redirect component for legacy destinations", () => {
    expect(redirect).toContain('import { base } from "$app/paths"');
    expect(redirect).toContain("goto(href, { replaceState: true })");
    expect(redirect).toContain('<a class="error-state-link" {href}>');
  });

  it("generates a static 404 fallback", () => {
    expect(config).toContain('adapter({ fallback: "404.html" })');
  });
});
