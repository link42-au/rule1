import { describe, expect, it } from "vitest";
import type { AttackMapping } from "$lib/db/contracts";
import { attackTacticSummary, formatAttackLabel, groupAttackMappings, safeMitreUrl } from "./attack-model";

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
  confidence: "high",
  rationale: "MFA may prevent successful use of guessed credentials.",
  evidence: [{ kind: "curator-note", note: "The result depends on implementation and authentication path." }],
  ...overrides,
});

describe("ATT&CK mapping presentation", () => {
  it("groups many-to-many rows into one technique and keeps distinct mitigation effects", () => {
    const groups = groupAttackMappings([
      row(),
      row({ mitigationId: "M1027", mitigationName: "Password Policies", effect: "constrain", confidence: "medium" }),
      row(),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ techniqueId: "T1110", effects: ["prevent", "constrain"] });
    expect(groups[0].mappings).toHaveLength(2);
    expect(groups[0].mappings[0].evidenceNotes).toEqual([
      "The result depends on implementation and authentication path.",
    ]);
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
  });
});
