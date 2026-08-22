import type { Control, Group } from "@rule1/shared";
import { describe, expect, it } from "vitest";
import { FRAMEWORK_IDS } from "$lib/db/contracts";
import {
  LatestRequest,
  controlsBySection,
  countGroupControls,
  filterControls,
  groupContainsControl,
  readExplorerUrl,
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
