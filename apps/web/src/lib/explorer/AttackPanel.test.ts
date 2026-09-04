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
      evidence: [{ kind: "curator-note", note: "Effect depends on the authentication path." }],
    },
    {
      attackVersion: "19.2",
      ismCatalogVersion: "ISM-OSCAL-2026.09.4",
      techniqueId: "T1110",
      techniqueName: "Brute Force",
      techniqueDescription: "Attempt to gain access by guessing credentials.",
      techniqueUrl: "https://attack.mitre.org/techniques/T1110/",
      tactics: ["credential-access"],
      platforms: ["Linux"],
      parentTechniqueId: null,
      mitigationId: "M1027",
      mitigationName: "Password Policies",
      mitigationDescription: "Set password policies.",
      mitigationUrl: "https://attack.mitre.org/mitigations/M1027/",
      effect: "constrain",
      confidence: "medium",
      rationale: "Password policy may constrain password guessing.",
      evidence: [],
    },
  ],
};

describe("ATT&CK control panel", () => {
  it("renders reviewed many-to-many fixtures as one technique with distinct mitigation evidence", () => {
    const { body } = render(AttackPanel, { props: { result: reviewedResult, status: "ready" } });
    expect(body.split('class="technique-card').length - 1).toBe(1);
    expect(body).toContain("T1110");
    expect(body).toContain("Brute Force");
    expect(body).toContain("M1032 — Multi-factor Authentication");
    expect(body).toContain("M1027 — Password Policies");
    expect(body).toContain("high mapping confidence");
    expect(body).toContain("Effect depends on the authentication path.");
    expect(body).toContain("ATT&amp;CK 19.2");
    expect(body).toContain('href="https://attack.mitre.org/techniques/T1110/"');
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
