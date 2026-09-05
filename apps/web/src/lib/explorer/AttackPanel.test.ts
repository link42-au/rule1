import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import type { AttackMappingResult } from "$lib/db/contracts";
import AttackPanel from "./AttackPanel.svelte";

const reviewedResult: AttackMappingResult = {
  ismCatalogVersion: "ISM-OSCAL-2026.09.4",
  attackVersion: "19.2",
  mappings: [
    {
      attackVersion: "19.2",
      ismCatalogVersion: "ISM-OSCAL-2026.09.4",
      techniqueId: "T1485",
      techniqueName: "Data Destruction",
      techniqueDescription: "Destroy data to interrupt availability.",
      techniqueUrl: "https://attack.mitre.org/techniques/T1485/",
      tactics: ["impact"],
      platforms: ["Windows"],
      parentTechniqueId: null,
      mitigationId: "M1047",
      mitigationName: "Audit",
      mitigationDescription: "Review activity.",
      mitigationUrl: "https://attack.mitre.org/mitigations/M1047/",
      effect: "detect",
      outcomeClass: "technique-disruption",
      confidence: "high",
      rationale: "Audit evidence may detect destructive activity.",
      evidence: [{ kind: "curator-note", note: "Effect depends on the authentication path." }],
    },
    {
      attackVersion: "19.2",
      ismCatalogVersion: "ISM-OSCAL-2026.09.4",
      techniqueId: "T1485",
      techniqueName: "Data Destruction",
      techniqueDescription: "Destroy data to interrupt availability.",
      techniqueUrl: "https://attack.mitre.org/techniques/T1485/",
      tactics: ["impact"],
      platforms: ["Linux"],
      parentTechniqueId: null,
      mitigationId: "M1053",
      mitigationName: "Data Backup",
      mitigationDescription: "Retain restorable data.",
      mitigationUrl: "https://attack.mitre.org/mitigations/M1053/",
      effect: "recover",
      outcomeClass: "consequence-treatment",
      confidence: "high",
      rationale: "Restorable backups support recovery after data destruction.",
      evidence: [],
    },
  ],
  procedures: [
    {
      techniqueId: "T1485",
      total: 9,
      returned: 4,
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
          description: "A long reported procedure description that remains attributed to the ATT&CK relationship.",
          references: [
            { sourceName: "Unsafe citation", externalId: null, url: "javascript:alert(1)", description: null },
          ],
        },
        {
          relationshipStixId: "relationship--campaign",
          entityStixId: "campaign--example",
          entityType: "campaign",
          entityExternalId: "C0001",
          entityName: "Example Campaign",
          entityDescription: "An example campaign.",
          entityUrl: "https://attack.mitre.org/campaigns/C0001/",
          description: "The campaign reportedly used Data Destruction during an operation.",
          references: [],
        },
        {
          relationshipStixId: "relationship--tool",
          entityStixId: "tool--example",
          entityType: "tool",
          entityExternalId: "S0002",
          entityName: "Example Tool",
          entityDescription: "An example tool.",
          entityUrl: "https://attack.mitre.org/software/S0002/",
          description: "The tool reportedly supported Data Destruction.",
          references: [
            { sourceName: "HTTP-only report", externalId: "R-2", url: "http://example.com/report", description: null },
          ],
        },
      ],
    },
  ],
};

describe("ATT&CK control panel", () => {
  it("renders one technique with both outcome classes without losing its independent edges", () => {
    const { body } = render(AttackPanel, { props: { result: reviewedResult, status: "ready" } });
    expect(body.split('class="technique-card').length - 1).toBe(1);
    expect(body).toContain("Technique disruption");
    expect(body).toContain("Consequence treatment");
    expect(body).toContain("T1485");
    expect(body).toContain("Data Destruction");
    expect(body).toContain("This control supports");
    expect(body).toContain("Audit (M1047)");
    expect(body).toContain("Data Backup (M1053)");
    expect(body).toContain('aria-label="This control supports Audit (M1047) to detect Data Destruction (T1485)"');
    expect(body).toContain(
      'aria-label="This control supports Data Backup (M1053) to recover from Data Destruction (T1485)"',
    );
    expect(body).toContain("recovers from");
    expect(body).toContain("high mapping confidence");
    expect(body).toContain("Effect depends on the authentication path.");
    expect(body).toContain("ATT&amp;CK 19.2");
    expect(body).toContain('href="https://attack.mitre.org/techniques/T1485/"');
  });

  it("renders one collapsed, bounded and safely linked procedure disclosure per technique", () => {
    const { body } = render(AttackPanel, { props: { result: reviewedResult, status: "ready" } });
    expect(body.split('class="procedure-disclosure').length - 1).toBe(1);
    expect(body).toContain('aria-label="Reported procedure examples (4 of 9)"');
    expect(body).not.toContain('<details class="procedure-disclosure" open');
    expect(body).toContain("Intrusion Set");
    expect(body).toContain("Malware");
    expect(body).toContain("Campaign");
    expect(body).toContain("Tool");
    expect(body).toContain("Example Campaign");
    expect(body).toContain("C0001");
    expect(body).toContain("Example Tool");
    expect(body).toContain("S0002");
    expect(body).toContain("The group used Data Destruction against a target.");
    expect(body).toContain('href="https://attack.mitre.org/groups/G0001/"');
    expect(body).not.toContain('href="https://example.com/not-an-attack-entity"');
    expect(body).toContain('href="https://example.com/reports/1"');
    expect(body).not.toContain('href="javascript:alert(1)"');
    expect(body).not.toContain('href="http://example.com/report"');
    expect(body).toContain("HTTP-only report (R-2)");
    expect(body).toContain("Example &lt;script>alert(1)&lt;/script>");
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("Example report (R-1)");
    expect(body).toContain("do not mean this mapped ISM control defeats or covers");
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
      "No reviewed ATT&amp;CK mappings",
    );
  });
});
