import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const explorerSource = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");
const treeSource = await readFile(new URL("../../lib/explorer/ControlTree.svelte", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../+layout.svelte", import.meta.url), "utf8");

describe("reviewed Rule1 explorer", () => {
  it("uses only the browser-local typed client for framework, hierarchy, list, and detail data", () => {
    expect(explorerSource).toContain('import { openRule1DataClient } from "$lib/db/rpc"');
    expect(explorerSource).toContain("await client.frameworks()");
    expect(explorerSource).toContain("client.controls({ framework: nextFramework })");
    expect(explorerSource).toContain("client.groups({ framework: nextFramework })");
    expect(explorerSource).toContain("client.control({ framework: requestFramework, id: normalized })");
    expect(explorerSource).not.toMatch(/\bfetch\s*\(/);
  });

  it("retains the old desktop information architecture without pulling later features forward", () => {
    expect(explorerSource).toContain("Framework");
    expect(explorerSource).toContain("Control filters");
    expect(explorerSource).toContain("Essential 8");
    expect(explorerSource).toContain("Data classification");
    expect(explorerSource).toContain("Controls list");
    expect(explorerSource).toContain("Section overview");
    expect(treeSource).toContain("ctrl-group-header");
    expect(explorerSource).not.toContain("Changelog");
    expect(explorerSource).not.toContain("Graph neighbourhood");
    expect(explorerSource).not.toContain("Favourites");
  });

  it("auto-opens only the selected control's ancestor groups", () => {
    expect(treeSource).toContain("openGroups.has(group.id) || groupContainsControl(group, selectedId, bySection)");
    expect(treeSource).toContain("{#if groupIsOpen(group)}");
    expect(treeSource).toContain("ontoggle={(event) => updateGroupOpen(group.id, event.currentTarget.open)}");
    expect(treeSource).not.toContain("depth === 0 && selectedId !== null");
  });

  it("shows explicit loading, empty, not-found, and error states", () => {
    expect(explorerSource).toContain("Loading local controls…");
    expect(explorerSource).toContain("No controls match the current search and filters.");
    expect(explorerSource).toContain("Select a control");
    expect(explorerSource).toContain("Control not found");
    expect(explorerSource).toContain("Could not load this control from the local catalogue.");
    expect(explorerSource).toContain("Could not open the local Rule1 catalogue. Reload to try again.");
  });

  it("guards detail state and removes stale URL selections when the current choice is cleared", () => {
    expect(explorerSource).toContain("const detailRequests = new LatestRequest()");
    expect(explorerSource).toContain("!detailRequests.isCurrent(request)");
    expect(explorerSource).toContain("selectedId = null");
    expect(explorerSource).toContain("writeExplorerUrl(new URL(window.location.href), currentUrlState())");
    expect(layoutSource).toContain('params.delete("id")');
    expect(layoutSource).toContain('params.delete("tab")');
  });

  it("uses the static hosting base path and closes the local database worker", () => {
    expect(explorerSource).toContain("openRule1DataClient(base, window.location.href)");
    expect(explorerSource).toContain("if (closeClient) void closeClient()");
  });
});
