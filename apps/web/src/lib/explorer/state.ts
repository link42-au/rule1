import type { Control, Group } from "@rule1/shared";
import { canonicalFrameworkId, type FrameworkId } from "$lib/db/contracts";

export const FILTERS = ["all", "favourites", "e8", "ml1", "ml2", "ml3", "changed", "new", "withdrawn"] as const;
export type ExplorerFilter = (typeof FILTERS)[number];

export const APPLICABILITY = ["NC", "OS", "P", "C", "S", "TS"] as const;
export type Applicability = (typeof APPLICABILITY)[number] | "";

export interface ExplorerUrlState {
  framework: FrameworkId;
  filter: ExplorerFilter;
  applicability: Applicability;
  search: string;
  selectedId: string | null;
}

export function readExplorerUrl(url: URL, availableFrameworks: readonly string[]): ExplorerUrlState {
  const requestedFramework = url.searchParams.get("framework");
  let framework: FrameworkId = "ism";
  try {
    const candidate = canonicalFrameworkId(requestedFramework ?? "ism");
    if (availableFrameworks.includes(candidate)) framework = candidate;
  } catch {
    // Old shared links must remain usable even when their framework value is invalid.
  }

  const requestedFilter = url.searchParams.get("filter");
  const filter = FILTERS.includes(requestedFilter as ExplorerFilter) ? (requestedFilter as ExplorerFilter) : "all";
  const requestedApplicability = url.searchParams.get("applicability");
  const applicability = APPLICABILITY.includes(requestedApplicability as Exclude<Applicability, "">)
    ? (requestedApplicability as Exclude<Applicability, "">)
    : "";
  let search = url.searchParams.get("search")?.trim() ?? "";
  let selectedId = url.searchParams.get("id")?.trim() || null;

  if (!selectedId && /^([a-z0-9]+-)*\d+$/i.test(search)) {
    selectedId = search;
    search = "";
  }

  return { framework, filter, applicability, search, selectedId };
}

export function writeExplorerUrl(url: URL, state: ExplorerUrlState): URL {
  const next = new URL(url);
  const setOrDelete = (key: string, value: string): void => {
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
  };

  setOrDelete("framework", state.framework === "ism" ? "" : state.framework);
  setOrDelete("filter", state.filter === "all" ? "" : state.filter);
  setOrDelete("applicability", state.applicability);
  setOrDelete("search", state.search.trim());
  setOrDelete("id", state.selectedId ?? "");
  return next;
}

export function filterControls(
  controls: readonly Control[],
  filter: ExplorerFilter,
  applicability: Applicability,
  search: string,
  favourites: ReadonlySet<string> = new Set(),
): Control[] {
  let result = [...controls];
  if (filter === "all") result = result.filter((control) => control.change_type !== "withdrawn");
  else if (filter === "e8") result = result.filter((control) => (control.e8_levels?.length ?? 0) > 0);
  else if (filter === "favourites") result = result.filter((control) => favourites.has(control.id));
  else if (filter.startsWith("ml")) {
    result = result.filter((control) => control.e8_levels?.includes(filter.toUpperCase()) ?? false);
  } else {
    const changeType = filter === "changed" ? "modified" : filter;
    result = result.filter((control) => control.change_type === changeType);
  }

  if (applicability) {
    result = result.filter((control) => control.applicability?.includes(applicability) ?? false);
  }
  const query = search.trim().toLowerCase();
  if (!query) return result;
  return result.filter((control) =>
    [control.id, control.display_id, control.title, control.label, control.statement]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(query)),
  );
}

export function controlsBySection(controls: readonly Control[]): Map<string, Control[]> {
  const result = new Map<string, Control[]>();
  for (const control of controls) {
    const section = control.section_id ?? "__none__";
    const existing = result.get(section) ?? [];
    existing.push(control);
    result.set(section, existing);
  }
  return result;
}

export function countGroupControls(group: Group, grouped: ReadonlyMap<string, readonly Control[]>): number {
  return (
    (grouped.get(group.id)?.length ?? 0) +
    group.children.reduce((sum, child) => sum + countGroupControls(child, grouped), 0)
  );
}

export function groupContainsControl(
  group: Group,
  selectedId: string | null,
  grouped: ReadonlyMap<string, readonly Control[]>,
): boolean {
  if (!selectedId) return false;
  if (grouped.get(group.id)?.some((control) => control.id === selectedId)) return true;
  return group.children.some((child) => groupContainsControl(child, selectedId, grouped));
}

export class LatestRequest {
  #sequence = 0;

  begin(): number {
    return ++this.#sequence;
  }

  isCurrent(sequence: number): boolean {
    return sequence === this.#sequence;
  }

  cancel(): void {
    this.#sequence++;
  }
}
