import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const explorerSource = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");
const treeSource = await readFile(new URL("../../lib/explorer/ControlTree.svelte", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../+layout.svelte", import.meta.url), "utf8");
const historySource = await readFile(new URL("../../lib/explorer/HistoryPanel.svelte", import.meta.url), "utf8");
const mappingSource = await readFile(new URL("../../lib/explorer/MappingPanel.svelte", import.meta.url), "utf8");
const contextSource = await readFile(new URL("../../lib/explorer/ContextPanel.svelte", import.meta.url), "utf8");
const glossaryTextSource = await readFile(new URL("../../lib/explorer/GlossaryText.svelte", import.meta.url), "utf8");

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
    expect(treeSource).toContain("openGroupIds.has(group.id) || groupContainsControl(group, selectedId, bySection)");
    expect(treeSource).toContain("{#if groupIsOpen(group)}");
    expect(treeSource).toContain("ontoggle={(event) => onGroupToggle(group.id, event.currentTarget.open)}");
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

  it("does not request Essential Eight mappings outside the ISM framework", () => {
    const mappingLoader = explorerSource.slice(
      explorerSource.indexOf("async function loadMappings"),
      explorerSource.indexOf("async function loadHistory"),
    );
    const frameworkGate = mappingLoader.indexOf('if (!client || requestFramework !== "ism") return;');
    const mappingRequest = mappingLoader.indexOf("client.e8Mappings");
    expect(frameworkGate).toBeGreaterThanOrEqual(0);
    expect(mappingRequest).toBeGreaterThan(frameworkGate);
    expect(explorerSource).toContain('const retainedMapping = requestFramework === "ism" && result');
  });

  it("renders Essential Eight detail content only for ISM controls", () => {
    expect(explorerSource).toContain("{#if isISM && (detail.latest.e8_levels?.length ?? 0) > 0}");
    expect(explorerSource).toContain("{#if isISM}\n              <MappingPanel");
    expect(explorerSource).toContain('{#if isISM}\n                  <div class="stat e8-stat"');
  });

  it("uses a three-column stats layout for non-ISM controls", () => {
    expect(explorerSource).toContain('class="stats-grid" class:three-stats={!isISM}');
    expect(explorerSource).toContain(".stats-grid.three-stats");
    expect(explorerSource).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
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

  it("passes catalogue identity into the structured changelog presentation", () => {
    expect(explorerSource).toContain("frameworkLabel={frameworkLabel(framework)}");
    expect(historySource).toContain("buildHistoryEntries(history)");
    expect(historySource).toContain("removed from the {frameworkLabel} catalogue");
    expect(historySource).not.toContain("{@html");
  });

  it("restores relationship tabs from deep links without pulling unrelated features into scope", () => {
    expect(explorerSource).toContain('candidate === "changelog" || candidate === "context"');
    expect(explorerSource).toContain('url.searchParams.set("tab", activeTab)');
    expect(explorerSource).not.toContain("CompareResponse");
    expect(explorerSource).toContain("client.terms({ framework: nextFramework })");
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
    expect(explorerSource).toContain("latestRealChange(detail.latest, detail.history)");
    expect(explorerSource).toContain("data-change={latestChange.change_type}");
    expect(explorerSource).toContain('latestChange.catalog_version ?? "Latest catalogue"');
  });

  it("uses the global debounced search and opens exact, first, or no results", () => {
    expect(explorerSource).not.toContain('id="explorer-search"');
    expect(explorerSource).toContain("searchSelection(matches, search)");
    expect(explorerSource).toContain("if (match) await selectControl(match, false)");
    expect(explorerSource).toContain("else clearSelection()");
    expect(layoutSource).toContain("onInput: searchControls");
    expect(layoutSource).toContain("value: headerSearchValue");
    expect(layoutSource).toContain('page.url.searchParams.get("search") ?? ""');
  });

  it("controls hierarchy expansion from interactive breadcrumb ancestors", () => {
    expect(explorerSource).toContain("function revealBreadcrumbGroup(group: Group)");
    expect(explorerSource).toContain("openGroupIds = next");
    expect(explorerSource).toContain("scrollIntoView");
    expect(treeSource).toContain("data-group-id={group.id}");
    expect(treeSource).toContain("{openGroupIds}");
  });

  it("restores bounded persistent sidebar resizing and controlled hierarchy actions", () => {
    expect(explorerSource).toMatch(/style:--sidebar-width=\{`\$\{sidebarWidth\}px`\}/);
    expect(explorerSource).toContain('window.localStorage.getItem("rule1-sidebar-width")');
    expect(explorerSource).toContain('window.localStorage.setItem("rule1-sidebar-width", String(sidebarWidth))');
    expect(explorerSource).toContain('aria-label="Resize control navigation"');
    expect(explorerSource).toContain("openGroupIds = allGroupsExpanded ? new Set() : new Set(expandableIds)");
    expect(explorerSource).toContain('"Collapse all" : "Expand all"');
  });

  it("restores the reviewed ISM filter labels and state-specific active colours", () => {
    for (const label of ["Protected", "Confidential", "Secret", "Top Secret"]) {
      expect(explorerSource).toContain(`label: "${label}"`);
    }
    expect(explorerSource).toContain('{#each ["ml1", "ml2", "ml3"] as value}');
    expect(explorerSource).not.toContain('{#each ["e8", "ml1", "ml2", "ml3"] as value}');
    expect(explorerSource).toContain('.control-filter-pill[data-filter="favourites"].active');
    expect(explorerSource).toContain('.control-filter-pill[data-filter="withdrawn"].active');
    expect(explorerSource).toContain('.applicability-pill[data-applicability="NC"].active');
    expect(explorerSource).toContain('.applicability-pill[data-applicability="OS"].active');
  });

  it("shows retained change frequency honestly and explicit withdrawn tree badges", () => {
    expect(explorerSource).toContain("changeFrequency(detail?.history ?? [])");
    expect(explorerSource).toContain("No dated changes are retained for this control.");
    expect(explorerSource).toContain('class="spark-column"');
    expect(treeSource).toContain('{#if control.change_type === "withdrawn"}');
    expect(treeSource).toContain('class="withdrawn-badge"');
  });

  it("renders retained glossary annotations as structured text without raw HTML", () => {
    expect(explorerSource).toContain("<GlossaryText");
    expect(glossaryTextSource).toContain("{#each segments as segment}");
    expect(glossaryTextSource).toContain("title={segment.meaning}");
    expect(glossaryTextSource).not.toContain("{@html");
  });
});
