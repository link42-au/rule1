import { describe, expect, it } from "vitest";
import type { AttackMapping, AttackTechniqueProcedures } from "$lib/db/contracts";
import {
  attackOutcomeSections,
  attackTacticSummary,
  attackTechniqueOutcomeSections,
  effectInfinitive,
  effectRelationshipPhrase,
  formatAttackLabel,
  groupAttackMappings,
  procedureReferenceLabel,
  safeMitreUrl,
  safeSourceUrl,
} from "./attack-model";

const row = (overrides: Partial<AttackMapping> = {}): AttackMapping => ({
  attackVersion: "19.2",
  ismCatalogVersion: "ISM-OSCAL-2026.09.4",
  techniqueId: "T1110",
  techniqueName: "Brute Force",
  techniqueDescription: "Attempt to gain access by guessing credentials.",
  techniqueUrl: "https://attack.mitre.org/techniques/T1110/",
  tactics: ["credential-access"],
  platforms: ["Windows"],
  parentTechniqueId: null,
  mitigationId: "M1032",
  mitigationName: "Multi-factor Authentication",
  mitigationDescription: "Use MFA.",
  mitigationUrl: "https://attack.mitre.org/mitigations/M1032/",
  effect: "prevent",
  outcomeClass: "technique-disruption",
  confidence: "high",
  rationale: "MFA may prevent successful use of guessed credentials.",
  evidence: [{ kind: "curator-note", note: "The result depends on implementation and authentication path." }],
  ...overrides,
});

describe("ATT&CK mapping presentation", () => {
  it("groups a technique without removing its independent outcome edges", () => {
    const groups = groupAttackMappings([
      row(),
      row({ mitigationId: "M1027", mitigationName: "Password Policies", effect: "constrain", confidence: "medium" }),
      row(),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ techniqueId: "T1110", effects: ["prevent", "constrain"] });
    expect(groups[0].mappings).toHaveLength(3);
    expect(groups[0].mappings[0].evidenceNotes).toEqual([
      "The result depends on implementation and authentication path.",
    ]);
  });

  it("separates technique disruption from consequence treatment for the same technique", () => {
    const sections = attackOutcomeSections([
      row({ effect: "detect", outcomeClass: "technique-disruption" }),
      row({
        mitigationId: "M1053",
        mitigationName: "Data Backup",
        effect: "recover",
        outcomeClass: "consequence-treatment",
      }),
    ]);
    expect(sections.map((section) => [section.outcomeClass, section.techniques[0].mappings[0].effect])).toEqual([
      ["technique-disruption", "detect"],
      ["consequence-treatment", "recover"],
    ]);
    expect(effectRelationshipPhrase("contain")).toBe("contains");
    expect(effectRelationshipPhrase("recover")).toBe("recovers from");
    expect(effectInfinitive("recover")).toBe("recover from");
  });

  it("attaches procedure examples once to a unique technique while retaining every outcome edge", () => {
    const procedures: AttackTechniqueProcedures[] = [
      {
        techniqueId: "T1110",
        total: 8,
        returned: 1,
        examples: [
          {
            relationshipStixId: "relationship--1",
            entityStixId: "intrusion-set--1",
            entityType: "intrusion-set",
            entityExternalId: "G0001",
            entityName: "Example group",
            entityDescription: "An example group.",
            entityUrl: "https://attack.mitre.org/groups/G0001/",
            description: "The group attempted password guessing.",
            references: [],
          },
        ],
      },
    ];
    const groups = groupAttackMappings(
      [
        row({ effect: "detect", outcomeClass: "technique-disruption" }),
        row({ mitigationId: "M1053", effect: "recover", outcomeClass: "consequence-treatment" }),
      ],
      procedures,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].procedures).toBe(procedures[0]);
    expect(attackTechniqueOutcomeSections(groups[0]).map((section) => section.mappings.length)).toEqual([1, 1]);
  });

  it("summarises tactics by unique technique and retains zero-count Enterprise tactics", () => {
    const summary = attackTacticSummary(
      groupAttackMappings([
        row(),
        row({ techniqueId: "T1110.001", techniqueName: "Password Guessing", parentTechniqueId: "T1110" }),
      ]),
    );
    expect(summary.find((tactic) => tactic.id === "credential-access")?.count).toBe(2);
    expect(summary.find((tactic) => tactic.id === "impact")?.count).toBe(0);
    expect(formatAttackLabel("command-and-control")).toBe("Command And Control");
  });

  it("allows only direct HTTPS links to MITRE ATT&CK", () => {
    expect(safeMitreUrl("https://attack.mitre.org/techniques/T1110/")).toBe(
      "https://attack.mitre.org/techniques/T1110/",
    );
    expect(safeMitreUrl("javascript:alert(1)")).toBeNull();
    expect(safeMitreUrl("https://example.com/techniques/T1110/")).toBeNull();
    expect(safeSourceUrl("https://example.com/report?q=1")).toBe("https://example.com/report?q=1");
    expect(safeSourceUrl("http://example.com/report")).toBeNull();
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("https://user:secret@example.com/report")).toBeNull();
    expect(procedureReferenceLabel({ sourceName: "Report", externalId: "R-1", url: null, description: null })).toBe(
      "Report (R-1)",
    );
  });
});
