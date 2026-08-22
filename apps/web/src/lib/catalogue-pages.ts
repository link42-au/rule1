import type { ChangeRow, GlossaryTerm, VersionRow } from "@rule1/shared";
import { canonicalFrameworkId, type FrameworkId } from "$lib/db/contracts";

export interface VersionPair {
  from: string;
  to: string;
}

export function frameworkFromUrl(url: URL, available: readonly string[]): FrameworkId {
  try {
    const framework = canonicalFrameworkId(url.searchParams.get("framework") ?? "ism");
    return available.includes(framework) ? framework : "ism";
  } catch {
    return "ism";
  }
}

export function versionPairFromUrl(url: URL, versions: readonly VersionRow[]): VersionPair | null {
  if (versions.length < 2) return null;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromIndex = from ? versions.findIndex((version) => version.version === from) : -1;
  const toIndex = to ? versions.findIndex((version) => version.version === to) : -1;
  if (fromIndex >= 0 && toIndex > fromIndex) return { from: from!, to: to! };
  return { from: versions.at(-2)!.version, to: versions.at(-1)!.version };
}

export function filterChanges(rows: readonly ChangeRow[], query: string, type: string): ChangeRow[] {
  const normalized = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (type !== "all" && row.change_type !== type) return false;
    if (!normalized) return true;
    return [row.display_id, row.label, row.guideline, row.section, row.new_statement, row.old_statement]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalized));
  });
}

function csvCell(value: string): string {
  const flattened = value.replace(/[\r\n]+/g, " ");
  const formulaSafe = /^[=+@-]/.test(flattened) ? `'${flattened}` : flattened;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

export function comparisonCsv(rows: readonly ChangeRow[]): string {
  const header = ["ID", "Change Type", "Context", "Old Description", "New Description"];
  const body = rows.map((row) =>
    [
      row.display_id,
      row.change_type,
      row.guideline ?? row.section ?? "",
      row.old_statement ?? "",
      row.new_statement ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${[header.join(","), ...body].join("\r\n")}`;
}

export function filterGlossary(terms: readonly GlossaryTerm[], query: string): GlossaryTerm[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...terms];
  return terms.filter(
    (term) => term.term.toLowerCase().includes(normalized) || term.meaning.toLowerCase().includes(normalized),
  );
}
