import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");
const layout = await readFile(new URL("../+layout.svelte", import.meta.url), "utf8");

describe("Enterprise ATT&CK catalogue route", () => {
  it("is a top-level, browser-local catalogue route", () => {
    expect(layout).toContain('{ href: appPath("/attack/"), label: "ATT&CK" }');
    expect(layout).toContain('"/attack"');
    expect(source).toContain("client.attackCatalogue()");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toContain('href="https://rule1.link42.app/attack/"');
  });

  it("persists Navigator-style search and additive filters in the URL", () => {
    expect(source).toContain("readAttackCatalogueUrl(url, result.techniques)");
    expect(source).toContain("writeAttackCatalogueUrl(new URL(window.location.href)");
    expect(source).toContain("filterAttackTechniques(result.techniques");
  });

  it("keeps every technique visible by default and offers explicit coverage filters", () => {
    expect(source).toContain('let coverage = $state<AttackCoverageFilter>("all")');
    expect(source).toContain("let showSubtechniques = $state(true)");
    expect(source).toContain('{ value: "mitigated", label: "Has mitigations" }');
    expect(source).toContain('{ value: "controls", label: "Has reviewed ISM controls" }');
    expect(source).toContain("No techniques match these filters.");
  });

  it("presents official mitigation relationships before reviewed ISM controls", () => {
    expect(source).toContain("Official relationships");
    expect(source).toContain("mitigation.relationshipDescription");
    expect(source).toContain("mitigation.description");
    expect(source).toContain("Relationship to this technique");
    expect(source).toContain("Reviewed ISM controls enabling this mitigation");
    expect(source).toContain("No reviewed ISM controls currently enable this mitigation.");
    expect(source).toContain('new URLSearchParams({ framework: "ism", id: controlId, tab: "attack" })');
    expect(source).toContain("safeMitreUrl(selectedTechnique.url)");
    expect(source).toContain("safeMitreUrl(mitigation.url)");
    expect(source).not.toContain("{@html");
  });

  it("keeps the full technique description in a collapsed native disclosure", () => {
    expect(source).toContain('<details class="description-disclosure">');
    expect(source).toContain("Technique description (${wordCount(selectedTechnique.description)} words)");
    expect(source).toContain('<p class="technique-description">{selectedTechnique.description}</p>');
    expect(source).not.toContain('<details class="description-disclosure" open');
  });

  it("exposes filter and selection state to assistive technology", () => {
    expect(source).toContain('aria-labelledby="filter-heading"');
    expect(source).toContain("aria-pressed={selectedTactics.includes(tactic)}");
    expect(source).toContain("aria-pressed={selectedPlatforms.includes(platform)}");
    expect(source).toContain("aria-pressed={coverage === option.value}");
    expect(source).toContain("aria-pressed={selectedId === technique.techniqueId}");
    expect(source).toContain('data-technique-detail tabindex="-1"');
    expect(source).toContain('role="alert"');
  });

  it("stacks the browser and detail panel without imposing a mobile width floor", () => {
    expect(source).toContain("@media (max-width: 900px)");
    expect(source).toMatch(/@media \(max-width: 900px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(source).toContain("@media (max-width: 640px)");
    expect(source).toMatch(/\.attack-page\s*\{[^}]*min-width: 0/);
    expect(source).not.toMatch(/min-width:\s*(?:[7-9]\d\d|\d{4,})px/);
  });
});
