import type { Control, GlossaryTerm, Group, Revision } from "@rule1/shared";
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
  const explicitSearch = url.searchParams.has("search");
  let search = url.searchParams.get("search")?.trim() ?? "";
  let selectedId = url.searchParams.get("id")?.trim() || null;
  const legacyQuery = url.searchParams.get("q")?.trim() ?? "";

  if (!selectedId && !explicitSearch && legacyQuery) {
    if (/^([a-z0-9]+-)*\d+$/i.test(legacyQuery)) selectedId = legacyQuery;
    else search = legacyQuery;
  }

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
  next.searchParams.delete("q");
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

/** Select the same result the reviewed explorer search would open. */
export function searchSelection(controls: readonly Control[], query: string): string | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  const exact = controls.find(
    (control) => control.id.toLowerCase() === normalized || control.display_id.toLowerCase() === normalized,
  );
  return exact?.id ?? controls[0]?.id ?? null;
}

/** The latest snapshot may be unchanged, so report the newest actual retained change. */
export function latestRealChange(latest: Revision, history: readonly Revision[]): Revision | null {
  return [latest, ...history].find((revision) => revision.change_type && revision.change_type !== "unchanged") ?? null;
}

export interface GlossarySegment {
  text: string;
  meaning?: string;
}

/**
 * Split prose into renderable text/term segments. This keeps catalogue text as
 * text nodes instead of constructing HTML from retained source material.
 */
export function glossarySegments(raw: string, terms: readonly GlossaryTerm[]): GlossarySegment[] {
  if (terms.length === 0 || !raw) return [{ text: raw }];
  const sorted = [...terms].filter((term) => term.term.trim()).sort((a, b) => b.term.length - a.term.length);
  if (sorted.length === 0) return [{ text: raw }];
  const meanings = new Map(sorted.map((term) => [term.term.toLowerCase(), term.meaning]));
  const pattern = sorted.map((term) => term.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`\\b(${pattern})\\b`, "gi");
  const segments: GlossarySegment[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const match of raw.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > offset) segments.push({ text: raw.slice(offset, index) });
    const text = match[0];
    const key = text.toLowerCase();
    const meaning = seen.has(key) ? undefined : meanings.get(key);
    segments.push(meaning ? { text, meaning } : { text });
    seen.add(key);
    offset = index + text.length;
  }
  if (offset < raw.length) segments.push({ text: raw.slice(offset) });
  return segments.length > 0 ? segments : [{ text: raw }];
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
