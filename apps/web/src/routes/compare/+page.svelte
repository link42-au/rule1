<script lang="ts">
  import { base } from "$app/paths";
  import type { ChangeRow, Framework, VersionRow } from "@rule1/shared";
  import { onMount } from "svelte";
  import { APPLICABILITY_CODES, comparisonCsv, comparisonRows, hasRetainedComplexity, type ComparisonSortColumn, type SortDirection } from "$lib/compare-model";
  import { frameworkFromUrl, versionPairFromUrl } from "$lib/catalogue-pages";
  import type { FrameworkId, Rule1DataClient } from "$lib/db/contracts";
  import { openRule1DataClient } from "$lib/db/rpc";
  import { LatestRequest } from "$lib/explorer/state";

  let client: Rule1DataClient | null = null;
  let frameworks = $state<Framework[]>([]);
  let framework = $state<FrameworkId>("ism");
  let versions = $state<VersionRow[]>([]);
  let from = $state("");
  let to = $state("");
  let changes = $state<ChangeRow[]>([]);
  let query = $state("");
  let changeType = $state("all");
  let applicability = $state("");
  let sortColumn = $state<ComparisonSortColumn>("display_id");
  let sortDirection = $state<SortDirection>("asc");
  let status = $state<"loading" | "ready" | "empty" | "error">("loading");
  let message = $state("Loading local catalogue…");

  const versionRequests = new LatestRequest();
  const compareRequests = new LatestRequest();
  let fromOptions = $derived(versions.filter((version) => versions.indexOf(version) < versions.findIndex((item) => item.version === to)));
  let toOptions = $derived(versions.filter((version) => versions.indexOf(version) > versions.findIndex((item) => item.version === from)));
  let filtered = $derived(comparisonRows(changes, framework, query, changeType, applicability, sortColumn, sortDirection));
  let showComplexity = $derived(hasRetainedComplexity(changes));
  let isISM = $derived(framework === "ism");

  function syncUrl(): void {
    const url = new URL(window.location.href);
    if (framework === "ism") url.searchParams.delete("framework");
    else url.searchParams.set("framework", framework);
    if (from) url.searchParams.set("from", from); else url.searchParams.delete("from");
    if (to) url.searchParams.set("to", to); else url.searchParams.delete("to");
    history.replaceState(null, "", url);
  }

  async function compare(): Promise<void> {
    if (!client || !from || !to) return;
    const request = compareRequests.begin();
    const selection = { framework, from, to };
    status = "loading";
    message = "Comparing retained versions…";
    changes = [];
    syncUrl();
    try {
      const result = await client.compare(selection);
      if (!compareRequests.isCurrent(request) || framework !== selection.framework || from !== selection.from || to !== selection.to) return;
      changes = result.changes;
      status = result.changes.length > 0 ? "ready" : "empty";
      message = result.changes.length > 0 ? "" : "No changes are retained between these versions.";
    } catch {
      if (compareRequests.isCurrent(request)) {
        status = "error";
        message = "Could not compare these local catalogue versions.";
      }
    }
  }

  async function loadVersions(nextFramework: FrameworkId, requestedUrl?: URL): Promise<void> {
    if (!client) return;
    const request = versionRequests.begin();
    compareRequests.cancel();
    framework = nextFramework;
    versions = [];
    changes = [];
    from = "";
    to = "";
    applicability = "";
    status = "loading";
    message = "Loading retained versions…";
    syncUrl();
    try {
      const result = await client.versions({ framework: nextFramework });
      if (!versionRequests.isCurrent(request) || framework !== nextFramework) return;
      versions = result;
      const pair = versionPairFromUrl(requestedUrl ?? new URL(window.location.href), result);
      if (!pair) {
        status = "empty";
        message = `${frameworks.find((item) => item.id === nextFramework)?.short_name ?? nextFramework} needs at least two retained versions for comparison.`;
        syncUrl();
        return;
      }
      from = pair.from;
      to = pair.to;
      await compare();
    } catch {
      if (versionRequests.isCurrent(request)) {
        status = "error";
        message = "Could not load retained catalogue versions.";
      }
    }
  }

  function changeFrom(): void {
    if (!toOptions.some((version) => version.version === to)) to = toOptions.at(-1)?.version ?? "";
    void compare();
  }

  function changeTo(): void {
    if (!fromOptions.some((version) => version.version === from)) from = fromOptions.at(-1)?.version ?? "";
    void compare();
  }

  function toggleSort(column: ComparisonSortColumn): void {
    if (sortColumn === column) sortDirection = sortDirection === "asc" ? "desc" : "asc";
    else { sortColumn = column; sortDirection = "asc"; }
  }

  function sortArrow(column: ComparisonSortColumn): string {
    if (sortColumn !== column) return "⇕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function downloadCsv(): void {
    const blob = new Blob([comparisonCsv(filtered, framework)], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: objectUrl, download: `${framework}-compare-${from}-${to}.csv` }).click();
    URL.revokeObjectURL(objectUrl);
  }

  onMount(() => {
    let mounted = true;
    let closeClient: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        const opened = await openRule1DataClient(base, window.location.href);
        if (!mounted) return void opened.close();
        client = opened.client;
        closeClient = opened.close;
        frameworks = await client.frameworks();
        if (!mounted) return;
        const url = new URL(window.location.href);
        await loadVersions(frameworkFromUrl(url, frameworks.map((item) => item.id)), url);
      } catch {
        if (mounted) { status = "error"; message = "Could not open the local Rule1 catalogue."; }
      }
    })();
    return () => {
      mounted = false;
      versionRequests.cancel();
      compareRequests.cancel();
      if (closeClient) void closeClient();
    };
  });
</script>

<svelte:head>
  <title>Compare versions — rule1</title>
  <meta name="description" content="Compare retained security framework versions locally in your browser and review controls that were added, modified, or withdrawn." />
  <meta property="og:title" content="Compare versions — rule1" />
  <meta property="og:description" content="Compare retained security framework versions locally in your browser and review controls that were added, modified, or withdrawn." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://wan0.net/rule1/compare/" />
  <meta property="og:site_name" content="rule1" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Compare versions — rule1" />
  <meta name="twitter:description" content="Compare retained security framework versions locally in your browser and review controls that were added, modified, or withdrawn." />
  <link rel="canonical" href="https://wan0.net/rule1/compare/" />
</svelte:head>

<div class="cl-main cl-main--wide compare-page">
  <h1 class="cl-title">Compare versions</h1>
  <p class="cl-sub">Select two retained catalogue versions to see what changed between them.</p>

  {#if frameworks.length > 1}
    <div class="cmp-frameworks" role="group" aria-label="Security framework">
      {#each frameworks as item}
        <button class="fw-pill" class:active={framework === item.id} aria-pressed={framework === item.id} onclick={() => void loadVersions(item.id as FrameworkId)}>{item.short_name}<span class="fw-country">{item.country}</span></button>
      {/each}
    </div>
  {/if}

  {#if versions.length >= 2}
    <div class="cmp-selectors">
      <label>From<select bind:value={from} onchange={changeFrom}>{#each fromOptions as version}<option value={version.version}>{version.version}</option>{/each}</select></label>
      <span class="cmp-arrow">→</span>
      <label>To<select bind:value={to} onchange={changeTo}>{#each toOptions as version}<option value={version.version}>{version.version}</option>{/each}</select></label>
    </div>
  {/if}

  {#if status === "loading" || status === "empty" || status === "error"}<p class:error={status === "error"} class="status" aria-live="polite">{message}</p>{/if}

  {#if status === "ready"}
    <div class="cmp-toolbar">
      <div class="cmp-toolbar-left">
        <input aria-label="Filter changes" placeholder="Filter by ID or context…" bind:value={query} />
        <div class="cmp-pills" role="group" aria-label="Change type">{#each ["all", "new", "modified", "withdrawn"] as type}<button class:active={changeType === type} aria-pressed={changeType === type} onclick={() => (changeType = type)}>{type}</button>{/each}</div>
        {#if isISM}<div class="cmp-pills applicability-filter" role="group" aria-label="ISM applicability">{#each APPLICABILITY_CODES as code}<button class:active={applicability === code} aria-pressed={applicability === code} onclick={() => (applicability = applicability === code ? "" : code)}>{code}</button>{/each}</div>{/if}
      </div>
      <div class="cmp-toolbar-right"><span>{filtered.length} of {changes.length} changes</span><button class="export" onclick={downloadCsv}>↓ Download CSV</button></div>
    </div>

    {#if filtered.length === 0}
      <p class="status">No comparison rows match the current filters.</p>
    {:else}
      <div class="cmp-results" role="region" aria-label="Comparison results">
        <table class="cmp-table">
          <colgroup><col class="col-id" /><col class="col-change" />{#if showComplexity}<col class="col-complexity" />{/if}<col class="col-context" />{#if isISM}<col class="col-applicability" /><col class="col-e8" /><col class="col-e8" />{/if}<col class="col-description" /></colgroup>
          <thead><tr>
            <th aria-sort={sortColumn === "display_id" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}><button class:active={sortColumn === "display_id"} onclick={() => toggleSort("display_id")}>ID <span aria-hidden="true">{sortArrow("display_id")}</span></button></th>
            <th aria-sort={sortColumn === "change_type" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}><button class:active={sortColumn === "change_type"} onclick={() => toggleSort("change_type")}>Change <span aria-hidden="true">{sortArrow("change_type")}</span></button></th>
            {#if showComplexity}<th>Complexity <span class="column-help" title="Values are shown exactly as retained in the comparison data." aria-label="Complexity values are shown exactly as retained in the comparison data.">?</span></th>{/if}
            <th aria-sort={sortColumn === "context" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}><button class:active={sortColumn === "context"} onclick={() => toggleSort("context")}>Context <span aria-hidden="true">{sortArrow("context")}</span></button></th>
            {#if isISM}<th>Applicability</th><th>Old E8</th><th>New E8</th>{/if}<th>Description</th>
          </tr></thead>
          <tbody>{#each filtered as item (item.row.id)}<tr>
            <td class="id-cell"><a href={`${base}/explorer/?framework=${framework}&id=${encodeURIComponent(item.row.id)}`}>{item.row.display_id}</a>{#if item.row.label && item.row.label !== item.row.display_id}<div class="control-label">{item.row.label}</div>{/if}</td>
            <td><span class="change-badge {item.row.change_type}">{item.row.change_type}</span></td>
            {#if showComplexity}<td>{#if item.complexity}<span class="complexity cplx-{item.complexity.value}">{item.complexity.label}</span>{:else}<span class="none">—</span>{/if}</td>{/if}
            <td class="context-cell">{#if item.contextTag}<span class="meta-tag">{item.contextTag}</span>{/if}{item.context || "—"}</td>
            {#if isISM}<td class="applicability-cell">
              {#if item.row.change_type === "withdrawn"}
                <div class="applic-old">{#each item.oldApplicability as code}<span class="chip chip-{code.toLowerCase()}">{code}</span>{:else}<span class="none">—</span>{/each}</div>
              {:else if item.row.change_type === "modified" && item.applicabilityChanged}
                <div class="applic-old">{#each item.oldApplicability as code}<span class="chip chip-{code.toLowerCase()}">{code}</span>{:else}<span class="none">—</span>{/each}</div>
                <div>{#each item.newApplicability as code}<span class="chip chip-{code.toLowerCase()}">{code}</span>{:else}<span class="none">—</span>{/each}</div>
              {:else}<div>{#each item.newApplicability as code}<span class="chip chip-{code.toLowerCase()}">{code}</span>{:else}<span class="none">—</span>{/each}</div>{/if}
            </td><td class="e8-cell e8-old">{#each item.oldE8Levels as level}<span class="chip e8-chip">{level}</span>{:else}<span class="none">—</span>{/each}</td>
            <td class="e8-cell">{#each item.newE8Levels as level}<span class="chip e8-chip">{level}</span>{:else}<span class="none">—</span>{/each}</td>{/if}
            <td class="description-cell" class:withdrawn={item.row.change_type === "withdrawn"}>{#each item.statement as part}{#if part.kind === "deleted"}<del>{part.text}</del>{:else if part.kind === "inserted"}<ins>{part.text}</ins>{:else}{part.text}{/if}{/each}</td>
          </tr>{/each}</tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .compare-page { display: block; width: min(1500px, 100%); min-width: 0; margin: 0 auto; }
  .cmp-frameworks, .cmp-pills { display: flex; flex-wrap: wrap; gap: 5px; }
  button, select, input { border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-mid); font: inherit; }
  button { cursor: pointer; }
  .fw-pill { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; }
  .fw-pill.active, .cmp-pills button.active { border-color: var(--accent-solid); background: var(--accent-solid); color: var(--accent-solid-text); }
  .fw-country { color: var(--text-dim); font-size: 10px; }
  .fw-pill.active .fw-country { color: var(--accent-solid-text); }
  .cmp-selectors { display: flex; align-items: end; gap: 16px; margin: 22px 0; }
  label { display: grid; gap: 5px; color: var(--text-dim); font-size: 11px; font-weight: 600; text-transform: uppercase; }
  select { min-width: 190px; padding: 8px 10px; }
  .cmp-arrow { padding-bottom: 8px; color: var(--text-dim); }
  .status { padding: 18px 0; color: var(--text-dim); font-size: 13px; }
  .status.error { color: var(--red); }
  .cmp-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 20px 0 14px; flex-wrap: wrap; }
  .cmp-toolbar-left, .cmp-toolbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cmp-toolbar input { width: min(300px, 36vw); padding: 7px 10px; }
  .cmp-pills button, .export { padding: 4px 10px; text-transform: capitalize; }
  .applicability-filter button { font-weight: 700; }
  .cmp-toolbar-right > span { color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
  .export { color: var(--accent); white-space: nowrap; }
  .cmp-results { width: 100%; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain; border: 1px solid var(--border); border-radius: 9px; }
  .cmp-table { width: 100%; min-width: 1300px; table-layout: fixed; border-collapse: collapse; font-size: 12px; }
  .col-id { width: 110px; } .col-change { width: 105px; } .col-complexity { width: 105px; } .col-context { width: 190px; } .col-applicability { width: 170px; } .col-e8 { width: 90px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  th { background: var(--bg-subtle); color: var(--text-dim); font-size: 10px; text-transform: uppercase; }
  th button { padding: 0; border: 0; background: transparent; color: inherit; font-size: inherit; font-weight: 700; text-transform: uppercase; }
  th button:hover, th button.active { color: var(--accent); }
  th button span { margin-left: 3px; }
  .column-help { display: inline-grid; place-items: center; width: 15px; height: 15px; margin-left: 3px; border: 1px solid var(--border); border-radius: 50%; color: var(--text-dim); font-size: 9px; line-height: 1; cursor: help; text-transform: none; }
  tbody tr:hover { background: var(--bg-hover, var(--bg-card)); }
  tbody tr:last-child td { border-bottom: 0; }
  .id-cell { font-family: var(--font-mono); white-space: nowrap; }
  .id-cell a { color: var(--accent); font-weight: 700; text-decoration: none; }
  .id-cell a:hover { text-decoration: underline; }
  .control-label { margin-top: 3px; color: var(--text-dim); font-family: var(--font-sans); font-size: 11px; white-space: normal; }
  .change-badge, .complexity { display: inline-block; padding: 2px 7px; border: 1px solid var(--border); border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; white-space: nowrap; }
  .change-badge.new, .cplx-low { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .change-badge.modified, .cplx-medium { border-color: var(--amber-border); background: var(--amber-bg); color: var(--amber); }
  .change-badge.withdrawn, .cplx-high { border-color: var(--red-border); background: var(--red-bg); color: var(--red); }
  .cplx-unknown, .cplx-very_low { color: var(--text-dim); }
  .context-cell { color: var(--text-dim); line-height: 1.5; }
  .meta-tag { display: inline-block; margin-right: 4px; padding: 1px 6px; border-radius: 4px; background: var(--accent-bg); color: var(--accent); font-weight: 650; }
  .applic-old { margin-bottom: 4px; opacity: 0.45; }
  .chip { display: inline-flex; margin: 1px 2px 1px 0; padding: 2px 5px; border: 1px solid; border-radius: 4px; font-size: 10px; font-weight: 700; }
  .chip-nc { border-color: #c8c8c8; background: #fff; color: #1a1a1a; } .chip-os { border-color: #4b5563; background: #6b7280; color: #fff; }
  .chip-p { border-color: #1e40af; background: #1d4ed8; color: #fff; } .chip-c { border-color: #15803d; background: #16a34a; color: #fff; }
  .chip-s { border-color: #be185d; background: #db2777; color: #fff; } .chip-ts { border-color: #b91c1c; background: #dc2626; color: #fff; }
  .e8-chip { border-color: var(--accent-border); background: var(--accent-bg); color: var(--accent); }
  .e8-old { opacity: 0.65; }
  .none { color: var(--text-dim); }
  .description-cell { color: var(--text-mid); line-height: 1.6; white-space: pre-line; }
  .description-cell del { padding: 0 2px; border-radius: 2px; background: var(--red-bg); color: var(--red); }
  .description-cell ins { padding: 0 2px; border-radius: 2px; background: var(--green-bg); color: var(--green); font-weight: 600; text-decoration: none; }
  .description-cell.withdrawn { color: var(--text-dim); }
  @media (max-width: 720px) {
    .compare-page { padding: 32px 16px 48px; }
    .cmp-frameworks { width: 100%; }
    .cmp-selectors { align-items: stretch; flex-direction: column; }
    .cmp-arrow { display: none; }
    select, .cmp-toolbar input { width: 100%; min-width: 0; }
    .cmp-toolbar-left, .cmp-toolbar-right { width: 100%; }
    .cmp-toolbar-right { justify-content: space-between; }
    .cmp-results { max-width: 100%; }
  }
</style>
