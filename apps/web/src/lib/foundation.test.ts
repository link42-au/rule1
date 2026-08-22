import type { Framework } from "@rule1/shared";
import { Footer, Header, PlatformBar, Toast, showToast, theme } from "@link42/ui";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import config from "../../svelte.config.js";

const themeSource = await readFile(new URL("../../../../packages/ui/src/theme.svelte.ts", import.meta.url), "utf8");
const appHtml = await readFile(new URL("../app.html", import.meta.url), "utf8");
const tokenSource = await readFile(new URL("../../../../packages/tokens/src/tokens.css", import.meta.url), "utf8");

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

  it("uses local system font fallbacks without an external font request", () => {
    expect(`${appHtml}\n${tokenSource}`).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    expect(tokenSource).toContain("-apple-system");
    expect(tokenSource).toContain("ui-monospace");
  });
});
