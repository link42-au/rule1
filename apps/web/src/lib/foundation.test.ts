import type { Framework } from "@rule1/shared";
import { Footer, Header, PlatformBar, Toast, showToast, theme } from "@link42/ui";
import { describe, expect, it } from "vitest";
import config from "../../svelte.config.js";

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
});
