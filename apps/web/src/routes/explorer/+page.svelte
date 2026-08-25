<script lang="ts">
  import { base } from "$app/paths";
  import { afterNavigate, replaceState } from "$app/navigation";
  import type { Control, ControlDetail, Framework, GlossaryTerm, GraphData, Group, Revision } from "@rule1/shared";
  import { showToast } from "@link42/ui";
  import { onMount } from "svelte";
  import type { E8Mapping, Rule1DataClient } from "$lib/db/contracts";
  import { openRule1DataClient } from "$lib/db/rpc";
  import ControlTree from "$lib/explorer/ControlTree.svelte";
  import GlossaryText from "$lib/explorer/GlossaryText.svelte";
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
    SIDEBAR_WIDTH_DEFAULT,
    SIDEBAR_WIDTH_MAX,
    SIDEBAR_WIDTH_MIN,
    changeFrequency,
    clampSidebarWidth,
    controlsBySection,
    expandableGroupIds,
    filterControls,
    readExplorerUrl,
    latestRealChange,
    searchSelection,
    writeExplorerUrl,
    type Applicability,
    type ExplorerFilter,
    type ExplorerUrlState,
  } from "$lib/explorer/state";

  type CatalogueStatus = "loading" | "ready" | "error";
  type DetailTab = "overview" | "changelog" | "context";
  type RelatedStatus = "idle" | "loading" | "ready" | "error";

  const DETAIL_TABS: ReadonlyArray<{ value: DetailTab; label: string }> = [
    { value: "overview", label: "Overview" },
    { value: "changelog", label: "Changelog" },
    { value: "context", label: "Context" },
  ];

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
  let glossaryTerms = $state<GlossaryTerm[]>([]);
  let openGroupIds = $state(new Set<string>());
  let favouriteStorage: StorageLike | undefined;
  let favouriteInput: HTMLInputElement | undefined = $state();
  let sidebarWidth = $state(SIDEBAR_WIDTH_DEFAULT);
  let resizingSidebar = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = SIDEBAR_WIDTH_DEFAULT;
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
  let latestChange = $derived(detail ? latestRealChange(detail.latest, detail.history) : null);
  let frequency = $derived(changeFrequency(detail?.history ?? []));
  let maxFrequency = $derived(Math.max(1, ...frequency.map((point) => point.changes)));
  let expandableIds = $derived(expandableGroupIds(groups, bySection));
  let allGroupsExpanded = $derived(expandableIds.size > 0 && [...expandableIds].every((id) => openGroupIds.has(id)));
  let mobileDetailVisible = $derived(selectedId !== null || detailStatus !== "idle");
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
    replaceState(url, {});
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

  function showControlList(): void {
    clearSelection();
    syncUrl();
  }

  function updateGroupOpen(id: string, open: boolean): void {
    const next = new Set(openGroupIds);
    if (open) next.add(id);
    else next.delete(id);
    openGroupIds = next;
  }

  function toggleAllGroups(): void {
    openGroupIds = allGroupsExpanded ? new Set() : new Set(expandableIds);
  }

  function beginSidebarResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    resizingSidebar = true;
    resizeStartX = event.clientX;
    resizeStartWidth = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizeSidebar(event: PointerEvent): void {
    if (!resizingSidebar) return;
    sidebarWidth = clampSidebarWidth(resizeStartWidth + event.clientX - resizeStartX);
  }

  function finishSidebarResize(): void {
    if (!resizingSidebar) return;
    resizingSidebar = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    persistSidebarWidth();
  }

  function persistSidebarWidth(): void {
    try {
      window.localStorage.setItem("rule1-sidebar-width", String(sidebarWidth));
    } catch {
      // Resizing remains useful for this session when storage is unavailable.
    }
  }

  function handleSidebarResizeKey(event: KeyboardEvent): void {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = sidebarWidth - 16;
    else if (event.key === "ArrowRight") nextWidth = sidebarWidth + 16;
    else if (event.key === "Home") nextWidth = SIDEBAR_WIDTH_MIN;
    else if (event.key === "End") nextWidth = SIDEBAR_WIDTH_MAX;
    if (nextWidth === null) return;
    event.preventDefault();
    sidebarWidth = clampSidebarWidth(nextWidth);
    persistSidebarWidth();
  }

  function revealBreadcrumbGroup(group: Group): void {
    const index = detailBreadcrumb.findIndex((candidate) => candidate.id === group.id);
    const next = new Set(openGroupIds);
    for (const ancestor of detailBreadcrumb.slice(0, index + 1)) next.add(ancestor.id);
    openGroupIds = next;
    requestAnimationFrame(() => {
      const escaped = CSS.escape(group.id);
      document.querySelector<HTMLElement>(`.ctrl-group[data-group-id="${escaped}"]`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
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

  function handleTabKey(event: KeyboardEvent, tab: DetailTab): void {
    const currentIndex = DETAIL_TABS.findIndex((item) => item.value === tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % DETAIL_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + DETAIL_TABS.length) % DETAIL_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = DETAIL_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = DETAIL_TABS[nextIndex].value;
    switchTab(nextTab);
    document.getElementById(`control-tab-${nextTab}`)?.focus();
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

  async function selectControl(id: string, updateUrl = true, focusDetail = updateUrl): Promise<void> {
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
      if (focusDetail && result) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-control-heading]")?.focus());
      }
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
    glossaryTerms = [];
    openGroupIds = new Set();
    clearSelection(false);
    status = "loading";
    try {
      const [controlResult, groupResult, termResult] = await Promise.all([
        client.controls({ framework: nextFramework }),
        client.groups({ framework: nextFramework }),
        client.terms({ framework: nextFramework }).catch(() => ({ terms: [], total: 0 })),
      ]);
      if (!listRequests.isCurrent(request) || framework !== nextFramework) return;
      controls = controlResult.controls;
      groups = groupResult;
      glossaryTerms = termResult.terms;
      status = "ready";
      if (deepLink) await selectControl(deepLink, false);
      else if (search) {
        await selectSearchResult(false);
        syncUrl();
      }
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
    if (search) void selectSearchResult();
    else {
      clearSelection();
      syncUrl();
    }
  }

  function toggleApplicability(nextApplicability: Exclude<Applicability, "">): void {
    applicability = applicability === nextApplicability ? "" : nextApplicability;
    if (search) void selectSearchResult();
    else {
      clearSelection();
      syncUrl();
    }
  }

  async function selectSearchResult(updateUrl = true): Promise<void> {
    const matches = filterControls(controls, filter, applicability, search, favourites);
    const match = searchSelection(matches, search);
    if (match) await selectControl(match, false, false);
    else clearSelection();
    if (updateUrl) syncUrl();
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
      syncUrl();
    } else if (next.search) {
      clearSelection();
      syncUrl();
      await selectSearchResult();
    } else {
      clearSelection();
      syncUrl();
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
          sidebarWidth = clampSidebarWidth(window.localStorage.getItem("rule1-sidebar-width"));
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
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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

<svelte:window onpointermove={resizeSidebar} onpointerup={finishSidebarResize} onpointercancel={finishSidebarResize} />

<div class="explorer" class:show-mobile-detail={mobileDetailVisible} style:--sidebar-width={`${sidebarWidth}px`}>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="filter-group-label">Framework</div>
      <div class="filter-row framework-row" role="group" aria-label="Security framework">
        {#each frameworks as item (item.id)}
          <button
            type="button"
            class="filter-pill framework-pill"
            class:active={framework === item.id}
            aria-pressed={framework === item.id}
            title={item.name}
            onclick={() => void changeFramework(item.id as ExplorerUrlState["framework"])}
          >{item.short_name}</button>
        {/each}
      </div>

      <div class="filter-group-label">Control filters</div>
      <div class="filter-row" role="group" aria-label="Control filters">
        {#each [
          { value: "all", label: "All" },
          { value: "favourites", label: "★ Favourites" },
          { value: "changed", label: "Changed" },
          { value: "new", label: "New" },
          { value: "withdrawn", label: "Withdrawn" },
        ] as item}
          <button
            type="button"
            class="filter-pill control-filter-pill"
            data-filter={item.value}
            class:active={filter === item.value}
            aria-pressed={filter === item.value}
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
        <div class="filter-row" role="group" aria-label="Essential Eight maturity">
          {#each ["ml1", "ml2", "ml3"] as value}
            <button
              type="button"
              class="filter-pill maturity-pill"
              class:active={filter === value}
              aria-pressed={filter === value}
              onclick={() => changeFilter(value as ExplorerFilter)}
            >{value.toUpperCase()}</button>
          {/each}
        </div>

        <div class="filter-group-label">Data classification</div>
        <div class="filter-row" role="group" aria-label="Data classification">
          {#each [
            { value: "NC", label: "NC" },
            { value: "OS", label: "OS" },
            { value: "P", label: "Protected" },
            { value: "C", label: "Confidential" },
            { value: "S", label: "Secret" },
            { value: "TS", label: "Top Secret" },
          ] as item}
            <button
              type="button"
              class="filter-pill applicability-pill"
              class:active={applicability === item.value}
              aria-pressed={applicability === item.value}
              data-applicability={item.value}
              onclick={() => toggleApplicability(item.value as (typeof APPLICABILITY)[number])}
            >{item.label}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="sidebar-section-row">
      <div class="sidebar-section-label">Controls list <span>({filtered.length})</span></div>
      <button
        type="button"
        class="hierarchy-toggle"
        aria-label={allGroupsExpanded ? "Collapse all control groups" : "Expand all control groups"}
        aria-expanded={allGroupsExpanded}
        title={allGroupsExpanded ? "Collapse all" : "Expand all"}
        onclick={toggleAllGroups}
      >{allGroupsExpanded ? "Collapse all" : "Expand all"}</button>
    </div>
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
          {openGroupIds}
          onSelect={(id) => void selectControl(id)}
          onToggleFavourite={toggleFavourite}
          onGroupToggle={updateGroupOpen}
        />
        {#each bySection.get("__none__") ?? [] as control (control.id)}
          <button
            type="button"
            class="orphan-row"
            class:active={selectedId === control.id}
            onclick={() => void selectControl(control.id)}
          >
            <strong>{control.display_id}</strong>
            {#if control.change_type === "withdrawn"}<span class="withdrawn-badge">Withdrawn</span>{/if}
            <span>{control.statement ?? control.title ?? "No description available."}</span>
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <!-- A focusable separator is the ARIA-prescribed keyboard-resizable split-pane control. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="resize-handle"
    class:active={resizingSidebar}
    role="separator"
    aria-label="Resize control navigation"
    aria-orientation="vertical"
    aria-valuemin="180"
    aria-valuemax="480"
    aria-valuenow={sidebarWidth}
    tabindex="0"
    onkeydown={handleSidebarResizeKey}
    onpointerdown={beginSidebarResize}
  ></div>

  <section class="detail-panel">
    <div class="mobile-detail-nav">
      <button type="button" onclick={showControlList}><span aria-hidden="true">←</span> Back to controls</button>
    </div>
    {#if detailStatus === "loading"}
      <div class="detail-state" role="status">Loading control detail…</div>
    {:else if detailStatus === "error"}
      <div class="detail-state error" role="alert">Could not load this control from the local catalogue.</div>
    {:else if detailStatus === "empty"}
      <div class="detail-state" role="status">
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
                <button type="button" onclick={() => revealBreadcrumbGroup(group)}>{group.title}</button><span class="breadcrumb-separator">›</span>
              {/each}
            {:else if detail.section}
              <span>{detail.section}</span><span class="breadcrumb-separator">›</span>
            {/if}
            <span aria-current="page">{detail.display_id}</span>
          </nav>
          <div class="control-heading">
            <div class="control-title">
              {#if detail.title && !detail.title.startsWith("Control: ")}
                <h1 data-control-heading tabindex="-1">{detail.title}</h1>
                <div class="control-id">{detail.display_id}</div>
              {:else}
                <h1 data-control-heading tabindex="-1">{detail.latest.statement ?? detail.display_id}</h1>
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
                aria-pressed={favourites.has(detail.id)}
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
          {#each DETAIL_TABS as tab}
            <button
              id={`control-tab-${tab.value}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              aria-controls="control-tabpanel"
              tabindex={activeTab === tab.value ? 0 : -1}
              class:active={activeTab === tab.value}
              onclick={() => switchTab(tab.value)}
              onkeydown={(event) => handleTabKey(event, tab.value)}
            >{tab.label}</button>
          {/each}
        </div>

        <div id="control-tabpanel" class="tab-panel" role="tabpanel" aria-labelledby={`control-tab-${activeTab}`}>
          {#if activeTab === "overview"}
            <section class="description-card">
              <div class="section-label">
                <span>Description</span><span>{detail.latest.catalog_version ?? "Latest"}</span>
              </div>
              <p><GlossaryText text={detail.latest.statement ?? "No description is available for this control."} terms={glossaryTerms} /></p>
            </section>
            {#if detail.section_overview}
              <section class="overview-card">
                <h2>Section overview</h2>
                <p><GlossaryText text={detail.section_overview} terms={glossaryTerms} /></p>
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
            {#if latestChange}
              <section class="latest-change-section">
                <h2>Latest change</h2>
                <div class="latest-change-card">
                  <span class="tag tag-change" data-change={latestChange.change_type}>{latestChange.change_type}</span>
                  <span>{latestChange.catalog_version ?? "Latest catalogue"}</span>
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
            <section class="change-frequency" aria-label="Change frequency">
              <h2>Change frequency</h2>
              {#if frequency.length > 0}
                <div class="sparkline">
                  {#each frequency as point (point.year)}
                    <span
                      class="spark-column"
                      class:has-change={point.changes > 0}
                      class:major-change={point.changes > 1}
                      style:height={`${Math.max(3, Math.round((point.changes / maxFrequency) * 32))}px`}
                      title={`${point.year}${point.changes > 0 ? `: ${point.changes} change${point.changes === 1 ? "" : "s"}` : ": no retained changes"}`}
                    ></span>
                  {/each}
                </div>
                <div class="spark-axis">
                  <span>{frequency[0].year}</span>
                  {#if frequency.length > 2}<span>{frequency[Math.floor(frequency.length / 2)].year}</span>{/if}
                  {#if frequency.length > 1}<span>{frequency.at(-1)?.year}</span>{/if}
                </div>
              {:else}
                <p class="spark-empty">No dated changes are retained for this control.</p>
              {/if}
            </section>
            <div class="control-exports" aria-label="Export control">
              <span>Export control</span>
              <button type="button" onclick={() => downloadControl("json")}>JSON</button>
              <button type="button" onclick={() => downloadControl("csv")}>CSV</button>
              <button type="button" onclick={() => downloadControl("md")}>Markdown</button>
            </div>
          {:else if activeTab === "changelog"}
            <HistoryPanel history={controlHistory} status={historyStatus} frameworkLabel={frameworkLabel(framework)} />
          {:else}
            <ContextPanel {graph} status={graphStatus} onSelect={(id) => void selectControl(id)} />
          {/if}
        </div>
      </article>
    {:else}
      <div class="detail-state" role="status">
        <div class="empty-icon">▤</div>
        <h1>Select a control</h1>
        <p>Choose a control from the sidebar to explore its current detail.</p>
      </div>
    {/if}
  </section>
</div>

<style>
  :global(main#main-content) {
    min-height: 0;
  }

  .explorer {
    display: grid;
    grid-template-columns: var(--sidebar-width, 310px) 5px minmax(0, 1fr);
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
    background: var(--bg-subtle);
  }

  .resize-handle {
    z-index: 5;
    min-width: 0;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--border);
    background: transparent;
    cursor: col-resize;
    transition: border-color 0.12s;
  }

  .resize-handle:hover,
  .resize-handle.active {
    border-left-color: var(--accent);
  }

  .sidebar-header {
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
  }

  .filter-group-label,
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

  .control-filter-pill[data-filter="favourites"].active {
    border-color: var(--amber);
    background: var(--amber);
    color: var(--text-inv);
  }

  .control-filter-pill[data-filter="withdrawn"].active {
    border-color: var(--red);
    background: var(--red);
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
    color: var(--text-inv);
  }

  .applicability-pill[data-applicability="P"].active { background: #1d4ed8; color: white; }
  .applicability-pill[data-applicability="C"].active { background: #15803d; color: white; }
  .applicability-pill[data-applicability="S"].active { background: #db2777; color: white; }
  .applicability-pill[data-applicability="TS"].active { background: #dc2626; color: white; }

  .applicability-pill[data-applicability="NC"].active {
    border-color: #9ca3af;
    background: #e5e7eb;
    color: #111827;
  }

  .applicability-pill[data-applicability="OS"].active {
    border-color: #6b7280;
    background: #6b7280;
    color: white;
  }

  .sidebar-section-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 14px 5px;
  }

  .sidebar-section-label {
    margin: 0;
  }

  .sidebar-section-label span {
    font-weight: 400;
    letter-spacing: 0;
  }

  .hierarchy-toggle {
    padding: 2px 0;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 10px;
  }

  .hierarchy-toggle:hover {
    color: var(--accent);
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

  .withdrawn-badge {
    display: inline-flex;
    width: fit-content;
    margin: 2px 0;
    padding: 1px 5px;
    border: 1px solid var(--red-border);
    border-radius: 4px;
    background: var(--red-bg);
    color: var(--red);
    font-size: 9px;
    font-weight: 650;
    line-height: 1.3;
    text-decoration: none;
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

  .breadcrumb button {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }

  .breadcrumb button:hover,
  .breadcrumb button:focus-visible {
    color: var(--accent);
    text-decoration: underline;
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

  .change-frequency {
    margin-top: 16px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-subtle);
  }

  .change-frequency h2 {
    margin: 0 0 10px;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sparkline {
    display: flex;
    height: 36px;
    align-items: flex-end;
    gap: 3px;
  }

  .spark-column {
    min-height: 3px;
    flex: 1;
    border-radius: 2px;
    background: var(--border-strong);
    opacity: 0.55;
  }

  .spark-column.has-change {
    background: var(--accent);
    opacity: 0.55;
  }

  .spark-column.major-change {
    background: var(--amber);
    opacity: 0.72;
  }

  .spark-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 9px;
  }

  .spark-empty {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
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

  .mobile-detail-nav {
    display: none;
  }

  @media (max-width: 720px) {
    .explorer {
      display: block;
      height: calc(100vh - 150px);
      height: calc(100dvh - 150px);
      min-height: 0;
    }

    .sidebar,
    .detail-panel {
      width: 100%;
      height: 100%;
    }

    .detail-panel,
    .show-mobile-detail .sidebar {
      display: none;
    }

    .show-mobile-detail .detail-panel {
      display: block;
    }

    .resize-handle {
      display: none;
    }

    .sidebar-header {
      padding: 12px 12px 10px;
    }

    .filter-row {
      gap: 6px;
    }

    .filter-pill,
    .favourite-actions button,
    .hierarchy-toggle {
      min-height: 36px;
    }

    .filter-pill {
      padding: 7px 11px;
      font-size: 12px;
    }

    .favourite-actions {
      gap: 8px;
    }

    .favourite-actions button {
      padding: 7px 10px;
      font-size: 11px;
    }

    .sidebar-section-row {
      min-height: 48px;
      padding: 7px 12px;
    }

    .hierarchy-toggle {
      padding-inline: 8px;
      font-size: 11px;
    }

    .control-list {
      padding: 4px 8px 16px;
      overscroll-behavior-y: contain;
    }

    .mobile-detail-nav {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      min-height: 48px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }

    .mobile-detail-nav button {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 36px;
      padding: 7px 10px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--bg-subtle);
      color: var(--text-mid);
      font-size: 12px;
      font-weight: 600;
    }

    .control-header {
      position: relative;
      padding: 18px 16px 12px;
    }

    .control-heading {
      flex-direction: column;
      gap: 14px;
    }

    .control-heading h1 {
      font-size: 19px;
    }

    .detail-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .detail-favourite,
    .report-issue {
      min-height: 36px;
    }

    .detail-favourite {
      min-width: 36px;
    }

    .tabs {
      padding: 10px 12px 0;
      overflow-x: auto;
    }

    .tabs button {
      min-height: 44px;
      padding-inline: 13px;
    }

    .tab-panel {
      padding: 18px 16px 0;
    }

    .stats-grid,
    .stats-grid.three-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .control-exports {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .control-exports > span {
      flex-basis: 100%;
    }

    .control-exports button {
      min-height: 36px;
      padding: 7px 10px;
    }

    .detail-state {
      min-height: calc(100% - 48px);
      padding: 32px 18px;
    }
  }
</style>
