import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import DatabaseLoadingSplash from "../DatabaseLoadingSplash.svelte";
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

  it("renders the opening cover into initial server HTML when requested", () => {
    const { body } = render(DatabaseLoadingSplash, {
      props: { initiallyVisible: true, routeKey: "/rule1/explorer/" },
    });

    expect(body).toMatch(/class="database-splash(?:\s|")/);
    expect(body).toContain("Opening the local catalogue");
    expect(body).toContain('role="dialog"');
    expect(body).toContain('aria-modal="true"');
    expect(body).toContain('aria-label="Local catalogue opening in progress"');
  });

  it("does not render a cover into initial server HTML for informational routes", () => {
    const { body } = render(DatabaseLoadingSplash, {
      props: { initiallyVisible: false, routeKey: "/rule1/guide/" },
    });

    expect(body).not.toMatch(/class="database-splash(?:\s|")/);
  });

  it("announces only loading stages and keeps measured byte copy visual", () => {
    expect(splashSource).toContain('class="sr-only" role="status"');
    expect(splashSource).toContain('class="progress-copy" aria-hidden="true"');
    expect(splashSource).not.toContain('class="database-splash" aria-live');
    expect(splashSource).toContain('aria-labelledby="database-loading-title"');
    expect(splashSource).toContain('aria-describedby="database-loading-retention"');
  });
});
