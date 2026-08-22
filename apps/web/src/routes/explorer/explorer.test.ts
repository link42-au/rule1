import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const explorerSource = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");
const treeSource = await readFile(new URL("../../lib/explorer/ControlTree.svelte", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../+layout.svelte", import.meta.url), "utf8");
const historySource = await readFile(new URL("../../lib/explorer/HistoryPanel.svelte", import.meta.url), "utf8");
const mappingSource = await readFile(new URL("../../lib/explorer/MappingPanel.svelte", import.meta.url), "utf8");
const contextSource = await readFile(new URL("../../lib/explorer/ContextPanel.svelte", import.meta.url), "utf8");

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

  it("loads history, mappings, and graph through named local client methods", () => {
    expect(explorerSource).toContain("client.controlHistory({ framework: requestFramework, id })");
    expect(explorerSource).toContain("client.e8Mappings({ framework: requestFramework, id, catalogVersion: version })");
    expect(explorerSource).toContain("client.graph({ framework: requestFramework, id })");
    expect(explorerSource).not.toMatch(/\bfetch\s*\(/);
  });

  it("protects every asynchronous relationship load from stale selection and framework responses", () => {
    expect(explorerSource).toContain("const historyRequests = new LatestRequest()");
    expect(explorerSource).toContain("const graphRequests = new LatestRequest()");
    expect(explorerSource).toContain("const mappingRequests = new LatestRequest()");
    expect(explorerSource).toContain(
      "!historyRequests.isCurrent(request) || selectedId !== id || framework !== requestFramework",
    );
    expect(explorerSource).toContain(
      "!graphRequests.isCurrent(request) || selectedId !== id || framework !== requestFramework",
    );
    expect(explorerSource).toContain(
      "!mappingRequests.isCurrent(request) || selectedId !== id || framework !== requestFramework",
    );
  });

  it("keeps missing retained relationship data explicit", () => {
    expect(historySource).toContain("No version history is retained for this control.");
    expect(mappingSource).toContain("No Essential Eight mapping is retained for this control.");
    expect(mappingSource).toContain("strategy names are not present in the archived source");
    expect(mappingSource).toContain("this does not imply current coverage");
    expect(contextSource).toContain("No related controls are retained in the same section.");
    expect(explorerSource).not.toContain("AI Summary");
  });

  it("restores relationship tabs from deep links without pulling unrelated features into scope", () => {
    expect(explorerSource).toContain('candidate === "changelog" || candidate === "context"');
    expect(explorerSource).toContain('url.searchParams.set("tab", activeTab)');
    expect(explorerSource).not.toContain("CompareResponse");
    expect(explorerSource).not.toContain("GlossaryTerm");
  });

  it("keeps favourites, imports, and control exports browser-local", () => {
    expect(explorerSource).toContain("loadFavourites(favouriteStorage)");
    expect(explorerSource).toContain("saveFavourites(favouriteStorage, next)");
    expect(explorerSource).toContain("importFavourites(favourites, await file.text())");
    expect(explorerSource).toContain('downloadControl("json")');
    expect(explorerSource).toContain('downloadControl("csv")');
    expect(explorerSource).toContain('downloadControl("md")');
    expect(explorerSource).toContain("Favourite updated for this session, but browser storage is unavailable.");
    expect(explorerSource).not.toMatch(/\bfetch\s*\(/);
    expect(explorerSource).not.toContain("login2");
    expect(explorerSource).not.toContain("community");
  });

  it("restores the familiar control header, tags, tabs, and description presentation", () => {
    expect(explorerSource).toContain('class="control-header"');
    expect(explorerSource).toContain('class="breadcrumb"');
    expect(explorerSource).toContain("groupAncestors(groups, sectionId)");
    expect(explorerSource).toContain('detail.title.startsWith("Control: ")');
    expect(explorerSource).toContain("detail.latest.statement ?? detail.display_id");
    expect(explorerSource).toContain('class="classification-chip"');
    expect(explorerSource).toContain('class="tag tag-neutral">Essential 8');
    expect(explorerSource).toContain('class="description-card"');
    expect(explorerSource).toContain("Overview");
    expect(explorerSource).toContain("Changelog");
    expect(explorerSource).toContain("Context");
  });

  it("keeps restored detail actions and stats independent of backend services", () => {
    expect(explorerSource).toContain("mailto:icd@wan0.net");
    expect(explorerSource).toContain('class="overview-stats"');
    expect(explorerSource).toContain("detail.history.length");
    expect(explorerSource).toContain('revision.change_type === "modified"');
    expect(explorerSource).toContain("relatedCount");
    expect(explorerSource).toContain("Essential 8");
    expect(explorerSource).toContain("void loadGraph()");
    expect(explorerSource).not.toMatch(/apiFetch|fetchFrameworks|CommunityPanel|controlVotes/);
  });

  it("shows the compact old-style latest change card from retained catalogue data", () => {
    expect(explorerSource).toContain('class="latest-change-section"');
    expect(explorerSource).toContain("Latest change");
    expect(explorerSource).toContain("data-change={detail.latest.change_type}");
    expect(explorerSource).toContain('detail.latest.catalog_version ?? "Latest catalogue"');
  });
});
