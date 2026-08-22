import type { ControlDetail } from "@rule1/shared";
import { describe, expect, it } from "vitest";
import {
  FAVOURITES_STORAGE_KEY,
  controlCsv,
  controlJson,
  controlMarkdown,
  exportFavourites,
  importFavourites,
  loadFavourites,
  saveFavourites,
  type StorageLike,
} from "./local-user";

class MemoryStorage implements StorageLike {
  value: string | null = null;
  getItem(): string | null {
    return this.value;
  }
  setItem(_key: string, value: string): void {
    this.value = value;
  }
}

const detail: ControlDetail = {
  framework: "ism",
  id: "ism-1",
  display_id: "ISM-1",
  title: "Patch | software",
  section: "Patching",
  latest: {
    catalog_version: "2025-12",
    change_type: "modified",
    applicability: ["P"],
    e8_levels: ["ML1"],
    statement: '=Apply "updates"\nwithout <script>alert(1)</script> delay',
  },
  history: [],
};

describe("browser-local favourites", () => {
  it("round-trips the compatible legacy array format", () => {
    const storage = new MemoryStorage();
    const favourites = new Set(["nzism-1019", "ism-0009"]);
    expect(saveFavourites(storage, favourites)).toBe(true);
    expect(storage.value).toBe('["ism-0009","nzism-1019"]');
    expect(loadFavourites(storage)).toEqual({ favourites: new Set(["ism-0009", "nzism-1019"]), recovered: false });
    expect(importFavourites(new Set(), exportFavourites(favourites))).toEqual(new Set(["ism-0009", "nzism-1019"]));
  });

  it("also accepts a validated favourites envelope and merges without deletion", () => {
    const merged = importFavourites(new Set(["ism-1"]), JSON.stringify({ favourites: ["NZISM-2", "ism-1"] }));
    expect(merged).toEqual(new Set(["ism-1", "nzism-2"]));
  });

  it("rejects malformed imports before changing the existing set", () => {
    const existing = new Set(["ism-1"]);
    expect(() => importFavourites(existing, "not json")).toThrow();
    expect(() => importFavourites(existing, JSON.stringify(["ism-2", 3]))).toThrow("Every favourite");
    expect(() => importFavourites(existing, JSON.stringify({ wrong: [] }))).toThrow("Expected a favourites array");
    expect(existing).toEqual(new Set(["ism-1"]));
  });

  it("recovers when storage reads are corrupt or unavailable", () => {
    const corrupt = new MemoryStorage();
    corrupt.value = "not json";
    expect(loadFavourites(corrupt)).toEqual({ favourites: new Set(), recovered: true });
    expect(loadFavourites(undefined)).toEqual({ favourites: new Set(), recovered: true });
    expect(
      loadFavourites({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      }),
    ).toEqual({ favourites: new Set(), recovered: true });
  });

  it("keeps in-memory state usable when a quota-full write fails", () => {
    const favourites = new Set(["ism-1"]);
    const saved = saveFavourites(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
      favourites,
    );
    expect(saved).toBe(false);
    expect(favourites).toEqual(new Set(["ism-1"]));
  });
});

describe("standalone control exports", () => {
  it("creates formula-safe CSV with flattened, escaped text", () => {
    const csv = controlCsv(detail);
    expect(csv).toContain("Framework,ID,Version,Section,Change Type,Applicability,Essential Eight,Description");
    expect(csv).toContain(`'=Apply ""updates"" without <script>alert(1)</script> delay`);
  });

  it("creates bounded JSON without browser or service state", () => {
    const value = JSON.parse(controlJson(detail)) as Record<string, unknown>;
    expect(value.framework).toBe("ism");
    expect(value.display_id).toBe("ISM-1");
    expect(value).not.toHaveProperty("annotation");
    expect(value).not.toHaveProperty("history");
  });

  it("escapes Markdown table-sensitive text and preserves readable line breaks", () => {
    const markdown = controlMarkdown(detail);
    expect(markdown).toContain("# Patch \\| software");
    expect(markdown).toContain('Apply "updates"  \nwithout &lt;script&gt;alert(1)&lt;/script&gt; delay');
  });

  it("uses the reviewed storage key", () => {
    expect(FAVOURITES_STORAGE_KEY).toBe("ism-favourites");
  });
});
