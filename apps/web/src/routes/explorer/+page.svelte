<script lang="ts">
  import { base } from "$app/paths";
  import { afterNavigate } from "$app/navigation";
  import type { Control, ControlDetail, Framework, GraphData, Group, Revision } from "@rule1/shared";
  import { onMount } from "svelte";
  import type { E8Mapping, Rule1DataClient } from "$lib/db/contracts";
  import { openRule1DataClient } from "$lib/db/rpc";
  import ControlTree from "$lib/explorer/ControlTree.svelte";
  import ContextPanel from "$lib/explorer/ContextPanel.svelte";
  import HistoryPanel from "$lib/explorer/HistoryPanel.svelte";
  import MappingPanel from "$lib/explorer/MappingPanel.svelte";
  import {
    APPLICABILITY,
    LatestRequest,
    controlsBySection,
    filterControls,
    readExplorerUrl,
    writeExplorerUrl,
    type Applicability,
    type ExplorerFilter,
    type ExplorerUrlState,
  } from "$lib/explorer/state";

  type CatalogueStatus = "loading" | "ready" | "error";
  type DetailTab = "overview" | "changelog" | "context";
  type RelatedStatus = "idle" | "loading" | "ready" | "error";

  let status = $state<CatalogueStatus>("loading");
  let errorMessage = $state("");
  let frameworks = $state<Framework[]>([]);
  let controls = $state<Control[]>([]);
  let groups = $state<Group[]>([]);
  let framework = $state<ExplorerUrlState["framework"]>("ism");
  let filter = $state<ExplorerFilter>("all");
  let applicability = $state<Applicability>("");
  let search = $state("");
  let selectedId = $state<string | null>(null);
  let detail = $state<ControlDetail | null>(null);
  let detailStatus = $state<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  let activeTab = $state<DetailTab>("overview");
  let controlHistory = $state<Revision[]>([]);
  let historyStatus = $state<RelatedStatus>("idle");
  let graph = $state<GraphData | null>(null);
  let graphStatus = $state<RelatedStatus>("idle");
  let mappings = $state<E8Mapping[]>([]);
  let mappingLevels = $state<string[]>([]);
  let mappingVersion = $state<string | null>(null);
  let mappingStatus = $state<RelatedStatus>("idle");
  let client: Rule1DataClient | null = null;

  const listRequests = new LatestRequest();
  const detailRequests = new LatestRequest();
  const historyRequests = new LatestRequest();
  const graphRequests = new LatestRequest();
  const mappingRequests = new LatestRequest();
  let filtered = $derived(filterControls(controls, filter, applicability, search));
  let bySection = $derived(controlsBySection(filtered));
  let isISM = $derived(framework === "ism");

  const frameworkLabel = (id: string): string => frameworks.find((item) => item.id === id)?.short_name ?? id;

  function currentUrlState(): ExplorerUrlState {
    return { framework, filter, applicability, search, selectedId };
  }

  function syncUrl(): void {
    const url = writeExplorerUrl(new URL(window.location.href), currentUrlState());
    if (activeTab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", activeTab);
    history.replaceState(null, "", url);
  }

  function resetRelatedData(): void {
    historyRequests.cancel();
    graphRequests.cancel();
    mappingRequests.cancel();
    controlHistory = [];
    graph = null;
    mappings = [];
    mappingLevels = [];
    mappingVersion = null;
    historyStatus = "idle";
    graphStatus = "idle";
    mappingStatus = "idle";
  }

  function clearSelection(resetTab = true): void {
    detailRequests.cancel();
    resetRelatedData();
    selectedId = null;
    detail = null;
    detailStatus = "idle";
    if (resetTab) activeTab = "overview";
  }

  function tabFromUrl(url: URL): DetailTab {
    const candidate = url.searchParams.get("tab");
    return candidate === "changelog" || candidate === "context" ? candidate : "overview";
  }

  async function loadMappings(requestFramework: ExplorerUrlState["framework"], id: string, version: string): Promise<void> {
    if (!client) return;
    const request = mappingRequests.begin();
    mappingStatus = "loading";
    try {
      const result = await client.e8Mappings({ framework: requestFramework, id, catalogVersion: version });
      if (!mappingRequests.isCurrent(request) || selectedId !== id || framework !== requestFramework) return;
      mappings = result;
      mappingStatus = "ready";
    } catch {
      if (mappingRequests.isCurrent(request) && selectedId === id && framework === requestFramework) {
        mappingStatus = "error";
      }
    }
  }

  async function loadHistory(): Promise<void> {
    if (!client || !selectedId || historyStatus === "loading" || historyStatus === "ready") return;
    const id = selectedId;
    const requestFramework = framework;
    const request = historyRequests.begin();
    historyStatus = "loading";
    try {
      const result = await client.controlHistory({ framework: requestFramework, id });
      if (!historyRequests.isCurrent(request) || selectedId !== id || framework !== requestFramework) return;
      controlHistory = result;
      historyStatus = "ready";
    } catch {
      if (historyRequests.isCurrent(request) && selectedId === id && framework === requestFramework) {
        historyStatus = "error";
      }
    }
  }

  async function loadGraph(): Promise<void> {
    if (!client || !selectedId || graphStatus === "loading" || graphStatus === "ready") return;
    const id = selectedId;
    const requestFramework = framework;
    const request = graphRequests.begin();
    graphStatus = "loading";
    try {
      const result = await client.graph({ framework: requestFramework, id });
      if (!graphRequests.isCurrent(request) || selectedId !== id || framework !== requestFramework) return;
      graph = result;
      graphStatus = "ready";
    } catch {
      if (graphRequests.isCurrent(request) && selectedId === id && framework === requestFramework) {
        graphStatus = "error";
      }
    }
  }

  function switchTab(tab: DetailTab): void {
    activeTab = tab;
    syncUrl();
    if (tab === "changelog") void loadHistory();
    if (tab === "context") void loadGraph();
  }

  function normalizeControlId(value: string): string | null {
    const query = value.trim().toLowerCase();
    const direct = controls.find((control) => control.id.toLowerCase() === query || control.display_id.toLowerCase() === query);
    if (direct) return direct.id;
    const numeric = query.replace(new RegExp(`^${framework}-`, "i"), "");
    if (/^\d+$/.test(numeric)) {
      return controls.find((control) => control.id.toLowerCase() === `${framework}-${numeric}`)?.id ?? null;
    }
    return null;
  }

  async function selectControl(id: string, updateUrl = true): Promise<void> {
    if (!client) return;
    const normalized = normalizeControlId(id);
    if (!normalized) {
      clearSelection();
      detailStatus = "empty";
      syncUrl();
      return;
    }

    selectedId = normalized;
    detail = null;
    detailStatus = "loading";
    resetRelatedData();
    if (updateUrl) activeTab = "overview";
    if (updateUrl) syncUrl();
    const request = detailRequests.begin();
    const requestFramework = framework;
    try {
      const result = await client.control({ framework: requestFramework, id: normalized });
      // A slow worker response must not replace a control selected afterwards.
      if (!detailRequests.isCurrent(request) || selectedId !== normalized || framework !== requestFramework) return;
      detail = result;
      detailStatus = result ? "ready" : "empty";
      const retainedMapping = result
        ? [result.latest, ...result.history].find(
            (revision) => (revision.e8_levels?.length ?? 0) > 0 && revision.catalog_version,
          )
        : undefined;
      if (retainedMapping?.catalog_version) {
        mappingLevels = retainedMapping.e8_levels ?? [];
        mappingVersion = retainedMapping.catalog_version;
        void loadMappings(requestFramework, normalized, retainedMapping.catalog_version);
      } else {
        mappingStatus = "ready";
      }
      if (activeTab === "changelog") void loadHistory();
      if (activeTab === "context") void loadGraph();
    } catch {
      if (detailRequests.isCurrent(request) && selectedId === normalized && framework === requestFramework) {
        detail = null;
        detailStatus = "error";
      }
    }
  }

  async function loadFramework(nextFramework: ExplorerUrlState["framework"], deepLink: string | null): Promise<void> {
    if (!client) return;
    const request = listRequests.begin();
    framework = nextFramework;
    controls = [];
    groups = [];
    clearSelection(false);
    status = "loading";
    try {
      const [controlResult, groupResult] = await Promise.all([
        client.controls({ framework: nextFramework }),
        client.groups({ framework: nextFramework }),
      ]);
      if (!listRequests.isCurrent(request) || framework !== nextFramework) return;
      controls = controlResult.controls;
      groups = groupResult;
      status = "ready";
      if (deepLink) await selectControl(deepLink, false);
    } catch {
      if (!listRequests.isCurrent(request)) return;
      status = "error";
      errorMessage = `Could not load ${frameworkLabel(nextFramework)} controls from the local catalogue.`;
    }
  }

  async function changeFramework(nextFramework: ExplorerUrlState["framework"]): Promise<void> {
    if (nextFramework === framework) return;
    filter = "all";
    applicability = "";
    search = "";
    clearSelection();
    syncUrl();
    await loadFramework(nextFramework, null);
    syncUrl();
  }

  function changeFilter(nextFilter: ExplorerFilter): void {
    filter = nextFilter;
    clearSelection();
    syncUrl();
  }

  function toggleApplicability(nextApplicability: Exclude<Applicability, "">): void {
    applicability = applicability === nextApplicability ? "" : nextApplicability;
    clearSelection();
    syncUrl();
  }

  function updateSearch(value: string): void {
    search = value;
    clearSelection();
    syncUrl();
  }

  async function applyNavigatedUrl(url: URL): Promise<void> {
    if (!client || frameworks.length === 0) return;
    const next = readExplorerUrl(url, frameworks.map((item) => item.id));
    activeTab = tabFromUrl(url);
    filter = next.filter;
    applicability = next.applicability;
    search = next.search;
    if (next.framework !== framework) {
      await loadFramework(next.framework, next.selectedId);
      syncUrl();
    } else if (next.selectedId) {
      await selectControl(next.selectedId, false);
    } else {
      clearSelection();
    }
  }

  afterNavigate(({ to }) => {
    if (to?.url) void applyNavigatedUrl(to.url);
  });

  onMount(() => {
    let mounted = true;
    let closeClient: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        const opened = await openRule1DataClient(base, window.location.href);
        if (!mounted) {
          await opened.close();
          return;
        }
        client = opened.client;
        closeClient = opened.close;
        frameworks = await client.frameworks();
        if (!mounted) return;
        const urlState = readExplorerUrl(new URL(window.location.href), frameworks.map((item) => item.id));
        activeTab = tabFromUrl(new URL(window.location.href));
        framework = urlState.framework;
        filter = urlState.filter;
        applicability = urlState.applicability;
        search = urlState.search;
        selectedId = urlState.selectedId;
        syncUrl();
        await loadFramework(urlState.framework, urlState.selectedId);
      } catch {
        if (mounted) {
          status = "error";
          errorMessage = "Could not open the local Rule1 catalogue. Reload to try again.";
        }
      }
    })();

    return () => {
      mounted = false;
      listRequests.cancel();
      detailRequests.cancel();
      historyRequests.cancel();
      graphRequests.cancel();
      mappingRequests.cancel();
      client = null;
      if (closeClient) void closeClient();
    };
  });
</script>

<svelte:head>
  <title>Explorer — rule1</title>
  <meta name="description" content="Browse and search security controls across five retained frameworks." />
  <link rel="canonical" href="https://wan0.net/rule1/explorer/" />
</svelte:head>

<div class="explorer">
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="filter-group-label">Framework</div>
      <div class="filter-row framework-row">
        {#each frameworks as item (item.id)}
          <button
            type="button"
            class="filter-pill framework-pill"
            class:active={framework === item.id}
            title={item.name}
            onclick={() => void changeFramework(item.id as ExplorerUrlState["framework"])}
          >{item.short_name}</button>
        {/each}
      </div>

      <label class="search-label" for="explorer-search">Search controls</label>
      <input
        id="explorer-search"
        class="search-input"
        type="search"
        placeholder="ID, title, or description"
        value={search}
        oninput={(event) => updateSearch(event.currentTarget.value)}
      />

      <div class="filter-group-label">Control filters</div>
      <div class="filter-row">
        {#each [
          { value: "all", label: "All" },
          { value: "changed", label: "Changed" },
          { value: "new", label: "New" },
          { value: "withdrawn", label: "Withdrawn" },
        ] as item}
          <button
            type="button"
            class="filter-pill"
            class:active={filter === item.value}
            onclick={() => changeFilter(item.value as ExplorerFilter)}
          >{item.label}</button>
        {/each}
      </div>

      {#if isISM}
        <div class="filter-group-label">Essential 8</div>
        <div class="filter-row">
          {#each ["e8", "ml1", "ml2", "ml3"] as value}
            <button
              type="button"
              class="filter-pill maturity-pill"
              class:active={filter === value}
              onclick={() => changeFilter(value as ExplorerFilter)}
            >{value.toUpperCase()}</button>
          {/each}
        </div>

        <div class="filter-group-label">Data classification</div>
        <div class="filter-row">
          {#each APPLICABILITY as value}
            <button
              type="button"
              class="filter-pill applicability-pill"
              class:active={applicability === value}
              data-applicability={value}
              onclick={() => toggleApplicability(value)}
            >{value}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="sidebar-section-label">Controls list <span>({filtered.length})</span></div>
    <div class="control-list">
      {#if status === "loading"}
        <p class="list-state" aria-live="polite">Loading local controls…</p>
      {:else if status === "error"}
        <p class="list-state error" role="status">{errorMessage}</p>
      {:else if filtered.length === 0}
        <p class="list-state">No controls match the current search and filters.</p>
      {:else}
        <ControlTree {groups} {bySection} {selectedId} onSelect={(id) => void selectControl(id)} />
        {#each bySection.get("__none__") ?? [] as control (control.id)}
          <button
            type="button"
            class="orphan-row"
            class:active={selectedId === control.id}
            onclick={() => void selectControl(control.id)}
          >
            <strong>{control.display_id}</strong>
            <span>{control.statement ?? control.title ?? "No description available."}</span>
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="detail-panel" aria-live="polite">
    {#if detailStatus === "loading"}
      <div class="detail-state">Loading control detail…</div>
    {:else if detailStatus === "error"}
      <div class="detail-state error">Could not load this control from the local catalogue.</div>
    {:else if detailStatus === "empty"}
      <div class="detail-state">
        <div class="empty-icon">?</div>
        <h1>Control not found</h1>
        <p>The selected control is not present in the latest {frameworkLabel(framework)} catalogue.</p>
      </div>
    {:else if detail}
      <article class="control-detail">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <span>{detail.section ?? "Controls"}</span><span>›</span><span aria-current="page">{detail.display_id}</span>
        </nav>
        <div class="control-heading">
          <div>
            <h1>{detail.title && !detail.title.startsWith("Control: ") ? detail.title : detail.display_id}</h1>
            {#if detail.title && !detail.title.startsWith("Control: ")}
              <div class="control-id">{detail.display_id}</div>
            {/if}
          </div>
          <span class="framework-badge">{frameworkLabel(framework)}</span>
        </div>
        <div class="tags">
          {#if detail.latest.change_type && detail.latest.change_type !== "unchanged"}
            <span class="tag tag-change">{detail.latest.change_type}</span>
          {/if}
          {#each detail.latest.applicability ?? [] as value}<span class="tag">{value}</span>{/each}
          {#each detail.latest.e8_levels ?? [] as value}<span class="tag tag-e8">{value}</span>{/each}
        </div>
        <div class="tabs" role="tablist" aria-label="Control detail views">
          {#each [
            { value: "overview", label: "Overview" },
            { value: "changelog", label: "Changelog" },
            { value: "context", label: "Context" },
          ] as tab}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              class:active={activeTab === tab.value}
              onclick={() => switchTab(tab.value as DetailTab)}
            >{tab.label}</button>
          {/each}
        </div>

        <div class="tab-panel" role="tabpanel">
          {#if activeTab === "overview"}
            <section class="description-card">
              <div class="section-label">
                <span>Description</span><span>{detail.latest.catalog_version ?? "Latest"}</span>
              </div>
              <p>{detail.latest.statement ?? "No description is available for this control."}</p>
            </section>
            {#if detail.section_overview}
              <section class="overview-card">
                <h2>Section overview</h2>
                <p>{detail.section_overview}</p>
              </section>
            {/if}
            <MappingPanel
              levels={mappingLevels}
              {mappings}
              version={mappingVersion}
              currentVersion={detail.latest.catalog_version ?? null}
              status={mappingStatus}
            />
          {:else if activeTab === "changelog"}
            <HistoryPanel history={controlHistory} status={historyStatus} />
          {:else}
            <ContextPanel {graph} status={graphStatus} onSelect={(id) => void selectControl(id)} />
          {/if}
        </div>
      </article>
    {:else}
      <div class="detail-state">
        <div class="empty-icon">▤</div>
        <h1>Select a control</h1>
        <p>Choose a control from the sidebar to explore its current detail.</p>
      </div>
    {/if}
  </section>
</div>

<style>
  :global(body) {
    overflow: hidden;
  }

  :global(main#main-content) {
    min-height: 0;
  }

  .explorer {
    display: grid;
    grid-template-columns: 310px minmax(0, 1fr);
    height: calc(100vh - 150px);
    min-height: 560px;
    overflow: hidden;
    border-top: 1px solid var(--border);
  }

  .sidebar {
    display: flex;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--bg-subtle);
  }

  .sidebar-header {
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
  }

  .filter-group-label,
  .search-label,
  .sidebar-section-label,
  .section-label {
    display: block;
    margin: 8px 0 5px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .filter-group-label:first-child {
    margin-top: 0;
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .framework-row {
    margin-bottom: 9px;
  }

  .filter-pill {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-card);
    color: var(--text-mid);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
  }

  .filter-pill:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .filter-pill.active {
    border-color: var(--text);
    background: var(--text);
    color: var(--text-inv);
  }

  .framework-pill.active {
    border-color: var(--accent);
    background: var(--accent);
    color: white;
  }

  .maturity-pill.active {
    border-color: var(--purple);
    background: var(--purple);
    color: white;
  }

  .applicability-pill[data-applicability="P"].active { background: #1d4ed8; color: white; }
  .applicability-pill[data-applicability="C"].active { background: #16a34a; color: white; }
  .applicability-pill[data-applicability="S"].active { background: #db2777; color: white; }
  .applicability-pill[data-applicability="TS"].active { background: #dc2626; color: white; }

  .search-input {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-card);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .search-input:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-bg);
  }

  .sidebar-section-label {
    margin: 0;
    padding: 9px 14px 5px;
  }

  .sidebar-section-label span {
    font-weight: 400;
    letter-spacing: 0;
  }

  .control-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 6px 12px;
  }

  .list-state {
    padding: 14px 8px;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.45;
  }

  .error {
    color: var(--red);
  }

  .orphan-row {
    display: block;
    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-mid);
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }

  .orphan-row:hover,
  .orphan-row.active {
    background: var(--bg-active);
  }

  .orphan-row strong,
  .orphan-row span {
    display: block;
  }

  .orphan-row strong {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .detail-panel {
    overflow-y: auto;
    background: var(--bg);
  }

  .detail-state {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 40px;
    color: var(--text-dim);
    text-align: center;
  }

  .detail-state h1 {
    margin: 8px 0 4px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 18px;
  }

  .detail-state p {
    max-width: 420px;
    margin: 0;
    font-size: 13px;
  }

  .empty-icon {
    color: var(--accent);
    font-size: 30px;
  }

  .control-detail {
    max-width: 920px;
    margin: 0 auto;
    padding: 30px 42px 60px;
  }

  .breadcrumb {
    display: flex;
    gap: 7px;
    margin-bottom: 14px;
    color: var(--text-dim);
    font-size: 11px;
  }

  .control-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
  }

  .control-heading h1 {
    margin: 0;
    color: var(--text);
    font-size: 21px;
    line-height: 1.35;
  }

  .control-id {
    margin-top: 5px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .framework-badge,
  .tag {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-subtle);
    color: var(--text-mid);
    font-size: 10px;
    font-weight: 600;
  }

  .framework-badge {
    flex-shrink: 0;
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 15px;
  }

  .tabs {
    display: flex;
    gap: 2px;
    margin-top: 22px;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    position: relative;
    padding: 9px 13px;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
    font-weight: 550;
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button.active {
    color: var(--accent);
  }

  .tabs button.active::after {
    position: absolute;
    right: 8px;
    bottom: -1px;
    left: 8px;
    height: 2px;
    background: var(--accent);
    content: "";
  }

  .tab-panel {
    padding-top: 20px;
  }

  .tag-change {
    border-color: var(--amber-border);
    background: var(--amber-bg);
    color: var(--amber);
    text-transform: capitalize;
  }

  .tag-e8 {
    border-color: var(--purple-border);
    background: var(--purple-bg);
    color: var(--purple);
  }

  .description-card {
    margin-top: 0;
  }

  .overview-card {
    margin-top: 24px;
  }

  .description-card {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-card);
  }

  .description-card .section-label {
    display: flex;
    justify-content: space-between;
    margin: 0;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
  }

  .description-card p,
  .overview-card p {
    margin: 0;
    color: var(--text-mid);
    font-size: 13.5px;
    line-height: 1.75;
    white-space: pre-line;
  }

  .description-card p {
    padding: 18px;
  }

  .overview-card h2 {
    margin: 0 0 8px;
    color: var(--text-dim);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .overview-card p {
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-subtle);
  }
</style>
