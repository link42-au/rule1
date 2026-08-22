import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { formatBytes } from "./loading";

const splashSource = await readFile(new URL("../DatabaseLoadingSplash.svelte", import.meta.url), "utf8");

describe("database loading splash", () => {
  it("formats measured byte progress for people", () => {
    expect(formatBytes(0)).toBe("0 KiB");
    expect(formatBytes(512 * 1024)).toBe("0.5 MiB");
    expect(formatBytes(51 * 1024 * 1024)).toBe("51.0 MiB");
  });

  it("explains the initial download, unknown totals, verification, and browser retention", () => {
    expect(splashSource).toContain("The first visit downloads about 51 MiB.");
    expect(splashSource).toContain("Total size unavailable");
    expect(splashSource).toContain("Verifying catalogue integrity");
    expect(splashSource).toContain("Opening the local catalogue");
    expect(splashSource).toContain("retains the checked copy locally");
    expect(splashSource).not.toMatch(/setTimeout|setInterval/);
  });
});
