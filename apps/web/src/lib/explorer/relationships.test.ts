import type { GraphData, Revision } from "@rule1/shared";
import { describe, expect, it } from "vitest";
import { graphCenter, graphNeighbors, historyLabel, mappingState } from "./relationships";

describe("explorer history presentation", () => {
  it("labels current, changed, new, withdrawn, and unchanged versions without inference", () => {
    const revisions: Revision[] = [
      { catalog_version: "5", change_type: "modified" },
      { catalog_version: "4", change_type: "modified" },
      { catalog_version: "3", change_type: "withdrawn" },
      { catalog_version: "2", change_type: "new" },
      { catalog_version: "1", change_type: "unchanged" },
    ];
    expect(revisions.map(historyLabel)).toEqual(["Current", "Modified", "Withdrawn", "New", "Unchanged"]);
  });
});

describe("explorer mapping presentation", () => {
  it("distinguishes unmapped controls from retained levels and named mappings", () => {
    expect(mappingState([], [])).toBe("unmapped");
    expect(mappingState(["ML1"], [])).toBe("levels-only");
    expect(mappingState(["ML1"], [{ level: "ML1", strategy: "Patch applications" }])).toBe("mapped");
  });
});

describe("explorer relationship graph", () => {
  it("extracts the center and same-section neighbors", () => {
    const graph: GraphData = {
      nodes: [
        { data: { id: "ism-1", display_id: "ISM-1", role: "center" } },
        { data: { id: "ism-2", display_id: "ISM-2", role: "neighbor" } },
      ],
      edges: [{ data: { id: "ism-1--ism-2", source: "ism-1", target: "ism-2", group: "Identity" } }],
      group: { id: "identity", title: "Identity" },
    };
    expect(graphCenter(graph)?.data.id).toBe("ism-1");
    expect(graphNeighbors(graph).map((node) => node.data.id)).toEqual(["ism-2"]);
  });

  it("treats absent graph data as an honest empty relationship set", () => {
    expect(graphCenter(null)).toBeNull();
    expect(graphNeighbors({ nodes: [], edges: [], group: null })).toEqual([]);
  });
});
