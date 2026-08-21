import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const landingSource = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("./+layout.svelte", import.meta.url), "utf8");
const brandSource = await readFile(new URL("../brand.css", import.meta.url), "utf8");

describe("reviewed Rule1 landing page", () => {
  it("retains the recognisable product identity and discovery controls", () => {
    expect(landingSource).toContain("security controls, explored");
    expect(landingSource).toContain("Browse and search security controls across frameworks");
    expect(landingSource).toContain("Search controls… e.g. multi-factor, patch management");
    expect(landingSource).toContain("Essential 8");
    expect(landingSource).toContain("Data Classification");
    expect(landingSource).toContain("Browse all controls");
  });

  it("keeps assets and catalogue destinations beneath the configured base path", () => {
    expect(landingSource).toContain('import { base } from "$app/paths"');
    expect(landingSource).toMatch(/`\$\{base\}\/\$\{theme\.value/);
    expect(landingSource).toMatch(/return `\$\{base\}\$\{path\}`/);
    expect(landingSource).not.toMatch(/(?:src|href)=["']\/(?!\/)/);
  });

  it("reports the absent local catalogue instead of fetching or inventing data", () => {
    expect(landingSource).toContain('status: "unavailable"');
    expect(landingSource).toContain("The local security controls catalogue is not available in this build yet.");
    expect(landingSource).toContain("disabled={!catalogueAvailable}");
    expect(landingSource).not.toMatch(/\bfetch(?:Frameworks|Stats)?\s*\(/);
    expect(landingSource).not.toContain("onMount");
  });

  it("keeps tall landing content in flow above the production footer", () => {
    expect(brandSource).toMatch(/main\s*{[^}]*flex:\s*1 0 auto/);
    expect(brandSource).not.toMatch(/main\s*{[^}]*min-height:\s*0/);
    expect(layoutSource).toContain('excludeApps={["login2", "threat10", "patch8", "peer6"]}');
  });
});
