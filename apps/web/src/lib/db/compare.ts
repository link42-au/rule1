import type { ChangeRow, CompareResponse } from "@rule1/shared";
import type { FrameworkId } from "./contracts";
import { jsonArray, jsonObject, nullableText, text } from "./decode";

export interface ComparisonRecord extends Record<string, unknown> {
  control_id: string;
}

const active = (row: ComparisonRecord | undefined): row is ComparisonRecord =>
  row !== undefined && row.change_type !== "withdrawn";

const visibleMetadata = (row: ComparisonRecord): Record<string, unknown> => {
  const metadata = { ...jsonObject(row.metadata) };
  delete metadata.sort_id;
  return metadata;
};

const comparable = (row: ComparisonRecord): string =>
  JSON.stringify([
    row.display_id,
    row.label,
    row.title,
    row.statement,
    jsonArray(row.applicability),
    [...jsonArray(row.e8_levels)].sort(),
    row.guideline,
    row.section_id,
    row.section_title,
    visibleMetadata(row),
    row.compliance,
  ]);

function changeRow(
  kind: "new" | "modified" | "withdrawn",
  before: ComparisonRecord | undefined,
  after: ComparisonRecord | undefined,
): ChangeRow {
  const visible = after ?? before;
  if (!visible) throw new Error("Comparison row requires at least one revision");
  return {
    id: visible.control_id,
    display_id: text(visible.display_id, visible.control_id),
    label: text(visible.label),
    change_type: kind,
    guideline: nullableText(visible.guideline),
    section: nullableText(visible.section_title),
    new_statement: kind === "withdrawn" ? null : nullableText(after?.statement),
    old_statement: kind === "new" ? null : nullableText(before?.statement),
    new_applicability: kind === "withdrawn" ? null : jsonArray(after?.applicability),
    old_applicability: kind === "new" ? null : jsonArray(before?.applicability),
    new_e8_levels: kind === "withdrawn" ? null : jsonArray(after?.e8_levels),
    old_e8_levels: kind === "new" ? null : jsonArray(before?.e8_levels),
    change_complexity: nullableText(after?.change_complexity ?? before?.change_complexity),
    metadata: jsonObject(visible.metadata),
  };
}

export function compareSnapshots(
  framework: FrameworkId,
  from: string,
  to: string,
  beforeRows: readonly ComparisonRecord[],
  afterRows: readonly ComparisonRecord[],
): CompareResponse {
  const before = new Map(beforeRows.map((row) => [row.control_id, row]));
  const after = new Map(afterRows.map((row) => [row.control_id, row]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes: ChangeRow[] = [];

  for (const id of ids) {
    const oldRow = before.get(id);
    const newRow = after.get(id);
    const wasActive = active(oldRow);
    const isActive = active(newRow);
    if (!wasActive && isActive) changes.push(changeRow("new", oldRow, newRow));
    else if (wasActive && !isActive) changes.push(changeRow("withdrawn", oldRow, newRow));
    else if (wasActive && isActive && comparable(oldRow) !== comparable(newRow)) {
      changes.push(changeRow("modified", oldRow, newRow));
    }
  }

  changes.sort((left, right) => left.display_id.localeCompare(right.display_id, undefined, { numeric: true }));
  return { framework, from, to, changes, total: changes.length };
}
