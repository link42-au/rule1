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
};

describe("ATT&CK control panel", () => {
  it("renders one technique in both outcome classes without losing its independent edges", () => {
    const { body } = render(AttackPanel, { props: { result: reviewedResult, status: "ready" } });
    expect(body.split('class="technique-card').length - 1).toBe(2);
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

  it("renders explicit loading, error, and reviewed-empty states", () => {
    const empty: AttackMappingResult = {
      ismCatalogVersion: "ISM-OSCAL-2026.09.4",
      attackVersion: "19.2",
      mappings: [],
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
