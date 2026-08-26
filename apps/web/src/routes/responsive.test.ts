import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = async (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");

const brand = await source("../brand.css");
const layout = await source("./+layout.svelte");
const landing = await source("./+page.svelte");
const compare = await source("./compare/+page.svelte");
const glossary = await source("./glossary/+page.svelte");
const guide = await source("./guide/+page.svelte");
const privacy = await source("./privacy/+page.svelte");
const splash = await source("../lib/DatabaseLoadingSplash.svelte");
const header = await source("../../../../packages/ui/src/Header.svelte");
const platformBar = await source("../../../../packages/ui/src/PlatformBar.svelte");

describe("responsive shell and retained routes", () => {
  it("does not impose a desktop-width floor on the document", () => {
    expect(brand).not.toMatch(/body\s*{[^}]*min-width\s*:\s*960px/s);
    expect(brand).toMatch(/main\s*{[^}]*min-width\s*:\s*0/s);
    expect(layout).toContain('<main id="main-content">');
  });

  it("provides a compact phone shell with navigation and search", () => {
    expect(header).toContain("@media (max-width: 640px)");
    expect(header).toContain('class="mobile-search-form"');
    expect(header).toContain('class="mobile-search-input"');
    expect(header).toContain("handleMobileSearchSubmit");
    expect(platformBar).toContain("@media (max-width: 640px)");
    expect(platformBar).toMatch(/\.pb-nav\s*{[^}]*gap:\s*6px/s);
  });

  it("lets landing content and its controls shrink and wrap", () => {
    expect(landing).toMatch(/\.landing\s*{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
    expect(landing).toMatch(/\.landing-fw-bar\s*{[^}]*flex-wrap:\s*wrap/s);
    expect(landing).toMatch(/\.landing-search-input\s*{[^}]*min-width:\s*0/s);
    expect(landing).toContain("@media (max-width: 640px)");
  });

  it("contains wide comparison data inside its own scroll region", () => {
    expect(compare).toMatch(/\.cmp-results\s*{[^}]*overflow-x:\s*auto/s);
    expect(compare).toContain("min-width: 1300px");
    expect(compare).toMatch(/@media \(max-width: 720px\)[\s\S]*\.cmp-results\s*{\s*max-width:\s*100%/);
    expect(compare).not.toMatch(/\.compare-page\s*{[^}]*overflow-x:\s*auto/s);
  });

  it("stacks glossary content and preserves narrow information pages", () => {
    expect(glossary).toMatch(/@media \(max-width: 720px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(glossary).toMatch(/\.search-row input\s*{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
    for (const page of [guide, privacy]) {
      expect(page).toContain("@media (max-width: 640px)");
      expect(page).toContain("padding: 32px 16px 48px");
    }
  });

  it("keeps the loading card within a phone viewport", () => {
    expect(splash).toContain("@media (max-width: 480px)");
    expect(splash).toMatch(
      /\.database-card\s*{[^}]*width:\s*100%[^}]*max-height:\s*calc\(100vh - 32px\)[^}]*overflow-y:\s*auto/s,
    );
  });
});
