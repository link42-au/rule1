import type { ChangeRow, VersionRow } from "@rule1/shared";
import { describe, expect, it } from "vitest";
import { comparisonCsv, filterChanges, filterGlossary, frameworkFromUrl, versionPairFromUrl } from "./catalogue-pages";

const versions: VersionRow[] = [
  { version: "1.0", date: "2024-01-01" },
  { version: "1.1", date: "2024-02-01" },
  { version: "2.0", date: "2025-01-01" },
];

const changes: ChangeRow[] = [
  {
    id: "one",
    display_id: "ONE",
    label: "Patch",
    change_type: "modified",
    guideline: "Patching",
    section: null,
    new_statement: "Apply updates",
    old_statement: "Review updates",
    new_applicability: [],
    old_applicability: [],
    new_e8_levels: [],
    old_e8_levels: [],
  },
  {
    id: "two",
    display_id: "TWO",
    label: "Identity",
    change_type: "new",
    guideline: null,
    section: "Authentication",
    new_statement: "Use MFA",
    old_statement: null,
    new_applicability: [],
    old_applicability: null,
    new_e8_levels: [],
    old_e8_levels: null,
  },
];

describe("static comparison route state", () => {
  it("restores valid framework and version selections on direct refresh", () => {
    const url = new URL("https://rule1.link42.app/compare/?framework=nzism&from=1.0&to=2.0");
    expect(frameworkFromUrl(url, ["ism", "nzism"])).toBe("nzism");
    expect(versionPairFromUrl(url, versions)).toEqual({ from: "1.0", to: "2.0" });
  });

  it("falls back to a valid framework and the latest pair", () => {
    const url = new URL("https://rule1.link42.app/compare/?framework=invalid&from=nope&to=1.0");
    expect(frameworkFromUrl(url, ["ism", "nzism"])).toBe("ism");
    expect(versionPairFromUrl(url, versions)).toEqual({ from: "1.1", to: "2.0" });
    expect(versionPairFromUrl(url, versions.slice(0, 1))).toBeNull();
  });

  it("filters comparison rows by change type and visible text", () => {
    expect(filterChanges(changes, "", "new").map((row) => row.id)).toEqual(["two"]);
    expect(filterChanges(changes, "patch", "all").map((row) => row.id)).toEqual(["one"]);
    expect(filterChanges(changes, "MFA", "all").map((row) => row.id)).toEqual(["two"]);
  });

  it("exports filtered rows as formula-safe CSV", () => {
    const risky = [{ ...changes[0], new_statement: '=HYPERLINK("bad")' }];
    const csv = comparisonCsv(risky);
    expect(csv).toContain("ID,Change Type,Context,Old Description,New Description");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain("\nTWO,");
  });
});

describe("glossary search", () => {
  it("searches both retained term names and meanings", () => {
    const terms = [
      { id: "mfa", term: "Multi-factor authentication", meaning: "Uses multiple authentication factors." },
      { id: "patch", term: "Patch", meaning: "A software update." },
    ];
    expect(filterGlossary(terms, "factor").map((term) => term.id)).toEqual(["mfa"]);
    expect(filterGlossary(terms, "software").map((term) => term.id)).toEqual(["patch"]);
    expect(filterGlossary(terms, "")).toHaveLength(2);
  });
});
