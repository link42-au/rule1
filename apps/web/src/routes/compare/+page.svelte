<script lang="ts">
  import { base } from "$app/paths";
  import type { ChangeRow, Framework, VersionRow } from "@rule1/shared";
  import { onMount } from "svelte";
  import { comparisonCsv, filterChanges, frameworkFromUrl, versionPairFromUrl } from "$lib/catalogue-pages";
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
  let status = $state<"loading" | "ready" | "empty" | "error">("loading");
  let message = $state("Loading local catalogue…");

  const versionRequests = new LatestRequest();
  const compareRequests = new LatestRequest();
  let fromOptions = $derived(versions.filter((version) => versions.indexOf(version) < versions.findIndex((item) => item.version === to)));
  let toOptions = $derived(versions.filter((version) => versions.indexOf(version) > versions.findIndex((item) => item.version === from)));
  let filtered = $derived(filterChanges(changes, query, changeType));

  function syncUrl(): void {
    const url = new URL(window.location.href);
    if (framework === "ism") url.searchParams.delete("framework");
    else url.searchParams.set("framework", framework);
    if (from) url.searchParams.set("from", from);
    else url.searchParams.delete("from");
    if (to) url.searchParams.set("to", to);
    else url.searchParams.delete("to");
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
      if (
        !compareRequests.isCurrent(request) ||
        framework !== selection.framework ||
        from !== selection.from ||
        to !== selection.to
      )
        return;
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

  function downloadCsv(): void {
    const blob = new Blob([comparisonCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement("a"), {
      href: objectUrl,
      download: `${framework}-compare-${from}-${to}.csv`,
    });
    anchor.click();
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
        if (mounted) {
          status = "error";
          message = "Could not open the local Rule1 catalogue.";
        }
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

<svelte:head><title>Compare versions — rule1</title></svelte:head>

<div class="cl-main cl-main--wide compare-page">
  <h1 class="cl-title">Compare versions</h1>
  <p class="cl-sub">Select two retained catalogue versions to see what changed.</p>

  <div class="frameworks" aria-label="Security framework">
    {#each frameworks as item}
      <button class:active={framework === item.id} onclick={() => void loadVersions(item.id as FrameworkId)}>{item.short_name}</button>
    {/each}
  </div>

  {#if versions.length >= 2}
    <div class="selectors">
      <label>From<select bind:value={from} onchange={changeFrom}>{#each fromOptions as version}<option value={version.version}>{version.version}</option>{/each}</select></label>
      <span>→</span>
      <label>To<select bind:value={to} onchange={changeTo}>{#each toOptions as version}<option value={version.version}>{version.version}</option>{/each}</select></label>
    </div>
  {/if}

  {#if status === "loading" || status === "empty" || status === "error"}
    <p class:error={status === "error"} class="status" aria-live="polite">{message}</p>
  {/if}

  {#if status === "ready"}
    <div class="toolbar">
      <input aria-label="Filter changes" placeholder="Filter by ID, context, or description…" bind:value={query} />
      <div class="types">{#each ["all", "new", "modified", "withdrawn"] as type}<button class:active={changeType === type} onclick={() => (changeType = type)}>{type}</button>{/each}</div>
      <span>{filtered.length} of {changes.length} changes</span>
      <button class="export" onclick={downloadCsv}>↓ Download CSV</button>
    </div>
    {#if filtered.length === 0}
      <p class="status">No comparison rows match the current filters.</p>
    {:else}
      <div class="table-wrap">
        <table><thead><tr><th>ID</th><th>Change</th><th>Context</th><th>Description</th></tr></thead>
          <tbody>{#each filtered as row}
            <tr>
              <td><a href={`${base}/explorer/?framework=${framework}&id=${encodeURIComponent(row.id)}`}>{row.display_id}</a></td>
              <td><span class="change {row.change_type}">{row.change_type}</span></td>
              <td>{row.guideline ?? row.section ?? "—"}</td>
              <td class:withdrawn={row.change_type === "withdrawn"}>{row.new_statement ?? row.old_statement ?? "No description retained."}</td>
            </tr>
          {/each}</tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .compare-page { display: block; max-width: 1500px; margin: 0 auto; }
  .frameworks, .types { display: flex; flex-wrap: wrap; gap: 5px; }
  button, select, input { border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-mid); font: inherit; }
  button { padding: 5px 10px; cursor: pointer; text-transform: capitalize; }
  button.active { border-color: var(--accent); background: var(--accent); color: white; }
  .selectors { display: flex; align-items: end; gap: 16px; margin: 22px 0; }
  label { display: grid; gap: 5px; color: var(--text-dim); font-size: 11px; font-weight: 600; text-transform: uppercase; }
  select { min-width: 190px; padding: 8px 10px; }
  .status { padding: 18px 0; color: var(--text-dim); font-size: 13px; }
  .status.error { color: var(--red); }
  .toolbar { display: flex; align-items: center; gap: 10px; margin: 20px 0 10px; }
  .toolbar input { width: min(360px, 35vw); padding: 8px 10px; }
  .toolbar > span { margin-left: auto; color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
  .export { color: var(--accent); }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 9px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  th { background: var(--bg-subtle); color: var(--text-dim); font-size: 10px; text-transform: uppercase; }
  td:first-child { font-family: var(--font-mono); white-space: nowrap; }
  td:last-child { min-width: 440px; color: var(--text-mid); line-height: 1.5; white-space: pre-line; }
  td.withdrawn { text-decoration: line-through; opacity: 0.72; }
  .change { padding: 2px 6px; border-radius: 4px; background: var(--bg-subtle); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .change.new { color: var(--green); background: var(--green-bg); }
  .change.modified { color: var(--amber); background: var(--amber-bg); }
  .change.withdrawn { color: var(--red); background: var(--red-bg); }
</style>
