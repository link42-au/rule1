import type { ChangeRow } from "@rule1/shared";
import { describe, expect, it } from "vitest";
import { comparisonCsv, comparisonRows, hasRetainedComplexity, presentComparison } from "./compare-model";

const modified: ChangeRow = {
  id: "ism-0009",
  display_id: "ISM-0009",
  label: "Protect data",
  change_type: "modified",
  guideline: "Data handling",
  section: "Information security",
  old_statement: "Systems are regularly reviewed.",
  new_statement: "Systems are regularly verified.",
  old_applicability: ["P"],
  new_applicability: ["P", "S"],
  old_e8_levels: ["ML1"],
  new_e8_levels: ["ML3"],
  change_complexity: "medium",
};

describe("comparison presentation", () => {
  it("only exposes the complexity column when retained values exist", () => {
    expect(hasRetainedComplexity([{ ...modified, change_complexity: null }])).toBe(false);
    expect(hasRetainedComplexity([{ ...modified, change_complexity: "  " }])).toBe(false);
    expect(hasRetainedComplexity([{ ...modified, change_complexity: "low" }])).toBe(true);
  });

  it("uses the shared word diff and retains changed applicability", () => {
    const item = presentComparison(modified, "ism");
    expect(item.statement).toEqual([
      { kind: "same", text: "Systems are regularly " },
      { kind: "deleted", text: "reviewed." },
      { kind: "inserted", text: "verified." },
    ]);
    expect(item.applicabilityChanged).toBe(true);
    expect(item.e8Changed).toBe(true);
    expect(item.oldE8Levels).toEqual(["ML1"]);
    expect(item.newE8Levels).toEqual(["ML3"]);
    expect(item.complexity?.label).toBe("Medium");
  });

  it("renders new text normally and withdrawn text as deleted", () => {
    expect(presentComparison({ ...modified, change_type: "new", old_statement: null }, "ism").statement).toEqual([
      { kind: "same", text: modified.new_statement! },
    ]);
    expect(presentComparison({ ...modified, change_type: "withdrawn", new_statement: null }, "ism").statement).toEqual([
      { kind: "deleted", text: modified.old_statement! },
    ]);
  });

  it("presents framework-specific classifications and context", () => {
    const nzism = presentComparison(
      { ...modified, metadata: { compliance: "MUST", classification: "RESTRICTED" } },
      "nzism",
    );
    expect(nzism.contextTag).toBe("MUST");
    expect(nzism.context).toBe("RESTRICTED");
    expect(presentComparison({ ...modified, metadata: { family: "AC" } }, "nist-800-53").contextTag).toBe("AC");
    expect(presentComparison({ ...modified, metadata: { function: "Protect" } }, "nist-csf").contextTag).toBe(
      "Protect",
    );
    expect(presentComparison({ ...modified, metadata: { control_area: "Malware protection" } }, "ce").context).toBe(
      "Malware protection",
    );
  });

  it("filters by type, text and effective applicability and sorts columns", () => {
    const withdrawn = {
      ...modified,
      id: "ism-0010",
      display_id: "ISM-0010",
      change_type: "withdrawn",
      old_applicability: ["TS"],
      new_applicability: [],
    };
    const rows = [withdrawn, modified];
    expect(
      comparisonRows(rows, "ism", "protect", "modified", "S", "display_id", "asc").map((item) => item.row.id),
    ).toEqual(["ism-0009"]);
    expect(comparisonRows(rows, "ism", "", "all", "TS", "display_id", "asc").map((item) => item.row.id)).toEqual([
      "ism-0010",
    ]);
    expect(comparisonRows(rows, "ism", "", "all", "", "display_id", "desc").map((item) => item.row.id)).toEqual([
      "ism-0010",
      "ism-0009",
    ]);
    expect(comparisonRows(rows, "ism", "ml3", "modified", "", "display_id", "asc")).toHaveLength(1);
  });

  it("exports old/new applicability and E8 mappings with formula-safe cells", () => {
    const csv = comparisonCsv(
      [presentComparison({ ...modified, new_statement: '=HYPERLINK("bad")', new_e8_levels: ["=DANGEROUS"] }, "ism")],
      "ism",
    );
    expect(csv).toContain("Old P,New P");
    expect(csv).toContain("Old Essential Eight,New Essential Eight");
    expect(csv).toContain("Old Description,New Description");
    expect(csv).toContain("ML1");
    expect(csv).toContain("'=DANGEROUS");
    expect(csv).toContain("'=HYPERLINK");
  });

  it("keeps Essential Eight columns out of non-ISM exports", () => {
    const csv = comparisonCsv(
      [presentComparison({ ...modified, old_e8_levels: [], new_e8_levels: [] }, "nzism")],
      "nzism",
    );
    expect(csv).not.toContain("Essential Eight");
  });
});
