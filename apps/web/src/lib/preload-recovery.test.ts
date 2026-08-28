import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const appHtml = await readFile(new URL("../app.html", import.meta.url), "utf8");
const recoverySource = appHtml.match(/<script data-rule1-preload-recovery>([\s\S]*?)<\/script>/)?.[1];

if (!recoverySource) throw new Error("Preload recovery script is missing from app.html");

type StoredValues = Map<string, string>;

function createHarness(
  href: string,
  release = "/_app/immutable/entry/app.RELEASE.js",
  storedValues: StoredValues = new Map(),
) {
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 1;

  const location = { href, replace: vi.fn() };
  const history = { state: null, replaceState: vi.fn() };
  const sessionStorage = {
    getItem: vi.fn((key: string) => storedValues.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storedValues.set(key, value)),
    removeItem: vi.fn((key: string) => storedValues.delete(key)),
  };
  const window = {
    location,
    history,
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  const document = {
    querySelector: vi.fn(() => ({ getAttribute: () => release })),
  };
  const setTimeout = (callback: () => void, delay: number) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeout = (id: number) => timers.delete(id);

  new Function("window", "document", "sessionStorage", "URL", "setTimeout", "clearTimeout", recoverySource)(
    window,
    document,
    sessionStorage,
    URL,
    setTimeout,
    clearTimeout,
  );

  return {
    history,
    location,
    sessionStorage,
    storedValues,
    dispatch(type: string, event: Record<string, unknown> = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    runTimers(delay: number) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    timersAt(delay: number) {
      return [...timers.values()].filter((timer) => timer.delay === delay);
    },
  };
}

function preloadError(message = "Failed to fetch dynamically imported module: /chunk.js") {
  return { payload: new Error(message), preventDefault: vi.fn() };
}

describe("deployment-edge module recovery", () => {
  it("installs the Vite listener before SvelteKit bootstrap markup", () => {
    const listener = appHtml.indexOf("data-rule1-preload-recovery");
    expect(listener).toBeGreaterThan(-1);
    expect(listener).toBeLessThan(appHtml.indexOf("%sveltekit.head%"));
    expect(listener).toBeLessThan(appHtml.indexOf("%sveltekit.body%"));
  });

  it("delays one retry and preserves the URL while replacing its cache buster", () => {
    const harness = createHarness("https://rule1.link42.app/explorer/?id=ISM-0009&__rule1_retry=old#history");
    const error = preloadError();

    harness.dispatch("vite:preloadError", error);
    harness.dispatch("vite:preloadError", preloadError());

    expect(error.preventDefault).toHaveBeenCalledOnce();
    expect(harness.location.replace).not.toHaveBeenCalled();
    expect(harness.timersAt(250)).toHaveLength(1);
    harness.runTimers(250);

    expect(harness.location.replace).toHaveBeenCalledOnce();
    const target = new URL(harness.location.replace.mock.calls[0]![0]);
    expect(target.pathname).toBe("/explorer/");
    expect(target.searchParams.get("id")).toBe("ISM-0009");
    expect(target.searchParams.getAll("__rule1_retry")).toHaveLength(1);
    expect(target.searchParams.get("__rule1_retry")).not.toBe("old");
    expect(target.hash).toBe("#history");
  });

  it("allows one retry per failed asset and app release", () => {
    const storedValues = new Map<string, string>();
    const first = createHarness("https://rule1.link42.app/compare/", "/entry/app.A.js", storedValues);
    first.dispatch("vite:preloadError", preloadError("missing /nodes/8.A.js"));
    expect(first.timersAt(250)).toHaveLength(1);

    const repeated = createHarness("https://rule1.link42.app/compare/", "/entry/app.A.js", storedValues);
    const repeatedError = preloadError("missing /nodes/8.A.js");
    repeated.dispatch("vite:preloadError", repeatedError);
    expect(repeatedError.preventDefault).toHaveBeenCalledOnce();
    expect(repeated.timersAt(250)).toHaveLength(0);

    const newRelease = createHarness("https://rule1.link42.app/compare/", "/entry/app.B.js", storedValues);
    newRelease.dispatch("vite:preloadError", preloadError("missing /nodes/8.A.js"));
    expect(newRelease.timersAt(250)).toHaveLength(1);
  });

  it("resets only its guard and cache buster after a successful lifecycle", () => {
    const storedValues = new Map([["rule1:preload-retries", '["prior-retry"]']]);
    const harness = createHarness(
      "https://rule1.link42.app/explorer/?id=ISM-0009&__rule1_retry=temporary#history",
      undefined,
      storedValues,
    );

    harness.dispatch("load");
    expect(harness.timersAt(1500)).toHaveLength(1);
    expect(storedValues.has("rule1:preload-retries")).toBe(true);
    harness.runTimers(1500);

    expect(harness.sessionStorage.removeItem).toHaveBeenCalledWith("rule1:preload-retries");
    expect(storedValues.has("rule1:preload-retries")).toBe(false);
    expect(harness.history.replaceState).toHaveBeenCalledWith(null, "", "/explorer/?id=ISM-0009#history");

    harness.dispatch("vite:preloadError", preloadError());
    expect(harness.timersAt(250)).toHaveLength(1);
  });

  it("contains no destructive browser-storage or service-worker operations", () => {
    expect(recoverySource).not.toMatch(/localStorage|caches\.|serviceWorker|indexedDB|deleteDatabase|\.clear\s*\(/);
    expect(recoverySource).not.toMatch(/opfs|favourites|sqlite/i);
    expect(recoverySource).toContain("sessionStorage.removeItem(guardKey)");
  });
});
