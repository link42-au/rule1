import type { Control, Group } from "@rule1/shared";
import { describe, expect, it } from "vitest";
import { FRAMEWORK_IDS } from "$lib/db/contracts";
import {
  LatestRequest,
  changeFrequency,
  clampSidebarWidth,
  controlsBySection,
  countGroupControls,
  expandableGroupIds,
  filterControls,
  glossarySegments,
  groupContainsControl,
  latestRealChange,
  readExplorerUrl,
  searchSelection,
  writeExplorerUrl,
  type ExplorerUrlState,
} from "./state";

const controls: Control[] = [
  {
    id: "ism-1",
    display_id: "ISM-1",
    title: "Patch management",
    statement: "Install security updates promptly.",
    section_id: "patching",
    change_type: "modified",
    e8_levels: ["ML1", "ML2"],
    applicability: ["P"],
  },
  {
    id: "ism-2",
    display_id: "ISM-2",
    statement: "Use multi-factor authentication.",
    section_id: "identity",
    change_type: "new",
    e8_levels: ["ML1"],
    applicability: ["P", "S"],
  },
  {
    id: "ism-3",
    display_id: "ISM-3",
    statement: "Retired control.",
    section_id: "identity",
    change_type: "withdrawn",
  },
];

describe("explorer URL state", () => {
  it.each(FRAMEWORK_IDS)("restores the %s framework on a direct refresh", (framework) => {
    const url = new URL(`https://wan0.net/rule1/explorer/?framework=${framework}&id=control-1&filter=new`);
    expect(readExplorerUrl(url, FRAMEWORK_IDS)).toMatchObject({ framework, selectedId: "control-1", filter: "new" });
  });

  it("falls back safely when the initial framework is invalid or unavailable", () => {
    expect(readExplorerUrl(new URL("https://wan0.net/rule1/explorer/?framework=nope"), FRAMEWORK_IDS).framework).toBe(
      "ism",
    );
    expect(readExplorerUrl(new URL("https://wan0.net/rule1/explorer/?framework=nzism"), ["ism"]).framework).toBe("ism");
  });

  it("keeps legacy ID search links working without retaining a false search", () => {
    const state = readExplorerUrl(new URL("https://wan0.net/rule1/explorer/?search=ISM-1749"), FRAMEWORK_IDS);
    expect(state.search).toBe("");
    expect(state.selectedId).toBe("ISM-1749");
  });

  it("opens an exact control from a legacy q link", () => {
    const state = readExplorerUrl(new URL("https://wan0.net/rule1/explorer/?q=ism-0009"), FRAMEWORK_IDS);
    expect(state.search).toBe("");
    expect(state.selectedId).toBe("ism-0009");
  });

  it("uses a free-text legacy q value as the explorer search", () => {
    const state = readExplorerUrl(new URL("https://wan0.net/rule1/explorer/?q=patch+management"), FRAMEWORK_IDS);
    expect(state.search).toBe("patch management");
    expect(state.selectedId).toBeNull();
  });

  it("gives explicit modern id and search parameters precedence over legacy q", () => {
    expect(
      readExplorerUrl(new URL("https://wan0.net/rule1/explorer/?id=ISM-2116&q=ism-0009"), FRAMEWORK_IDS),
    ).toMatchObject({ selectedId: "ISM-2116", search: "" });
    expect(
      readExplorerUrl(new URL("https://wan0.net/rule1/explorer/?search=patching&q=ism-0009"), FRAMEWORK_IDS),
    ).toMatchObject({ selectedId: null, search: "patching" });
  });

  it("removes legacy q when writing canonical explorer state", () => {
    const initial = new URL("https://wan0.net/rule1/explorer/?q=ism-0009&tab=context");
    const result = writeExplorerUrl(initial, {
      framework: "ism",
      filter: "all",
      applicability: "",
      search: "",
      selectedId: "ism-0009",
    });
    expect(result.searchParams.has("q")).toBe(false);
    expect(result.searchParams.get("id")).toBe("ism-0009");
    expect(result.searchParams.get("tab")).toBe("context");
  });

  it("removes cleared selection, search, and default state from the URL", () => {
    const initial = new URL(
      "https://wan0.net/rule1/explorer/?framework=nzism&id=NZISM-1&search=old&filter=new&tab=context",
    );
    const state: ExplorerUrlState = {
      framework: "ism",
      filter: "all",
      applicability: "",
      search: "",
      selectedId: null,
    };
    const result = writeExplorerUrl(initial, state);
    expect(result.searchParams.has("framework")).toBe(false);
    expect(result.searchParams.has("id")).toBe(false);
    expect(result.searchParams.has("search")).toBe(false);
    expect(result.searchParams.has("filter")).toBe(false);
    expect(result.searchParams.get("tab")).toBe("context");
  });
});

describe("explorer filters and hierarchy", () => {
  it("filters searches, changes, maturity levels, classifications, and withdrawals", () => {
    expect(filterControls(controls, "all", "", "").map((item) => item.id)).toEqual(["ism-1", "ism-2"]);
    expect(filterControls(controls, "changed", "", "").map((item) => item.id)).toEqual(["ism-1"]);
    expect(filterControls(controls, "new", "", "").map((item) => item.id)).toEqual(["ism-2"]);
    expect(filterControls(controls, "withdrawn", "", "").map((item) => item.id)).toEqual(["ism-3"]);
    expect(filterControls(controls, "ml2", "", "").map((item) => item.id)).toEqual(["ism-1"]);
    expect(filterControls(controls, "all", "S", "").map((item) => item.id)).toEqual(["ism-2"]);
    expect(filterControls(controls, "all", "", "PATCH").map((item) => item.id)).toEqual(["ism-1"]);
    expect(filterControls(controls, "favourites", "", "", new Set(["ism-2"])).map((item) => item.id)).toEqual([
      "ism-2",
    ]);
  });

  it("opens an exact control ID before otherwise choosing the first filtered result", () => {
    expect(searchSelection([controls[0], controls[1]], "ISM-2")).toBe("ism-2");
    expect(searchSelection([controls[0], controls[1]], "security")).toBe("ism-1");
    expect(searchSelection([], "missing")).toBeNull();
    expect(searchSelection(controls, "")).toBeNull();
  });

  it("counts controls through nested framework hierarchy", () => {
    const grouped = controlsBySection(controls);
    const group: Group = {
      id: "root",
      title: "Root",
      parent_id: null,
      control_count: 0,
      children: [
        { id: "patching", title: "Patching", parent_id: "root", control_count: 1, children: [] },
        { id: "identity", title: "Identity", parent_id: "root", control_count: 2, children: [] },
      ],
    };
    expect(countGroupControls(group, grouped)).toBe(3);
  });

  it("opens only the selected control's ancestor path", () => {
    const grouped = controlsBySection(controls);
    const patching: Group = {
      id: "patching-root",
      title: "Patching",
      parent_id: null,
      control_count: 1,
      children: [{ id: "patching", title: "Updates", parent_id: "patching-root", control_count: 1, children: [] }],
    };
    const identity: Group = {
      id: "identity-root",
      title: "Identity",
      parent_id: null,
      control_count: 2,
      children: [
        { id: "identity", title: "Authentication", parent_id: "identity-root", control_count: 2, children: [] },
      ],
    };

    expect(groupContainsControl(patching, "ism-2", grouped)).toBe(false);
    expect(groupContainsControl(identity, "ism-2", grouped)).toBe(true);
    expect(groupContainsControl(identity.children[0], "ism-2", grouped)).toBe(true);
    expect(groupContainsControl(identity, null, grouped)).toBe(false);
  });

  it("collects only visible hierarchy groups for expand all", () => {
    const grouped = controlsBySection(controls.slice(0, 2));
    const groups: Group[] = [
      {
        id: "root",
        title: "Root",
        parent_id: null,
        control_count: 0,
        children: [
          { id: "patching", title: "Patching", parent_id: "root", control_count: 1, children: [] },
          { id: "empty", title: "Empty", parent_id: "root", control_count: 0, children: [] },
        ],
      },
    ];
    expect([...expandableGroupIds(groups, grouped)]).toEqual(["root", "patching"]);
  });

  it("clamps persisted sidebar widths to the reviewed desktop bounds", () => {
    expect(clampSidebarWidth("420")).toBe(420);
    expect(clampSidebarWidth(50)).toBe(180);
    expect(clampSidebarWidth(900)).toBe(480);
    expect(clampSidebarWidth("not-a-width")).toBe(310);
  });
});

describe("explorer retained detail presentation", () => {
  it("finds the newest actual change when the latest snapshot is unchanged", () => {
    expect(
      latestRealChange({ catalog_version: "v3", change_type: "unchanged" }, [
        { catalog_version: "v3", change_type: "unchanged" },
        { catalog_version: "v2", change_type: "modified" },
        { catalog_version: "v1", change_type: "new" },
      ]),
    ).toMatchObject({ catalog_version: "v2", change_type: "modified" });
    expect(latestRealChange({ change_type: "unchanged" }, [{ change_type: "unchanged" }])).toBeNull();
  });

  it("returns safe structured glossary segments only for retained terms", () => {
    expect(glossarySegments("Use access control safely.", [])).toEqual([{ text: "Use access control safely." }]);
    expect(
      glossarySegments("Access control and access control <script> remain text.", [
        { id: "access-control", term: "access control", meaning: 'Restrict <b>access</b> "carefully".' },
      ]),
    ).toEqual([
      { text: "Access control", meaning: 'Restrict <b>access</b> "carefully".' },
      { text: " and " },
      { text: "access control" },
      { text: " <script> remain text." },
    ]);
  });

  it("builds a continuous change-frequency series and stays honest when dates are absent", () => {
    expect(
      changeFrequency([
        { commit_date: "2022-01-10", change_type: "new" },
        { commit_date: "2022-06-01", change_type: "modified" },
        { catalog_version: "2024-03", change_type: "withdrawn" },
        { commit_date: "2025-01-01", change_type: "unchanged" },
      ]),
    ).toEqual([
      { year: 2022, changes: 2 },
      { year: 2023, changes: 0 },
      { year: 2024, changes: 1 },
    ]);
    expect(
      changeFrequency([{ change_type: "modified" }, { commit_date: "2026-01-01", change_type: "unchanged" }]),
    ).toEqual([]);
  });
});

describe("explorer request ordering", () => {
  it("rejects a late detail response after a newer selection or clear", () => {
    const requests = new LatestRequest();
    const first = requests.begin();
    const second = requests.begin();
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
    requests.cancel();
    expect(requests.isCurrent(second)).toBe(false);
  });
});
