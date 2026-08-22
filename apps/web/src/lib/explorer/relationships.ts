import type { GraphData, GraphNode, Revision } from "@rule1/shared";
import type { E8Mapping } from "$lib/db/contracts";

export type MappingState = "unmapped" | "levels-only" | "mapped";

export function mappingState(levels: readonly string[], mappings: readonly E8Mapping[]): MappingState {
  if (levels.length === 0) return "unmapped";
  return mappings.length > 0 ? "mapped" : "levels-only";
}

export function historyLabel(revision: Revision, index: number): string {
  if (revision.change_type === "withdrawn") return "Withdrawn";
  if (index === 0) return "Current";
  if (revision.change_type === "new") return "New";
  if (revision.change_type === "modified") return "Modified";
  return "Unchanged";
}

export function graphNeighbors(graph: GraphData | null): GraphNode[] {
  return graph?.nodes.filter((node) => node.data.role === "neighbor") ?? [];
}

export function graphCenter(graph: GraphData | null): GraphNode | null {
  return graph?.nodes.find((node) => node.data.role === "center") ?? null;
}
