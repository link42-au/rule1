import type { ChangeRow } from "@rule1/shared";
import { diffWords, type DiffPart } from "$lib/explorer/history-model";

export const APPLICABILITY_CODES = ["NC", "OS", "P", "C", "S", "TS"] as const;

export type ComparisonSortColumn = "display_id" | "change_type" | "context";
export type SortDirection = "asc" | "desc";

export interface ComparisonPresentation {
  row: ChangeRow;
  context: string;
  contextTag: string | null;
  complexity: { value: string; label: string } | null;
  statement: DiffPart[];
  oldApplicability: string[];
  newApplicability: string[];
  applicabilityChanged: boolean;
}

export function hasRetainedComplexity(rows: readonly ChangeRow[]): boolean {
  return rows.some((row) => Boolean(row.change_complexity?.trim()));
}

const COMPLEXITY_LABELS: Record<string, string> = {
  unknown: "Unknown",
  "very-low": "Very Low",
  low: "Low",
  medium: "Medium",
  high: "High",
};

function sameApplicability(before: readonly string[], after: readonly string[]): boolean {
  return [...before].sort().join("\u0000") === [...after].sort().join("\u0000");
}

function frameworkContext(row: ChangeRow, framework: string): { context: string; tag: string | null } {
  const metadata = row.metadata ?? {};
  switch (framework) {
    case "ism":
      return { context: row.guideline ?? row.section ?? "", tag: null };
    case "nzism": {
      const classification = typeof metadata.classification === "string" ? metadata.classification : "";
      const compliance = typeof metadata.compliance === "string" ? metadata.compliance : "";
      return {
        context: classification && classification !== "All Classifications" ? classification : (row.section ?? ""),
        tag: compliance || null,
      };
    }
    case "nist-800-53":
      return { context: row.section ?? "", tag: typeof metadata.family === "string" ? metadata.family : null };
    case "nist-csf":
      return { context: row.section ?? "", tag: typeof metadata.function === "string" ? metadata.function : null };
    case "ce":
      return {
        context: typeof metadata.control_area === "string" ? metadata.control_area : (row.section ?? ""),
        tag: null,
      };
    default:
      return { context: row.section ?? row.guideline ?? "", tag: null };
  }
}

function statementParts(row: ChangeRow): DiffPart[] {
  if (row.change_type === "new") return [{ kind: "same", text: row.new_statement ?? "" }];
  if (row.change_type === "withdrawn") return [{ kind: "deleted", text: row.old_statement ?? "" }];
  return diffWords(row.old_statement ?? "", row.new_statement ?? "");
}

export function presentComparison(row: ChangeRow, framework: string): ComparisonPresentation {
  const { context, tag } = frameworkContext(row, framework);
  const oldApplicability = [...(row.old_applicability ?? [])];
  const newApplicability = [...(row.new_applicability ?? [])];
  const complexityValue = row.change_complexity?.trim().toLowerCase() ?? "";
  return {
    row,
    context,
    contextTag: tag,
    complexity: complexityValue
      ? {
          value: complexityValue.replaceAll("-", "_"),
          label: COMPLEXITY_LABELS[complexityValue] ?? row.change_complexity!,
        }
      : null,
    statement: statementParts(row),
    oldApplicability,
    newApplicability,
    applicabilityChanged: !sameApplicability(oldApplicability, newApplicability),
  };
}

export function comparisonRows(
  rows: readonly ChangeRow[],
  framework: string,
  query: string,
  changeType: string,
  applicability: string,
  sortColumn: ComparisonSortColumn,
  sortDirection: SortDirection,
): ComparisonPresentation[] {
  const normalized = query.trim().toLowerCase();
  return rows
    .map((row) => presentComparison(row, framework))
    .filter((item) => {
      if (changeType !== "all" && item.row.change_type !== changeType) return false;
      const effectiveApplicability =
        item.row.change_type === "withdrawn" ? item.oldApplicability : item.newApplicability;
      if (applicability && !effectiveApplicability.includes(applicability)) return false;
      if (!normalized) return true;
      return [
        item.row.display_id,
        item.row.label,
        item.contextTag,
        item.context,
        item.row.old_statement,
        item.row.new_statement,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized));
    })
    .sort((left, right) => {
      const leftValue = sortColumn === "context" ? left.context : left.row[sortColumn];
      const rightValue = sortColumn === "context" ? right.context : right.row[sortColumn];
      const result = leftValue.localeCompare(rightValue, undefined, { numeric: true });
      return sortDirection === "asc" ? result : -result;
    });
}

function csvCell(value: string): string {
  const flattened = value.replace(/[\r\n]+/g, " ");
  const formulaSafe = /^[=+@-]/.test(flattened) ? `'${flattened}` : flattened;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

export function comparisonCsv(rows: readonly ComparisonPresentation[]): string {
  const header = [
    "ID",
    "Change Type",
    "Complexity",
    "Context",
    ...APPLICABILITY_CODES.flatMap((code) => [`Old ${code}`, `New ${code}`]),
    "Old Description",
    "New Description",
  ];
  const body = rows.map((item) => {
    const oldApplicability = new Set(item.oldApplicability);
    const newApplicability = new Set(item.newApplicability);
    return [
      item.row.display_id,
      item.row.change_type,
      item.complexity?.label ?? "",
      [item.contextTag, item.context].filter(Boolean).join(" "),
      ...APPLICABILITY_CODES.flatMap((code) => [
        oldApplicability.has(code) ? "Yes" : "",
        newApplicability.has(code) ? "Yes" : "",
      ]),
      item.row.old_statement ?? "",
      item.row.new_statement ?? "",
    ]
      .map(csvCell)
      .join(",");
  });
  return `\uFEFF${[header.join(","), ...body].join("\r\n")}`;
}
