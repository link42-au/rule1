import type { AttackCatalogueTechnique } from "$lib/db/contracts";
import { ATTACK_TACTICS } from "$lib/explorer/attack-model";

export type AttackCoverageFilter = "all" | "mitigated" | "controls";

export interface AttackCatalogueFilters {
  search: string;
  tactics: string[];
  platforms: string[];
  showSubtechniques: boolean;
  coverage: AttackCoverageFilter;
  selectedId: string | null;
}

export const defaultAttackCatalogueFilters = (): AttackCatalogueFilters => ({
  search: "",
  tactics: [],
  platforms: [],
  showSubtechniques: true,
  coverage: "all",
  selectedId: null,
});

export function attackCatalogueOptions(techniques: readonly AttackCatalogueTechnique[]): {
  tactics: string[];
  platforms: string[];
} {
  return {
    tactics: [...new Set(techniques.flatMap((technique) => technique.tactics))].sort(
      (left, right) => attackTacticRank(left) - attackTacticRank(right) || left.localeCompare(right),
    ),
    platforms: [...new Set(techniques.flatMap((technique) => technique.platforms))].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export function attackTacticRank(tactic: string): number {
  const index = ATTACK_TACTICS.indexOf(tactic as (typeof ATTACK_TACTICS)[number]);
  return index < 0 ? ATTACK_TACTICS.length : index;
}

export function primaryAttackTactic(technique: AttackCatalogueTechnique): string {
  return (
    [...technique.tactics].sort(
      (left, right) => attackTacticRank(left) - attackTacticRank(right) || left.localeCompare(right),
    )[0] ?? "uncategorised"
  );
}

export function attackTechniqueHasReviewedControls(technique: AttackCatalogueTechnique): boolean {
  return technique.mitigations.some((mitigation) => mitigation.controls.length > 0);
}

export function compareAttackTechniques(left: AttackCatalogueTechnique, right: AttackCatalogueTechnique): number {
  const tacticDifference = attackTacticRank(primaryAttackTactic(left)) - attackTacticRank(primaryAttackTactic(right));
  if (tacticDifference !== 0) return tacticDifference;
  if (left.parentTechniqueId === right.techniqueId) return 1;
  if (right.parentTechniqueId === left.techniqueId) return -1;
  return left.name.localeCompare(right.name) || left.techniqueId.localeCompare(right.techniqueId);
}

export function filterAttackTechniques(
  techniques: readonly AttackCatalogueTechnique[],
  filters: AttackCatalogueFilters,
): AttackCatalogueTechnique[] {
  const normalized = filters.search.trim().toLowerCase();
  return techniques
    .filter((technique) => {
      if (
        normalized &&
        ![technique.techniqueId, technique.name, technique.description ?? ""].some((value) =>
          value.toLowerCase().includes(normalized),
        )
      )
        return false;
      if (!filters.showSubtechniques && technique.parentTechniqueId) return false;
      if (filters.tactics.length > 0 && !filters.tactics.some((tactic) => technique.tactics.includes(tactic)))
        return false;
      if (filters.platforms.length > 0 && !filters.platforms.some((platform) => technique.platforms.includes(platform)))
        return false;
      if (filters.coverage === "mitigated" && technique.mitigations.length === 0) return false;
      if (filters.coverage === "controls" && !attackTechniqueHasReviewedControls(technique)) return false;
      return true;
    })
    .sort(compareAttackTechniques);
}

export function readAttackCatalogueUrl(
  url: URL,
  techniques: readonly AttackCatalogueTechnique[],
): AttackCatalogueFilters {
  const options = attackCatalogueOptions(techniques);
  const requestedCoverage = url.searchParams.get("coverage");
  const requestedTechnique = url.searchParams.get("technique");
  return {
    search: url.searchParams.get("search") ?? "",
    tactics: [...new Set(url.searchParams.getAll("tactic"))].filter((value) => options.tactics.includes(value)),
    platforms: [...new Set(url.searchParams.getAll("platform"))].filter((value) => options.platforms.includes(value)),
    showSubtechniques: url.searchParams.get("subtechniques") !== "hidden",
    coverage: requestedCoverage === "mitigated" || requestedCoverage === "controls" ? requestedCoverage : "all",
    selectedId: techniques.some((technique) => technique.techniqueId === requestedTechnique)
      ? requestedTechnique
      : null,
  };
}

export function writeAttackCatalogueUrl(url: URL, filters: AttackCatalogueFilters): URL {
  const result = new URL(url);
  for (const parameter of ["search", "tactic", "platform", "subtechniques", "coverage", "technique"])
    result.searchParams.delete(parameter);
  if (filters.search.trim()) result.searchParams.set("search", filters.search.trim());
  for (const tactic of filters.tactics) result.searchParams.append("tactic", tactic);
  for (const platform of filters.platforms) result.searchParams.append("platform", platform);
  if (!filters.showSubtechniques) result.searchParams.set("subtechniques", "hidden");
  if (filters.coverage !== "all") result.searchParams.set("coverage", filters.coverage);
  if (filters.selectedId) result.searchParams.set("technique", filters.selectedId);
  return result;
}
