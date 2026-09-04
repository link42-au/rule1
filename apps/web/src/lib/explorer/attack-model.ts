import type { AttackMapping, AttackMappingResult } from "$lib/db/contracts";

export const ATTACK_TACTICS = [
  "reconnaissance",
  "resource-development",
  "initial-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "defense-evasion",
  "credential-access",
  "discovery",
  "lateral-movement",
  "collection",
  "command-and-control",
  "exfiltration",
  "impact",
] as const;

export interface AttackTechniqueMapping {
  mitigationId: string;
  mitigationName: string;
  mitigationUrl: string | null;
  effect: AttackMapping["effect"];
  confidence: AttackMapping["confidence"];
  rationale: string;
  evidenceNotes: string[];
}

export interface AttackTechniqueGroup {
  techniqueId: string;
  techniqueName: string;
  techniqueDescription: string | null;
  techniqueUrl: string | null;
  parentTechniqueId: string | null;
  tactics: string[];
  platforms: string[];
  effects: AttackMapping["effect"][];
  mappings: AttackTechniqueMapping[];
}

export interface AttackTacticSummary {
  id: string;
  label: string;
  count: number;
}

const EFFECT_ORDER: AttackMapping["effect"][] = ["prevent", "constrain", "detect", "recover"];

export function formatAttackLabel(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function safeMitreUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "attack.mitre.org" ? url.href : null;
  } catch {
    return null;
  }
}

function evidenceNotes(evidence: readonly Record<string, unknown>[]): string[] {
  return [
    ...new Set(
      evidence
        .map((item) => item.note)
        .filter((note): note is string => typeof note === "string" && note.trim() !== ""),
    ),
  ];
}

export function groupAttackMappings(rows: readonly AttackMapping[]): AttackTechniqueGroup[] {
  const grouped = new Map<string, AttackTechniqueGroup>();
  for (const row of rows) {
    let technique = grouped.get(row.techniqueId);
    if (!technique) {
      technique = {
        techniqueId: row.techniqueId,
        techniqueName: row.techniqueName,
        techniqueDescription: row.techniqueDescription,
        techniqueUrl: safeMitreUrl(row.techniqueUrl),
        parentTechniqueId: row.parentTechniqueId,
        tactics: [],
        platforms: [],
        effects: [],
        mappings: [],
      };
      grouped.set(row.techniqueId, technique);
    }
    technique.tactics = [...new Set([...technique.tactics, ...row.tactics])];
    technique.platforms = [...new Set([...technique.platforms, ...row.platforms])];
    technique.effects = [...new Set([...technique.effects, row.effect])].sort(
      (left, right) => EFFECT_ORDER.indexOf(left) - EFFECT_ORDER.indexOf(right),
    );
    const mappingKey = `${row.mitigationId}\u0000${row.effect}\u0000${row.confidence}\u0000${row.rationale}`;
    if (
      !technique.mappings.some(
        (mapping) =>
          `${mapping.mitigationId}\u0000${mapping.effect}\u0000${mapping.confidence}\u0000${mapping.rationale}` ===
          mappingKey,
      )
    ) {
      technique.mappings.push({
        mitigationId: row.mitigationId,
        mitigationName: row.mitigationName,
        mitigationUrl: safeMitreUrl(row.mitigationUrl),
        effect: row.effect,
        confidence: row.confidence,
        rationale: row.rationale,
        evidenceNotes: evidenceNotes(row.evidence),
      });
    }
  }
  return [...grouped.values()].sort((left, right) => left.techniqueId.localeCompare(right.techniqueId));
}

export function attackTacticSummary(groups: readonly AttackTechniqueGroup[]): AttackTacticSummary[] {
  const known = new Set<string>(ATTACK_TACTICS);
  const tactics = [
    ...ATTACK_TACTICS,
    ...[...new Set(groups.flatMap((group) => group.tactics))].filter((tactic) => !known.has(tactic)).sort(),
  ];
  return tactics.map((id) => ({
    id,
    label: formatAttackLabel(id),
    count: groups.filter((group) => group.tactics.includes(id)).length,
  }));
}

export function emptyAttackResult(): AttackMappingResult {
  return { ismCatalogVersion: null, attackVersion: null, mappings: [] };
}
