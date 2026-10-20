import { describe, expect, it } from "vitest";
import { essentialsInfo, essentialsSearchText } from "./essentials-model";
import { filterControls } from "./state";
import { filterControls as apiFilter } from "$lib/db/filters";

const groups = ["Not effective", "Partially effective", "Fully effective"].map((title) => ({
  class: "indicator-group",
  title,
  parts: [{ name: "item", prose: `${title} executive evidence` }],
}));
const metadata = {
  oscal: {
    parts: [
      { class: "indicators-of-good-practice", parts: groups },
      { class: "future-part", prose: "Unknown but retained" },
    ],
  },
  essentials: {
    ancestors: [
      { id: "GOV-01", title: "Accountability", class: "essentials-principle", parts: [{ prose: "Board accountable" }] },
    ],
    domains: [
      {
        id: "governance-and-culture",
        description: "Governance",
        phases: ["phase-1", "phase-2"],
        source: "https://www.cyber.gov.au/profile",
      },
    ],
    techniques: [
      { title: "Valid Accounts", rlinks: [{ href: "https://attack.mitre.org/techniques/T1078/" }] },
      { title: "Unsafe", rlinks: [{ href: "javascript:alert(1)" }] },
    ],
  },
};

describe("ASD Essentials presentation", () => {
  it("preserves principle, domain, phase and indicator ordering and retains unknown parts", () => {
    const result = essentialsInfo(metadata);
    expect(result.principles[0].id).toBe("GOV-01");
    expect(result.domains[0].phases).toEqual(["phase-1", "phase-2"]);
    expect(result.indicators[0].parts).toEqual(groups);
    expect(result.additional[0].prose).toBe("Unknown but retained");
    expect(result.techniques).toEqual([{ title: "Valid Accounts", url: "https://attack.mitre.org/techniques/T1078/" }]);
  });

  it("searches assessment indicators, domain and principle context through Explorer and API filters", () => {
    const controls = [{ id: "IT.GOV-01.1", display_id: "IT.GOV-01.1", statement: "Action", metadata }];
    for (const search of [
      "executive evidence",
      "governance-and-culture",
      "Board accountable",
      "unknown but retained",
    ]) {
      expect(filterControls(controls, "all", "", search, new Set())).toEqual(controls);
      expect(apiFilter(controls, "asd-essentials-enterprise-it", { search })).toEqual(controls);
    }
    expect(essentialsSearchText(undefined)).toBe("");
    expect(essentialsInfo(undefined).domains).toEqual([]);
  });
});
