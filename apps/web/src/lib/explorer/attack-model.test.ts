import { describe, expect, it } from "vitest";
import type { AttackMapping, AttackTechniqueProcedures } from "$lib/db/contracts";
import {
  attackTacticSummary,
  formatAttackLabel,
  groupAttackMitigations,
  procedureReferenceLabel,
  safeMitreUrl,
  safeSourceUrl,
  uniqueAttackTechniques,
} from "./attack-model";

const row = (overrides: Partial<AttackMapping> = {}): AttackMapping => ({
  attackVersion: "19.2",
  ismCatalogVersion: "ISM-OSCAL-2026.09.4",
  candidateId: "candidate-1",
  mitigationId: "M1032",
  mitigationName: "Multi-factor Authentication",
  mitigationDescription: "Require more than one authentication factor.",
  mitigationUrl: "https://attack.mitre.org/mitigations/M1032/",
  relationship: "enables",
  securityFunction: "protect",
  confidence: "high",
  rationale: "The control directly requires multi-factor authentication.",
  evidence: [
    { kind: "ism-control", matched_text: "Multi-factor authentication is required." },
    { kind: "attack-mitigation", matched_text: "Require more than one authentication factor." },
  ],
  techniqueId: "T1110",
  techniqueName: "Brute Force",
  techniqueDescription: "Attempt to gain access by guessing credentials.",
  techniqueUrl: "https://attack.mitre.org/techniques/T1110/",
  tactics: ["credential-access"],
  platforms: ["Windows"],
  parentTechniqueId: null,
  relationshipStixId: "relationship--mfa-brute-force",
  relationshipDescription: "Use multi-factor authentication to reduce the impact of guessed credentials.",
  ...overrides,
});

describe("ATT&CK mitigation-first presentation", () => {
  it("groups by reviewed mitigation, deduplicates transport rows, and retains official relationship edges", () => {
    const groups = groupAttackMitigations([
      row(),
      row({ tactics: ["credential-access", "initial-access"], platforms: ["Linux"] }),
      row({
        relationshipStixId: "relationship--mfa-brute-force-2",
        relationshipDescription: "Require phishing-resistant factors where possible.",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      mitigationId: "M1032",
      relationship: "enables",
      securityFunction: "protect",
      evidenceNotes: ["Multi-factor authentication is required.", "Require more than one authentication factor."],
    });
    expect(groups[0].techniques).toHaveLength(1);
    expect(groups[0].techniques[0].tactics).toEqual(["credential-access", "initial-access"]);
    expect(groups[0].techniques[0].platforms).toEqual(["Windows", "Linux"]);
    expect(groups[0].techniques[0].relationships).toEqual([
      {
        relationshipStixId: "relationship--mfa-brute-force",
        description: "Use multi-factor authentication to reduce the impact of guessed credentials.",
      },
      {
        relationshipStixId: "relationship--mfa-brute-force-2",
        description: "Require phishing-resistant factors where possible.",
      },
    ]);
  });

  it("retains the same official technique beneath each distinct reviewed mitigation", () => {
    const groups = groupAttackMitigations([
      row(),
      row({
        candidateId: "candidate-2",
        mitigationId: "M1027",
        mitigationName: "Password Policies",
        mitigationUrl: "https://attack.mitre.org/mitigations/M1027/",
        securityFunction: "detect",
        rationale: "The control establishes account password policy.",
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.techniques[0].techniqueId)).toEqual(["T1110", "T1110"]);
    expect(uniqueAttackTechniques(groups)).toHaveLength(1);
  });

  it("attaches bounded procedure data to every mitigation-specific technique occurrence", () => {
    const procedures: AttackTechniqueProcedures[] = [
      {
        techniqueId: "T1110",
        total: 8,
        returned: 1,
        examples: [
          {
            relationshipStixId: "relationship--procedure-1",
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
    const groups = groupAttackMitigations(
      [row(), row({ candidateId: "candidate-2", mitigationId: "M1027", mitigationName: "Password Policies" })],
      procedures,
    );

    expect(groups[0].techniques[0].procedures).toBe(procedures[0]);
    expect(groups[1].techniques[0].procedures).toBe(procedures[0]);
  });

  it("summarises tactics by unique technique and retains zero-count Enterprise tactics", () => {
    const summary = attackTacticSummary(
      groupAttackMitigations([
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
    expect(safeMitreUrl("https://user:secret@attack.mitre.org/techniques/T1110/")).toBeNull();
    expect(safeMitreUrl("https://attack.mitre.org:444/techniques/T1110/")).toBeNull();
    expect(safeSourceUrl("https://example.com/report?q=1")).toBe("https://example.com/report?q=1");
    expect(safeSourceUrl("http://example.com/report")).toBeNull();
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("https://user:secret@example.com/report")).toBeNull();
    expect(procedureReferenceLabel({ sourceName: "Report", externalId: "R-1", url: null, description: null })).toBe(
      "Report (R-1)",
    );
  });
});
