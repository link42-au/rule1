<script lang="ts">
  import { base } from "$app/paths";
  import type { Framework, GlossaryTerm, TermDetail } from "@rule1/shared";
  import { onMount } from "svelte";
  import { filterGlossary, frameworkFromUrl } from "$lib/catalogue-pages";
  import type { FrameworkId, Rule1DataClient } from "$lib/db/contracts";
  import { openRule1DataClient } from "$lib/db/rpc";
  import { LatestRequest } from "$lib/explorer/state";

  let client: Rule1DataClient | null = null;
  let frameworks = $state<Framework[]>([]);
  let framework = $state<FrameworkId>("ism");
  let terms = $state<GlossaryTerm[]>([]);
  let query = $state("");
  let selectedId = $state<string | null>(null);
  let detail = $state<TermDetail | null>(null);
  let status = $state<"loading" | "ready" | "empty" | "error">("loading");
  let detailStatus = $state<"idle" | "loading" | "ready" | "empty" | "error">("idle");

  const termRequests = new LatestRequest();
  const detailRequests = new LatestRequest();
  let filtered = $derived(filterGlossary(terms, query));
  let frameworkName = $derived(frameworks.find((item) => item.id === framework)?.short_name ?? framework);

  function syncUrl(): void {
    const url = new URL(window.location.href);
    if (framework === "ism") url.searchParams.delete("framework");
    else url.searchParams.set("framework", framework);
    if (query.trim()) url.searchParams.set("search", query.trim());
    else url.searchParams.delete("search");
    if (selectedId) url.searchParams.set("term", selectedId);
    else url.searchParams.delete("term");
    history.replaceState(null, "", url);
  }

  function clearDetail(): void {
    detailRequests.cancel();
    selectedId = null;
    detail = null;
    detailStatus = "idle";
  }

  async function selectTerm(id: string, updateUrl = true): Promise<void> {
    if (!client) return;
    if (!terms.some((term) => term.id === id)) {
      clearDetail();
      detailStatus = "empty";
      syncUrl();
      return;
    }
    selectedId = id;
    detail = null;
    detailStatus = "loading";
    if (updateUrl) syncUrl();
    const request = detailRequests.begin();
    const requestFramework = framework;
    try {
      const result = await client.term({ framework: requestFramework, id });
      if (!detailRequests.isCurrent(request) || selectedId !== id || framework !== requestFramework) return;
      detail = result;
      detailStatus = result ? "ready" : "empty";
    } catch {
      if (detailRequests.isCurrent(request) && selectedId === id && framework === requestFramework) {
        detailStatus = "error";
      }
    }
  }

  async function loadTerms(nextFramework: FrameworkId, requestedTerm: string | null = null): Promise<void> {
    if (!client) return;
    const request = termRequests.begin();
    detailRequests.cancel();
    framework = nextFramework;
    terms = [];
    clearDetail();
    status = "loading";
    syncUrl();
    try {
      const result = await client.terms({ framework: nextFramework });
      if (!termRequests.isCurrent(request) || framework !== nextFramework) return;
      terms = result.terms;
      status = result.terms.length > 0 ? "ready" : "empty";
      if (requestedTerm) await selectTerm(requestedTerm, false);
    } catch {
      if (termRequests.isCurrent(request)) status = "error";
    }
  }

  function updateSearch(value: string): void {
    query = value;
    clearDetail();
    syncUrl();
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
        query = url.searchParams.get("search") ?? "";
        await loadTerms(
          frameworkFromUrl(url, frameworks.map((item) => item.id)),
          url.searchParams.get("term"),
        );
      } catch {
        if (mounted) status = "error";
      }
    })();
    return () => {
      mounted = false;
      termRequests.cancel();
      detailRequests.cancel();
      if (closeClient) void closeClient();
    };
  });
</script>

<svelte:head><title>Glossary — rule1</title></svelte:head>

<div class="cl-main glossary-page">
  <h1 class="cl-title">Glossary</h1>
  <p class="cl-sub">Definitions retained with each security framework source.</p>
  <div class="frameworks">{#each frameworks as item}<button class:active={framework === item.id} onclick={() => void loadTerms(item.id as FrameworkId)}>{item.short_name}</button>{/each}</div>
  <label class="search-row">Search terms<input type="search" value={query} oninput={(event) => updateSearch(event.currentTarget.value)} placeholder="Search terms and definitions…" /><span>{filtered.length} terms</span></label>

  {#if status === "loading"}<p class="state">Loading retained glossary…</p>
  {:else if status === "error"}<p class="state error">Could not load glossary data from the local catalogue.</p>
  {:else if status === "empty"}<p class="state">No glossary terms are retained for {frameworkName} in the archived sources.</p>
  {:else if filtered.length === 0}<p class="state">No terms match the current search.</p>
  {:else}
    <div class="glossary-layout">
      <div class="term-list">{#each filtered as term}<button class:active={selectedId === term.id} onclick={() => void selectTerm(term.id)}><strong>{term.term}</strong><span>{term.meaning}</span></button>{/each}</div>
      <aside class="term-detail">
        {#if detailStatus === "loading"}<p class="state">Loading term history…</p>
        {:else if detailStatus === "error"}<p class="state error">Could not load this term.</p>
        {:else if detailStatus === "empty"}<p class="state">The selected term is not retained for {frameworkName}.</p>
        {:else if detail}
          <h2>{detail.term}</h2>
          {#each detail.history as revision}<article><strong>{revision.catalog_version}</strong><span>{revision.change_type}</span><p>{revision.meaning}</p></article>{/each}
        {:else}<p class="state">Select a glossary term to view its retained history.</p>{/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .glossary-page { display: block; width: min(1100px, calc(100% - 48px)); margin: 0 auto; }
  .frameworks { display: flex; flex-wrap: wrap; gap: 5px; margin: 16px 0; }
  button, input { border: 1px solid var(--border); border-radius: 7px; background: var(--bg-card); color: var(--text-mid); font: inherit; }
  button { padding: 5px 10px; cursor: pointer; }
  button.active { border-color: var(--accent); background: var(--accent); color: white; }
  .search-row { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .search-row input { width: min(430px, 45vw); padding: 9px 12px; text-transform: none; }
  .search-row span { font-family: var(--font-mono); font-weight: 400; text-transform: none; }
  .state { padding: 20px 0; color: var(--text-dim); font-size: 13px; }
  .state.error { color: var(--red); }
  .glossary-layout { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr); gap: 18px; margin-top: 20px; }
  .term-list { display: grid; gap: 7px; }
  .term-list button { display: block; padding: 12px 15px; text-align: left; }
  .term-list strong, .term-list span { display: block; }
  .term-list strong { color: var(--text); font-size: 14px; }
  .term-list span { margin-top: 4px; color: var(--text-mid); font-size: 12px; line-height: 1.5; }
  .term-detail { position: sticky; top: 20px; align-self: start; padding: 18px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-subtle); }
  .term-detail h2 { margin: 0 0 14px; color: var(--text); font-size: 18px; }
  .term-detail article { padding: 11px 0; border-top: 1px solid var(--border); }
  .term-detail article > span { margin-left: 8px; color: var(--text-dim); font-size: 10px; text-transform: uppercase; }
  .term-detail article p { color: var(--text-mid); font-size: 12px; line-height: 1.55; }
</style>
