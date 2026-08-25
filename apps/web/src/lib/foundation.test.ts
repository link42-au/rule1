import type { Framework } from "@rule1/shared";
import { Footer, Header, PlatformBar, Toast, showToast, theme } from "@link42/ui";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import config from "../../svelte.config.js";

const themeSource = await readFile(new URL("../../../../packages/ui/src/theme.svelte.ts", import.meta.url), "utf8");
const appHtml = await readFile(new URL("../app.html", import.meta.url), "utf8");
const tokenSource = await readFile(new URL("../../../../packages/tokens/src/tokens.css", import.meta.url), "utf8");
const fontLicense = await readFile(new URL("../../static/fonts/OFL-1.1.txt", import.meta.url), "utf8");
const fontAssets = [
  {
    name: "Geist-wght-v1.7.1.woff2",
    sha256: "2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1",
  },
  {
    name: "GeistMono-wght-v1.7.1.woff2",
    sha256: "afaacc4c5fbba89d2ebf7a02dc4070208540874592a5504d57175782fe893101",
  },
];

describe("standalone foundation", () => {
  it("uses the GitHub Pages base path with a static adapter", () => {
    expect(config.kit?.paths?.base).toBe("/rule1");
    expect(config.kit?.adapter).toBeDefined();
  });

  it("resolves the local shared packages", () => {
    const framework: Framework = {
      id: "ism",
      name: "Information Security Manual",
      short_name: "ISM",
      publisher: "Australian Signals Directorate",
      url: null,
      country: "AU",
    };

    expect(framework.short_name).toBe("ISM");
    expect([Footer, Header, PlatformBar, Toast]).toHaveLength(4);
    expect(typeof showToast).toBe("function");
    expect(theme.value).toBe("light");
  });

  it("uses the system theme on a first visit while preserving a valid local preference", () => {
    expect(themeSource).toContain('window.matchMedia?.("(prefers-color-scheme: dark)").matches');
    expect(themeSource).toContain("applyTheme(readStoredTheme() ?? systemTheme, false)");
  });

  it("self-hosts pinned Geist fonts without an external font request", async () => {
    expect(`${appHtml}\n${tokenSource}`).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    expect(tokenSource).toContain("url('./fonts/Geist-wght-v1.7.1.woff2')");
    expect(tokenSource).toContain("url('./fonts/GeistMono-wght-v1.7.1.woff2')");
    expect(tokenSource).toMatch(/font-family: 'Geist';[\s\S]*font-weight: 300 700;[\s\S]*font-display: swap;/);
    expect(tokenSource).toMatch(/font-family: 'Geist Mono';[\s\S]*font-weight: 300 500;[\s\S]*font-display: swap;/);
    expect(tokenSource).toContain("-apple-system");
    expect(tokenSource).toContain("ui-monospace");
    expect(fontLicense).toContain("SIL OPEN FONT LICENSE Version 1.1");

    for (const asset of fontAssets) {
      const font = await readFile(new URL(`../../../../packages/tokens/src/fonts/${asset.name}`, import.meta.url));
      expect(createHash("sha256").update(font).digest("hex")).toBe(asset.sha256);
    }
  });
});
