import type { Revision } from "@rule1/shared";

export type HistoryKind = "current" | "modified" | "new" | "unchanged" | "withdrawn";
export type HistoryDotKind = HistoryKind | "moved";
export type DiffPart = { kind: "same" | "deleted" | "inserted"; text: string };

export interface HistoryEntry {
  revision: Revision;
  previous: Revision | null;
  label: "Current" | "Modified" | "New" | "Unchanged" | "Withdrawn";
  kind: HistoryKind;
  dotKind: HistoryDotKind;
  version: string;
  statementDiff: DiffPart[] | null;
  applicabilityChange: { before: string[]; after: string[] } | null;
  move: { from: string; to: string } | null;
  withdrawn: boolean;
  source: string | null;
  compliance: string | null;
  complexity: { value: string; label: string } | null;
}

const COMPLEXITY_LABELS: Record<string, string> = {
  unknown: "Unknown",
  "very-low": "Very Low",
  low: "Low",
  medium: "Medium",
  high: "High",
};

function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function diffWords(before: string, after: string): DiffPart[] {
  const oldTokens = tokenize(before);
  const newTokens = tokenize(after);
  const lengths = Array.from({ length: oldTokens.length + 1 }, () => new Array<number>(newTokens.length + 1).fill(0));

  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex][newIndex] =
        oldTokens[oldIndex] === newTokens[newIndex]
          ? lengths[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const append = (kind: DiffPart["kind"], text: string) => {
    const previous = parts.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else parts.push({ kind, text });
  };
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldTokens.length || newIndex < newTokens.length) {
    if (oldTokens[oldIndex] === newTokens[newIndex]) {
      append("same", oldTokens[oldIndex]);
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newTokens.length &&
      (oldIndex === oldTokens.length || lengths[oldIndex][newIndex + 1] > lengths[oldIndex + 1][newIndex])
    ) {
      append("inserted", newTokens[newIndex]);
      newIndex += 1;
    } else {
      append("deleted", oldTokens[oldIndex]);
      oldIndex += 1;
    }
  }
  return parts;
}

function sameApplicability(before: readonly string[], after: readonly string[]): boolean {
  return [...before].sort().join("\u0000") === [...after].sort().join("\u0000");
}

function entryKind(revision: Revision, index: number): HistoryKind {
  if (revision.change_type === "withdrawn") return "withdrawn";
  if (index === 0) return "current";
  if (revision.change_type === "new") return "new";
  if (revision.change_type === "modified") return "modified";
  return "unchanged";
}

export function buildHistoryEntries(history: readonly Revision[]): HistoryEntry[] {
  return history.map((revision, index) => {
    const previous = history[index + 1] ?? null;
    const withdrawn = revision.change_type === "withdrawn";
    const moved =
      index > 0 &&
      previous?.guideline != null &&
      revision.guideline != null &&
      previous.guideline !== revision.guideline
        ? { from: previous.guideline, to: revision.guideline }
        : null;
    const beforeApplicability = previous?.applicability ?? [];
    const afterApplicability = revision.applicability ?? [];
    const kind = entryKind(revision, index);
    const rawComplexity = revision.change_complexity?.trim().toLowerCase() ?? "";

    return {
      revision,
      previous,
      label:
        kind === "current"
          ? "Current"
          : kind === "modified"
            ? "Modified"
            : kind === "new"
              ? "New"
              : kind === "withdrawn"
                ? "Withdrawn"
                : "Unchanged",
      kind,
      dotKind: withdrawn ? "withdrawn" : moved ? "moved" : kind,
      version: revision.catalog_version ?? revision.commit_date ?? "Unknown version",
      statementDiff:
        !withdrawn && previous != null && revision.statement !== previous.statement
          ? diffWords(previous.statement ?? "", revision.statement ?? "")
          : null,
      applicabilityChange:
        !withdrawn && previous != null && !sameApplicability(beforeApplicability, afterApplicability)
          ? { before: [...beforeApplicability], after: [...afterApplicability] }
          : null,
      move: moved,
      withdrawn,
      source: revision.source?.trim() || null,
      compliance: revision.compliance?.trim() || null,
      complexity:
        revision.change_type === "modified" && index > 0 && rawComplexity
          ? { value: rawComplexity, label: COMPLEXITY_LABELS[rawComplexity] ?? revision.change_complexity! }
          : null,
    };
  });
}
