import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = async (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");

const tokens = await source("../../../../packages/tokens/src/tokens.css");
const brand = await source("../brand.css");
const reset = await source("../../../../packages/tokens/src/reset.css");
const header = await source("../../../../packages/ui/src/Header.svelte");
const layout = await source("./+layout.svelte");
const landing = await source("./+page.svelte");
const explorer = await source("./explorer/+page.svelte");
const compare = await source("./compare/+page.svelte");
const glossary = await source("./glossary/+page.svelte");
const tree = await source("../lib/explorer/ControlTree.svelte");
const context = await source("../lib/explorer/ContextPanel.svelte");
const attack = await source("../lib/explorer/AttackPanel.svelte");
const splash = await source("../lib/DatabaseLoadingSplash.svelte");

const luminance = (hex: string): number => {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (foreground: string, background: string): number => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe("WCAG interaction and presentation repairs", () => {
  it("keeps essential light and dark text and status tokens above 4.5:1", () => {
    for (const [foreground, background] of [
      ["#78716c", "#ffffff"],
      ["#78716c", "#f8f8f7"],
      ["#15803d", "#ffffff"],
      ["#15803d", "#f0fdf4"],
      ["#92400e", "#ffffff"],
      ["#92400e", "#fffbeb"],
      ["#b91c1c", "#ffffff"],
      ["#b91c1c", "#fef2f2"],
      ["#8a8984", "#111110"],
      ["#8a8984", "#1c1c1b"],
      ["#22c55e", "#14291e"],
      ["#f59e0b", "#2c2009"],
      ["#ef4444", "#2c1515"],
      ["#a78bfa", "#1e1730"],
      ["#60a5fa", "#2c2c2b"],
      ["#60a5fa", "#1e2e4a"],
      ["#2563eb", "#eff6ff"],
      ["#2563eb", "#ffffff"],
      ["#ffffff", "#2563eb"],
    ]) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const value of ["#78716c", "#15803d", "#92400e", "#b91c1c", "#8a8984"]) {
      expect(tokens).toContain(value);
    }
    expect(explorer).toContain(
      '.applicability-pill[data-applicability="C"].active { background: #15803d; color: white; }',
    );
    expect(brand).toContain("--accent-text: #60a5fa");
    expect(brand).toContain("--accent-solid: #2563eb");
    expect(tree).toMatch(/\.ctrl-row-id\s*\{[\s\S]*?color: var\(--accent-text\)/);
    expect(explorer).toMatch(/\.framework-pill\.active\s*\{[\s\S]*?background: var\(--accent-solid\)/);
    expect(explorer).toMatch(/\.tag-count\s*\{[\s\S]*?color: var\(--accent-text\)/);
    expect(landing).toMatch(/\.landing-fw-pill\.active\s*\{[\s\S]*?background: var\(--accent-solid\)/);
    expect(compare).toMatch(/\.fw-pill\.active,[\s\S]*?background: var\(--accent-solid\)/);
    expect(compare).toMatch(/\.fw-country\s*\{[^}]*color: var\(--text-dim\)[^}]*\}/);
    expect(compare).toContain(".fw-pill.active .fw-country { color: var(--accent-solid-text); }");
    expect(compare).not.toMatch(/\.fw-country\s*\{[^}]*opacity:/);
    expect(compare).toMatch(/\.e8-chip\s*\{[^}]*color: var\(--accent-text\)[^}]*\}/);
    expect(compare).toMatch(/\.e8-old \.e8-chip\s*\{[^}]*border-style: dashed[^}]*background: transparent[^}]*\}/);
    expect(compare).not.toMatch(/\.e8-old\s*\{[^}]*opacity:/);
    expect(landing).toMatch(/\.landing-fw-country\s*\{[^}]*color: var\(--text-dim\)[^}]*\}/);
    expect(landing).toMatch(
      /\.landing-fw-pill\.active \.landing-fw-country\s*\{[^}]*color: var\(--accent-solid-text\)[^}]*\}/,
    );
    expect(landing).not.toMatch(/\.landing-fw-country\s*\{[^}]*opacity:/);
  });

  it("identifies current navigation and pressed filter state", () => {
    expect(header).toContain('aria-label="Primary navigation"');
    expect(header).toContain('aria-current={activePath === item.href ? "page" : undefined}');
    for (const route of [landing, explorer, compare, glossary]) expect(route).toContain("aria-pressed=");
  });

  it("uses sibling native controls for tree selection and favourites", () => {
    expect(tree).toContain('class="ctrl-select"');
    expect(tree).not.toContain('role="button"');
    expect(tree).not.toContain("event.stopPropagation()");
    expect(tree).toMatch(
      /<button type="button" class="ctrl-select"[\s\S]*<\/button>\s*<button\s+type="button"\s+class="favourite"/,
    );
  });

  it("supports keyboard resizing and complete tab keyboard semantics", () => {
    expect(explorer).toContain("function handleSidebarResizeKey(event: KeyboardEvent)");
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) expect(explorer).toContain(`event.key === "${key}"`);
    expect(explorer).toContain('role="separator"');
    expect(explorer).toContain('tabindex="0"');
    expect(explorer).toContain("onkeydown={handleSidebarResizeKey}");
    expect(explorer).toContain('role="tablist"');
    expect(explorer).toContain('aria-controls="control-tabpanel"');
    expect(explorer).toContain("tabindex={activeTab === tab.value ? 0 : -1}");
    expect(explorer).toMatch(/aria-labelledby=\{`control-tab-\$\{activeTab\}`\}/);
    expect(explorer).toContain("function handleTabKey(event: KeyboardEvent, tab: DetailTab)");
    expect(explorer).toContain(
      'const availableTabs = DETAIL_TABS.filter((item) => !item.ismOnly || framework === "ism")',
    );
    expect(attack).toContain("aria-labelledby={`attack-outcome-");
    expect(attack).toContain("aria-label={`This control supports ");
  });

  it("activates graph controls with Enter or Space and restores useful detail focus", () => {
    expect(context).toContain('event.key !== "Enter" && event.key !== " "');
    expect(context).toContain("event.preventDefault()");
    expect(context).toMatch(/aria-label=\{`Open \$\{neighbor\.data\.display_id \?\? neighbor\.data\.id\}`\}/);
    expect(explorer).toContain('data-control-heading tabindex="-1"');
    expect(explorer).toContain('document.querySelector<HTMLElement>("[data-control-heading]")?.focus()');
    expect(explorer).toContain("focusDetail = updateUrl");
  });

  it("uses narrow status announcements and exposes sortable comparison headers", () => {
    expect(explorer).not.toContain('<section class="detail-panel" aria-live');
    expect(explorer).toContain('class="detail-state" role="status"');
    expect(explorer).toContain('class="detail-state error" role="alert"');
    expect(compare).toContain("aria-sort=");
    expect(glossary).toContain('role="alert"');
  });

  it("blocks the underlying shell with a labelled, quiet loading dialog", () => {
    expect(layout).toContain("inert={catalogueBlocked}");
    expect(layout).toContain("onVisibilityChange=");
    expect(splash).toContain('role="dialog"');
    expect(splash).toContain('aria-modal="true"');
    expect(splash).toContain('class="sr-only" role="status"');
    expect(splash).toContain('aria-label="Catalogue download progress"');
    expect(splash).toContain('class="progress-copy" aria-hidden="true"');
    expect(splash).not.toContain('class="database-splash" aria-live');
  });

  it("honours reduced-motion preferences globally and for breadcrumb scrolling", () => {
    expect(reset).toContain("@media (prefers-reduced-motion: reduce)");
    expect(reset).toContain("scroll-behavior: auto !important");
    expect(explorer).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
  });
});
