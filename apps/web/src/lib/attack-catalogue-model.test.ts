import { describe, expect, it } from "vitest";
import type { AttackCatalogueTechnique } from "$lib/db/contracts";
import {
  attackCatalogueOptions,
  defaultAttackCatalogueFilters,
  filterAttackTechniques,
  readAttackCatalogueUrl,
  writeAttackCatalogueUrl,
} from "$lib/attack-catalogue-model";

const technique = (
  techniqueId: string,
  name: string,
  tactics: string[],
  platforms: string[],
  options: { description?: string; parent?: string; mitigated?: boolean; reviewed?: boolean } = {},
): AttackCatalogueTechnique => ({
  techniqueId,
  name,
  description: options.description ?? null,
  url: `https://attack.mitre.org/techniques/${techniqueId}/`,
  tactics,
  platforms,
  parentTechniqueId: options.parent ?? null,
  mitigations: options.mitigated
    ? [
        {
          mitigationId: "M1000",
          name: "Example mitigation",
          description: null,
          url: "https://attack.mitre.org/mitigations/M1000/",
          relationshipStixId: "relationship--one",
          relationshipDescription: null,
          controls: options.reviewed
            ? [
                {
                  candidateId: "candidate-one",
                  controlId: "ism-1",
                  displayId: "ISM-1",
                  title: null,
                  statement: null,
                  securityFunction: "protect",
                  confidence: "high",
                  rationale: "Directly enables the mitigation.",
                },
              ]
            : [],
        },
      ]
    : [],
});

const rows = [
  technique("T0004", "Impact parent", ["impact"], ["Linux"]),
  technique("T0002", "Execute", ["execution", "persistence"], ["Windows", "Linux"], {
    description: "Runs a command interpreter.",
    mitigated: true,
  }),
  technique("T0002.001", "Execute child", ["execution"], ["Windows"], {
    parent: "T0002",
    mitigated: true,
    reviewed: true,
  }),
  technique("T0001", "Initial", ["initial-access"], ["macOS"]),
];

describe("ATT&CK catalogue model", () => {
  it("shows all mapped, unmapped, parent and sub-techniques by default in matrix order", () => {
    expect(filterAttackTechniques(rows, defaultAttackCatalogueFilters()).map((row) => row.techniqueId)).toEqual([
      "T0001",
      "T0002",
      "T0002.001",
      "T0004",
    ]);
  });

  it("searches technique IDs, names and descriptions case-insensitively", () => {
    const filters = defaultAttackCatalogueFilters();
    for (const [search, expected] of [
      ["t0002.001", ["T0002.001"]],
      ["impact parent", ["T0004"]],
      ["COMMAND INTERPRETER", ["T0002"]],
    ] as const) {
      expect(filterAttackTechniques(rows, { ...filters, search }).map((row) => row.techniqueId)).toEqual(expected);
    }
  });

  it("uses OR within tactic and platform groups and AND between the groups", () => {
    const filters = defaultAttackCatalogueFilters();
    expect(
      filterAttackTechniques(rows, {
        ...filters,
        tactics: ["execution", "impact"],
        platforms: ["Windows", "macOS"],
      }).map((row) => row.techniqueId),
    ).toEqual(["T0002", "T0002.001"]);
    expect(
      filterAttackTechniques(rows, { ...filters, tactics: ["persistence"] }).map((row) => row.techniqueId),
    ).toEqual(["T0002"]);
  });

  it("can hide sub-techniques and filter official mitigation or reviewed-control coverage", () => {
    const filters = defaultAttackCatalogueFilters();
    expect(filterAttackTechniques(rows, { ...filters, showSubtechniques: false })).toHaveLength(3);
    expect(filterAttackTechniques(rows, { ...filters, coverage: "mitigated" }).map((row) => row.techniqueId)).toEqual([
      "T0002",
      "T0002.001",
    ]);
    expect(filterAttackTechniques(rows, { ...filters, coverage: "controls" }).map((row) => row.techniqueId)).toEqual([
      "T0002.001",
    ]);
  });

  it("orders available tactics by Enterprise matrix order and platforms alphabetically", () => {
    expect(attackCatalogueOptions(rows)).toEqual({
      tactics: ["initial-access", "execution", "persistence", "impact"],
      platforms: ["Linux", "macOS", "Windows"],
    });
    expect(
      attackCatalogueOptions([
        technique("T1000", "Defense impairment", ["defense-impairment"], ["Linux"]),
        technique("T1001", "Stealth", ["stealth"], ["Linux"]),
        technique("T1002", "Privilege", ["privilege-escalation"], ["Linux"]),
      ]).tactics,
    ).toEqual(["privilege-escalation", "stealth", "defense-impairment"]);
  });

  it("rejects invalid URL filters, deduplicates valid values, and round-trips state", () => {
    const requested = new URL(
      "https://rule1.test/attack/?search=exec&tactic=execution&tactic=execution&tactic=invalid&platform=Windows&platform=invalid&subtechniques=hidden&coverage=controls&technique=T0002.001",
    );
    const filters = readAttackCatalogueUrl(requested, rows);
    expect(filters).toEqual({
      search: "exec",
      tactics: ["execution"],
      platforms: ["Windows"],
      showSubtechniques: false,
      coverage: "controls",
      selectedId: "T0002.001",
    });
    expect(readAttackCatalogueUrl(new URL("https://rule1.test/attack/?coverage=nope&technique=T9999"), rows)).toEqual(
      defaultAttackCatalogueFilters(),
    );
    expect(writeAttackCatalogueUrl(new URL("https://rule1.test/attack/?unrelated=kept"), filters).search).toBe(
      "?unrelated=kept&search=exec&tactic=execution&platform=Windows&subtechniques=hidden&coverage=controls&technique=T0002.001",
    );
  });
});
