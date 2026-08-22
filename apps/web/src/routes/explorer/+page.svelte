<script lang="ts">
  import { base } from "$app/paths";
  import { afterNavigate } from "$app/navigation";
  import type { Control, ControlDetail, Framework, GraphData, Group, Revision } from "@rule1/shared";
  import { showToast } from "@link42/ui";
  import { onMount } from "svelte";
  import type { E8Mapping, Rule1DataClient } from "$lib/db/contracts";
  import { openRule1DataClient } from "$lib/db/rpc";
  import ControlTree from "$lib/explorer/ControlTree.svelte";
  import ContextPanel from "$lib/explorer/ContextPanel.svelte";
  import HistoryPanel from "$lib/explorer/HistoryPanel.svelte";
  import MappingPanel from "$lib/explorer/MappingPanel.svelte";
  import {
    controlCsv,
    controlJson,
    controlMarkdown,
    exportFavourites,
    importFavourites,
    loadFavourites,
    saveFavourites,
    type StorageLike,
  } from "$lib/local-user";
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
  let favourites = $state(new Set<string>());
  let favouriteStorage: StorageLike | undefined;
  let favouriteInput: HTMLInputElement | undefined = $state();
  let client: Rule1DataClient | null = null;

  const listRequests = new LatestRequest();
  const detailRequests = new LatestRequest();
  const historyRequests = new LatestRequest();
  const graphRequests = new LatestRequest();
  const mappingRequests = new LatestRequest();
  let filtered = $derived(filterControls(controls, filter, applicability, search, favourites));
  let bySection = $derived(controlsBySection(filtered));
  let isISM = $derived(framework === "ism");
  let changeCount = $derived(detail?.history.filter((revision) => revision.change_type === "modified").length ?? 0);
  let relatedCount = $derived(graph?.nodes.filter((node) => node.data.role === "neighbor").length ?? 0);
  let detailBreadcrumb = $derived.by(() => {
    if (!detail) return [];
    const sectionId = controls.find((control) => control.id === detail?.id)?.section_id ?? detail.section_id;
    return sectionId ? groupAncestors(groups, sectionId) : [];
  });
  let reportHref = $derived.by(() => {
    if (!detail) return "#";
    const subject = `[rule1] ${detail.display_id}: report an issue`;
    const body = [
      "Hi,",
      "",
      `I'm reporting an issue with ${detail.display_id}.`,
      `Catalogue version: ${detail.latest.catalog_version ?? "unknown"}`,
      `Page: ${window.location.href}`,
      "",
      "Issue:",
      "[Please describe the issue here]",
    ].join("\n");
    return `mailto:icd@wan0.net?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  const frameworkLabel = (id: string): string => frameworks.find((item) => item.id === id)?.short_name ?? id;

  const applicabilityLabels: Record<string, string> = {
    NC: "Not Classified",
    OS: "OFFICIAL:Sensitive",
    P: "PROTECTED",
    C: "CONFIDENTIAL",
    S: "SECRET",
    TS: "TOP SECRET",
  };

  function groupAncestors(tree: Group[], target: string, path: Group[] = []): Group[] {
    for (const group of tree) {
      const next = [...path, group];
      if (group.id === target) return next;
      const nested = groupAncestors(group.children, target, next);
      if (nested.length > 0) return nested;
    }
    return [];
  }

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
    if (!client || requestFramework !== "ism") return;
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

  function toggleFavourite(id: string): void {
    const next = new Set(favourites);
    const added = !next.has(id);
    if (added) next.add(id);
    else next.delete(id);
    favourites = next;
    if (!saveFavourites(favouriteStorage, next)) {
      showToast("warning", "Favourite updated for this session, but browser storage is unavailable.");
    } else {
      showToast("success", added ? "Added to favourites." : "Removed from favourites.");
    }
  }

  function downloadText(filename: string, content: string, type: string): void {
    const objectUrl = URL.createObjectURL(new Blob([content], { type }));
    const anchor = Object.assign(document.createElement("a"), { href: objectUrl, download: filename });
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  function downloadFavourites(): void {
    downloadText("rule1-favourites.json", exportFavourites(favourites), "application/json;charset=utf-8");
    showToast("success", `Exported ${favourites.size} favourite${favourites.size === 1 ? "" : "s"}.`);
  }

  async function handleFavouriteImport(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      showToast("error", "Favourites were not changed: the selected file is too large.");
      return;
    }
    try {
      const merged = importFavourites(favourites, await file.text());
      const added = merged.size - favourites.size;
      favourites = merged;
      const persisted = saveFavourites(favouriteStorage, merged);
      showToast(
        persisted ? "success" : "warning",
        persisted
          ? `Imported ${added} new favourite${added === 1 ? "" : "s"}.`
          : "Import succeeded for this session, but browser storage is unavailable.",
      );
    } catch {
      showToast("error", "Favourites were not changed: the selected file is not a valid Rule1 export.");
    }
  }

  function downloadControl(format: "json" | "csv" | "md"): void {
    if (!detail) return;
    const stem = detail.display_id.toLowerCase();
    if (format === "json") downloadText(`${stem}.json`, controlJson(detail), "application/json;charset=utf-8");
    else if (format === "csv") downloadText(`${stem}.csv`, controlCsv(detail), "text/csv;charset=utf-8");
    else downloadText(`${stem}.md`, controlMarkdown(detail), "text/markdown;charset=utf-8");
    showToast("success", `Exported ${detail.display_id} as ${format.toUpperCase()}.`);
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
      const retainedMapping = requestFramework === "ism" && result
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
      // Related-control counts are part of the overview, so load the local graph with the detail.
      void loadGraph();
      if (activeTab === "changelog") void loadHistory();
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
        try {
          favouriteStorage = window.localStorage;
        } catch {
          favouriteStorage = undefined;
        }
        const stored = loadFavourites(favouriteStorage);
        favourites = stored.favourites;
        if (stored.recovered) {
          showToast("warning", "Saved favourites could not be read; favourites will continue in this session.");
        }
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
          { value: "favourites", label: "★ Favourites" },
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
      <div class="favourite-actions">
        <button type="button" onclick={downloadFavourites}>Export favourites</button>
        <button type="button" onclick={() => favouriteInput?.click()}>Import favourites</button>
        <input bind:this={favouriteInput} type="file" accept="application/json,.json" onchange={(event) => void handleFavouriteImport(event)} />
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
        <ControlTree
          {groups}
          {bySection}
          {selectedId}
          {favourites}
          onSelect={(id) => void selectControl(id)}
          onToggleFavourite={toggleFavourite}
        />
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
        <header class="control-header">
          <nav class="breadcrumb" aria-label="Breadcrumb">
            {#if detailBreadcrumb.length > 0}
              {#each detailBreadcrumb as group}
                <span>{group.title}</span><span class="breadcrumb-separator">›</span>
              {/each}
            {:else if detail.section}
              <span>{detail.section}</span><span class="breadcrumb-separator">›</span>
            {/if}
            <span aria-current="page">{detail.display_id}</span>
          </nav>
          <div class="control-heading">
            <div class="control-title">
              {#if detail.title && !detail.title.startsWith("Control: ")}
                <h1>{detail.title}</h1>
                <div class="control-id">{detail.display_id}</div>
              {:else}
                <h1>{detail.latest.statement ?? detail.display_id}</h1>
              {/if}
            </div>
            <div class="detail-actions">
              <button
                type="button"
                class="detail-favourite"
                class:active={favourites.has(detail.id)}
                aria-label={favourites.has(detail.id)
                  ? `Remove ${detail.display_id} from favourites`
                  : `Add ${detail.display_id} to favourites`}
                title={favourites.has(detail.id) ? "Remove from favourites" : "Add to favourites"}
                onclick={() => toggleFavourite(detail!.id)}
              >★</button>
              <a class="report-issue" href={reportHref} aria-label="Report an issue with this control">
                <span aria-hidden="true">ⓘ</span> Report an issue
              </a>
            </div>
          </div>
          <div class="tags">
            {#each detail.latest.applicability ?? [] as value}
              <span class="classification-chip" data-classification={value}>{applicabilityLabels[value] ?? value}</span>
            {/each}
            {#if isISM && (detail.latest.e8_levels?.length ?? 0) > 0}
              <span class="tag-break" aria-hidden="true"></span>
              <span class="tag tag-neutral">Essential 8</span>
              {#each detail.latest.e8_levels ?? [] as value}<span class="tag tag-e8">{value}</span>{/each}
            {/if}
            {#if (detail.latest.change_type && detail.latest.change_type !== "unchanged") || (changeCount > 0 && detail.latest.change_type !== "new")}
              <span class="tag-break" aria-hidden="true"></span>
              {#if detail.latest.change_type && detail.latest.change_type !== "unchanged"}
                <span class="tag tag-change" data-change={detail.latest.change_type}>{detail.latest.change_type}</span>
              {/if}
              {#if changeCount > 0 && detail.latest.change_type !== "new"}
                <span class="tag tag-count">{changeCount} change{changeCount === 1 ? "" : "s"}</span>
              {/if}
            {/if}
          </div>
        </header>

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
            {#if isISM}
              <MappingPanel
                levels={mappingLevels}
                {mappings}
                version={mappingVersion}
                currentVersion={detail.latest.catalog_version ?? null}
                status={mappingStatus}
              />
            {/if}
            {#if detail.latest.change_type && detail.latest.change_type !== "unchanged"}
              <section class="latest-change-section">
                <h2>Latest change</h2>
                <div class="latest-change-card">
                  <span class="tag tag-change" data-change={detail.latest.change_type}>{detail.latest.change_type}</span>
                  <span>{detail.latest.catalog_version ?? "Latest catalogue"}</span>
                </div>
              </section>
            {/if}
            <section class="overview-stats" aria-label="Control stats">
              <h2>Control stats</h2>
              <div class="stats-grid" class:three-stats={!isISM}>
                <div class="stat"><strong>{detail.history.length}</strong><span>Versions</span></div>
                <div class="stat change-stat"><strong>{changeCount}</strong><span>Changes</span></div>
                <div class="stat"><strong>{graphStatus === "loading" ? "…" : relatedCount}</strong><span>Related</span></div>
                {#if isISM}
                  <div class="stat e8-stat"><strong>{(detail.latest.e8_levels?.length ?? 0) > 0 ? "E8" : "—"}</strong><span>Essential 8</span></div>
                {/if}
              </div>
            </section>
            <div class="control-exports" aria-label="Export control">
              <span>Export control</span>
              <button type="button" onclick={() => downloadControl("json")}>JSON</button>
              <button type="button" onclick={() => downloadControl("csv")}>CSV</button>
              <button type="button" onclick={() => downloadControl("md")}>Markdown</button>
            </div>
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

  .favourite-actions {
    display: flex;
    gap: 5px;
    margin-top: 7px;
  }

  .favourite-actions button,
  .detail-actions button {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-card);
    color: var(--text-dim);
    cursor: pointer;
    font-size: 10px;
  }

  .favourite-actions button:hover,
  .detail-actions button:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .favourite-actions input {
    display: none;
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
    min-height: 100%;
    padding-bottom: 60px;
  }

  .control-header {
    position: sticky;
    z-index: 10;
    top: 0;
    padding: 24px 28px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 12px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .breadcrumb [aria-current="page"] {
    color: var(--text);
  }

  .breadcrumb-separator {
    opacity: 0.5;
  }

  .control-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
  }

  .detail-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    flex-shrink: 0;
  }

  .detail-favourite {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-subtle);
    color: var(--text-dim);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
  }

  .detail-favourite:hover,
  .detail-favourite.active {
    border-color: var(--amber-border);
    background: var(--amber-bg);
    color: var(--amber);
  }

  .report-issue {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-subtle);
    color: var(--text-dim);
    font-size: 11.5px;
    font-weight: 500;
    text-decoration: none;
  }

  .report-issue:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .control-heading h1 {
    margin: 0;
    color: var(--text);
    font-size: 22px;
    letter-spacing: -0.03em;
    line-height: 1.25;
  }

  .control-title {
    min-width: 0;
    flex: 1;
  }

  .control-id {
    margin-top: 5px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .tag {
    padding: 3px 7px;
    border: 1px solid;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 15px;
  }

  .tag-break {
    flex-basis: 100%;
    height: 0;
  }

  .tag-neutral {
    border-color: var(--border);
    background: var(--bg-subtle);
    color: var(--text-mid);
  }

  .classification-chip {
    display: inline-flex;
    padding: 3px 8px;
    border: 1px solid #c8c8c8;
    border-radius: 5px;
    background: #fff;
    color: #1a1a1a;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .classification-chip[data-classification="OS"] { border-color: #4b5563; background: #6b7280; color: #fff; }
  .classification-chip[data-classification="P"] { border-color: #1e40af; background: #1d4ed8; color: #fff; }
  .classification-chip[data-classification="C"] { border-color: #15803d; background: #16a34a; color: #fff; }
  .classification-chip[data-classification="S"] { border-color: #be185d; background: #db2777; color: #fff; }
  .classification-chip[data-classification="TS"] { border-color: #b91c1c; background: #dc2626; color: #fff; }

  .tabs {
    display: flex;
    gap: 0;
    padding: 16px 28px 0;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    position: relative;
    padding: 8px 14px;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button.active {
    color: var(--text);
  }

  .tabs button.active::after {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    background: var(--text);
    content: "";
  }

  .tab-panel {
    max-width: 920px;
    margin: 0 auto;
    padding: 24px 28px 0;
  }

  .tag-change {
    border-color: var(--amber-border);
    background: var(--amber-bg);
    color: var(--amber);
    text-transform: capitalize;
  }

  .tag-change[data-change="new"] {
    border-color: var(--green-border);
    background: var(--green-bg);
    color: var(--green);
  }

  .tag-change[data-change="withdrawn"] {
    border-color: var(--red-border);
    background: var(--red-bg);
    color: var(--red);
  }

  .tag-count {
    border-color: var(--accent-border);
    background: var(--accent-bg);
    color: var(--accent);
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

  .overview-stats {
    margin-top: 24px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-subtle);
  }

  .latest-change-section {
    margin-top: 24px;
  }

  .latest-change-section h2 {
    margin: 0 0 10px;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .latest-change-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-card);
    color: var(--text-mid);
    font-size: 12px;
    font-weight: 500;
  }

  .overview-stats h2,
  .control-exports > span {
    margin: 0 0 10px;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .stats-grid.three-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .stat {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
  }

  .stat strong,
  .stat span {
    display: block;
  }

  .stat strong {
    margin-bottom: 2px;
    color: var(--text);
    font-size: 22px;
    letter-spacing: -0.03em;
    line-height: 1;
  }

  .stat span {
    color: var(--text-dim);
    font-size: 11px;
  }

  .change-stat strong { color: var(--amber); }
  .e8-stat strong { color: var(--accent); }

  .control-exports {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 24px;
  }

  .control-exports > span {
    margin: 0 4px 0 0;
  }

  .control-exports button {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-card);
    color: var(--text-dim);
    cursor: pointer;
    font-size: 10px;
  }

  .control-exports button:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }
</style>
