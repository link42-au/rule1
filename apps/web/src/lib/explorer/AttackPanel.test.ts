import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import type { AttackMapping, AttackMappingResult } from "$lib/db/contracts";
import AttackPanel from "./AttackPanel.svelte";

const mapping = (overrides: Partial<AttackMapping> = {}): AttackMapping => ({
  attackVersion: "19.2",
  ismCatalogVersion: "ISM-OSCAL-2026.09.4",
  candidateId: "candidate-audit",
  mitigationId: "M1047",
  mitigationName: "Audit",
  mitigationDescription: "Review systems and activity for weaknesses or abnormal behaviour.",
  mitigationUrl: "https://attack.mitre.org/mitigations/M1047/",
  relationship: "enables",
  securityFunction: "detect",
  confidence: "high",
  rationale: "The control requires activity to be recorded and reviewed.",
  evidence: [{ kind: "control-statement", note: "Maintain records and regularly review them." }],
  techniqueId: "T1485",
  techniqueName: "Data Destruction",
  techniqueDescription: "Destroy data to interrupt availability.",
  techniqueUrl: "https://attack.mitre.org/techniques/T1485/",
  tactics: ["impact"],
  platforms: ["Windows"],
  parentTechniqueId: null,
  relationshipStixId: "relationship--audit-data-destruction",
  relationshipDescription: "System logging may help identify destructive changes to data.",
  ...overrides,
});

const reviewedResult: AttackMappingResult = {
  ismCatalogVersion: "ISM-OSCAL-2026.09.4",
  attackVersion: "19.2",
  mappings: [
    mapping(),
    mapping({
      candidateId: "candidate-backup",
      mitigationId: "M1053",
      mitigationName: "Data Backup",
      mitigationDescription: "Take and securely store data backups.",
      mitigationUrl: "https://attack.mitre.org/mitigations/M1053/",
      securityFunction: "recover",
      rationale: "The control directly requires restorable backups.",
      evidence: [],
      relationshipStixId: "relationship--backup-data-destruction",
      relationshipDescription: "Perform regular backups of data to enable recovery after data destruction.",
    }),
  ],
  procedures: [
    {
      techniqueId: "T1485",
      total: 2,
      returned: 2,
      examples: [
        {
          relationshipStixId: "relationship--group",
          entityStixId: "intrusion-set--group",
          entityType: "intrusion-set",
          entityExternalId: "G0001",
          entityName: "Example Group",
          entityDescription: "An attributed group.",
          entityUrl: "https://attack.mitre.org/groups/G0001/",
          description: "The group used Data Destruction against a target.",
          references: [
            {
              sourceName: "Example report",
              externalId: "R-1",
              url: "https://example.com/reports/1",
              description: "A report citation.",
            },
          ],
        },
        {
          relationshipStixId: "relationship--malware",
          entityStixId: "malware--example",
          entityType: "malware",
          entityExternalId: "S0001",
          entityName: "Example <script>alert(1)</script>",
          entityDescription: "Example malware.",
          entityUrl: "https://example.com/not-an-attack-entity",
          description: "The malware reportedly used Data Destruction.",
          references: [
            { sourceName: "Unsafe citation", externalId: null, url: "javascript:alert(1)", description: null },
          ],
        },
      ],
    },
  ],
};

describe("ATT&CK control panel", () => {
  it("renders reviewed mitigation edges first and labels MITRE-derived technique context honestly", () => {
    const { body } = render(AttackPanel, { props: { result: reviewedResult, status: "ready" } });
    expect(body.split('class="mitigation-card').length - 1).toBe(2);
    expect(body).toContain("This control <strong>enables</strong>");
    expect(body).toContain("Audit (M1047)");
    expect(body).toContain("Data Backup (M1053)");
    expect(body).toContain("detect");
    expect(body).toContain("recover");
    expect(body).toContain("high mapping confidence");
    expect(body).toContain("MITRE mitigation guidance");
    expect(body).toContain("System logging may help identify destructive changes to data.");
    expect(body).toContain("Perform regular backups of data to enable recovery after data destruction.");
    expect(body).toContain("Techniques are expanded from MITRE's");
    expect(body).not.toContain("Technique disruption");
    expect(body).not.toContain("Consequence treatment");
    expect(body).not.toContain("recovers from");
  });

  it("keeps technique and procedure sections collapsed while preserving safe source links", () => {
    const { body } = render(AttackPanel, { props: { result: reviewedResult, status: "ready" } });
    expect(body.split('class="technique-disclosure').length - 1).toBe(2);
    expect(body).not.toContain('<details class="technique-disclosure" open');
    expect(body).not.toContain('<details class="procedure-disclosure" open');
    expect(body).toContain('aria-label="Official ATT&amp;CK techniques (showing 1 of 1)"');
    expect(body).toContain('aria-label="Reported procedure examples (2 of 2)"');
    expect(body).toContain('href="https://attack.mitre.org/groups/G0001/"');
    expect(body).not.toContain('href="https://example.com/not-an-attack-entity"');
    expect(body).toContain('href="https://example.com/reports/1"');
    expect(body).not.toContain('href="javascript:alert(1)"');
    expect(body).toContain("Example &lt;script>alert(1)&lt;/script>");
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("do not mean this mapped ISM control defeats or covers");
  });

  it("renders only the first 12 techniques until explicit expansion", () => {
    const result: AttackMappingResult = {
      ...reviewedResult,
      mappings: Array.from({ length: 14 }, (_, index) =>
        mapping({
          techniqueId: `T${String(1100 + index)}`,
          techniqueName: `Technique ${index + 1}`,
          relationshipStixId: `relationship--${index + 1}`,
        }),
      ),
      procedures: [],
    };
    const { body } = render(AttackPanel, { props: { result, status: "ready" } });
    expect(body.split('class="technique-card').length - 1).toBe(12);
    expect(body).toContain("showing 12 of 14");
    expect(body).toContain("Show all 14 techniques");
    expect(body).not.toContain("Technique 14");
    expect(body).toContain('aria-expanded="false"');
  });

  it("states honestly when a mapped technique has no reported examples", () => {
    const result = { ...reviewedResult, procedures: [] };
    const { body } = render(AttackPanel, { props: { result, status: "ready" } });
    expect(body).toContain('aria-label="Reported procedure examples (0 of 0)"');
    expect(body).toContain("No reported procedure examples are retained for this technique");
  });

  it("renders explicit loading, error, and reviewed-empty states", () => {
    const empty: AttackMappingResult = {
      ismCatalogVersion: "ISM-OSCAL-2026.09.4",
      attackVersion: "19.2",
      mappings: [],
      procedures: [],
    };
    expect(render(AttackPanel, { props: { result: empty, status: "loading" } }).body).toContain(
      "Loading reviewed mappings",
    );
    expect(render(AttackPanel, { props: { result: empty, status: "error" } }).body).toContain(
      "ATT&amp;CK mappings unavailable",
    );
    expect(render(AttackPanel, { props: { result: empty, status: "ready" } }).body).toContain(
      "No reviewed ATT&amp;CK mappings to mitigations",
    );
  });
});
