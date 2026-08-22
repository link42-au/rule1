import type { Revision } from "@rule1/shared";
import { describe, expect, it } from "vitest";
import { buildHistoryEntries, diffWords } from "./history-model";

describe("word-level history differences", () => {
  it("retains common text and marks inserted and deleted words without producing HTML", () => {
    expect(diffWords("Use an old password.", "Use a strong password.")).toEqual([
      { kind: "same", text: "Use " },
      { kind: "deleted", text: "an old " },
      { kind: "inserted", text: "a strong " },
      { kind: "same", text: "password." },
    ]);
    expect(diffWords("<script>", "<strong>")).toEqual([
      { kind: "deleted", text: "<script>" },
      { kind: "inserted", text: "<strong>" },
    ]);
  });
});

describe("control history change model", () => {
  const history: Revision[] = [
    {
      catalog_version: "June 2026",
      statement: "Use a strong password.",
      applicability: ["P", "S"],
      guideline: "Guideline B",
      change_type: "modified",
      source: "pdf",
      compliance: "Must",
    },
    {
      catalog_version: "March 2026",
      statement: "Use an old password.",
      applicability: ["P"],
      guideline: "Guideline B",
      change_type: "modified",
      change_complexity: "medium",
    },
    {
      catalog_version: "December 2025",
      statement: "Use a password.",
      applicability: ["OS"],
      guideline: "Guideline A",
      change_type: "new",
    },
  ];

  it("keeps the supplied latest-first order and compares each revision with its predecessor", () => {
    const entries = buildHistoryEntries(history);
    expect(entries.map((entry) => [entry.version, entry.label])).toEqual([
      ["June 2026", "Current"],
      ["March 2026", "Modified"],
      ["December 2025", "New"],
    ]);
    expect(entries[0].statementDiff?.some((part) => part.kind === "inserted")).toBe(true);
    expect(entries[0].applicabilityChange).toEqual({ before: ["P"], after: ["P", "S"] });
    expect(entries[1].move).toEqual({ from: "Guideline A", to: "Guideline B" });
    expect(entries[1].complexity).toEqual({ value: "medium", label: "Medium" });
    expect(entries[0].source).toBe("pdf");
    expect(entries[0].compliance).toBe("Must");
  });

  it("models withdrawals without statement or applicability diffs", () => {
    const [entry] = buildHistoryEntries([
      { catalog_version: "v2", change_type: "withdrawn", statement: "", applicability: [] },
      { catalog_version: "v1", change_type: "new", statement: "Retired control", applicability: ["P"] },
    ]);
    expect(entry.label).toBe("Withdrawn");
    expect(entry.dotKind).toBe("withdrawn");
    expect(entry.statementDiff).toBeNull();
    expect(entry.applicabilityChange).toBeNull();
  });

  it("labels retained no-change revisions as unchanged after the current revision", () => {
    expect(
      buildHistoryEntries([
        { catalog_version: "v2", change_type: "unchanged" },
        { catalog_version: "v1", change_type: "unchanged" },
      ]).map((entry) => [entry.label, entry.dotKind]),
    ).toEqual([
      ["Current", "current"],
      ["Unchanged", "unchanged"],
    ]);
  });
});
