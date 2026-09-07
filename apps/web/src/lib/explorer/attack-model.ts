import type {
  AttackMapping,
  AttackMappingResult,
  AttackProcedureReference,
  AttackTechniqueProcedures,
} from "$lib/db/contracts";

export const ATTACK_TACTICS = [
  "reconnaissance",
  "resource-development",
  "initial-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "stealth",
  "defense-impairment",
  "credential-access",
  "discovery",
  "lateral-movement",
  "collection",
  "command-and-control",
  "exfiltration",
  "impact",
] as const;

export interface AttackMitigationTechniqueRelationship {
  relationshipStixId: string;
  description: string | null;
}

export interface AttackMitigationTechnique {
  techniqueId: string;
  techniqueName: string;
  techniqueDescription: string | null;
  techniqueUrl: string | null;
  parentTechniqueId: string | null;
  tactics: string[];
  platforms: string[];
  relationships: AttackMitigationTechniqueRelationship[];
  procedures: AttackTechniqueProcedures;
}

export interface AttackMitigationGroup {
  candidateId: string;
  mitigationId: string;
  mitigationName: string;
  mitigationDescription: string | null;
  mitigationUrl: string | null;
  relationship: AttackMapping["relationship"];
  securityFunction: AttackMapping["securityFunction"];
  confidence: AttackMapping["confidence"];
  rationale: string;
  evidenceNotes: string[];
  techniques: AttackMitigationTechnique[];
}

export interface AttackTacticSummary {
  id: string;
  label: string;
  count: number;
}

export function formatAttackLabel(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function safeMitreUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "attack.mitre.org" &&
      url.port === "" &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function procedureReferenceLabel(reference: AttackProcedureReference): string {
  return reference.externalId ? `${reference.sourceName} (${reference.externalId})` : reference.sourceName;
}

function evidenceNotes(evidence: readonly Record<string, unknown>[]): string[] {
  return [
    ...new Set(
      evidence
        .flatMap((item) => [item.note, item.matched_text])
        .filter((note): note is string => typeof note === "string" && note.trim() !== ""),
    ),
  ];
}

function emptyProcedures(techniqueId: string): AttackTechniqueProcedures {
  return { techniqueId, total: 0, returned: 0, examples: [] };
}

export function groupAttackMitigations(
  rows: readonly AttackMapping[],
  procedures: readonly AttackTechniqueProcedures[] = [],
): AttackMitigationGroup[] {
  const mitigations = new Map<string, AttackMitigationGroup>();
  const techniquesByMitigation = new Map<string, Map<string, AttackMitigationTechnique>>();
  const proceduresByTechnique = new Map(procedures.map((item) => [item.techniqueId, item]));

  for (const row of rows) {
    const mitigationKey = `${row.candidateId}:${row.mitigationId}`;
    let mitigation = mitigations.get(mitigationKey);
    if (!mitigation) {
      mitigation = {
        candidateId: row.candidateId,
        mitigationId: row.mitigationId,
        mitigationName: row.mitigationName,
        mitigationDescription: row.mitigationDescription,
        mitigationUrl: safeMitreUrl(row.mitigationUrl),
        relationship: row.relationship,
        securityFunction: row.securityFunction,
        confidence: row.confidence,
        rationale: row.rationale,
        evidenceNotes: evidenceNotes(row.evidence),
        techniques: [],
      };
      mitigations.set(mitigationKey, mitigation);
      techniquesByMitigation.set(mitigationKey, new Map());
    }

    const techniqueMap = techniquesByMitigation.get(mitigationKey)!;
    let technique = techniqueMap.get(row.techniqueId);
    if (!technique) {
      technique = {
        techniqueId: row.techniqueId,
        techniqueName: row.techniqueName,
        techniqueDescription: row.techniqueDescription,
        techniqueUrl: safeMitreUrl(row.techniqueUrl),
        parentTechniqueId: row.parentTechniqueId,
        tactics: [],
        platforms: [],
        relationships: [],
        procedures: proceduresByTechnique.get(row.techniqueId) ?? emptyProcedures(row.techniqueId),
      };
      techniqueMap.set(row.techniqueId, technique);
      mitigation.techniques.push(technique);
    }

    technique.tactics = [...new Set([...technique.tactics, ...row.tactics])];
    technique.platforms = [...new Set([...technique.platforms, ...row.platforms])];
    if (!technique.relationships.some((relationship) => relationship.relationshipStixId === row.relationshipStixId)) {
      technique.relationships.push({
        relationshipStixId: row.relationshipStixId,
        description: row.relationshipDescription,
      });
    }
  }

  for (const mitigation of mitigations.values()) {
    mitigation.techniques.sort((left, right) => left.techniqueId.localeCompare(right.techniqueId));
  }
  return [...mitigations.values()].sort((left, right) => left.mitigationId.localeCompare(right.mitigationId));
}

export function uniqueAttackTechniques(groups: readonly AttackMitigationGroup[]): AttackMitigationTechnique[] {
  const techniques = new Map<string, AttackMitigationTechnique>();
  for (const group of groups) {
    for (const technique of group.techniques) {
      const existing = techniques.get(technique.techniqueId);
      if (!existing) {
        techniques.set(technique.techniqueId, {
          ...technique,
          tactics: [...technique.tactics],
          platforms: [...technique.platforms],
        });
        continue;
      }
      existing.tactics = [...new Set([...existing.tactics, ...technique.tactics])];
      existing.platforms = [...new Set([...existing.platforms, ...technique.platforms])];
    }
  }
  return [...techniques.values()].sort((left, right) => left.techniqueId.localeCompare(right.techniqueId));
}

export function attackTacticSummary(groups: readonly AttackMitigationGroup[]): AttackTacticSummary[] {
  const techniques = uniqueAttackTechniques(groups);
  const known = new Set<string>(ATTACK_TACTICS);
  const tactics = [
    ...ATTACK_TACTICS,
    ...[...new Set(techniques.flatMap((technique) => technique.tactics))].filter((tactic) => !known.has(tactic)).sort(),
  ];
  return tactics.map((id) => ({
    id,
    label: formatAttackLabel(id),
    count: techniques.filter((technique) => technique.tactics.includes(id)).length,
  }));
}

export function emptyAttackResult(): AttackMappingResult {
  return { ismCatalogVersion: null, attackVersion: null, mappings: [], procedures: [] };
}
