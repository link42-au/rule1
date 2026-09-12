<script lang="ts">
  import { base } from "$app/paths";
  import { onMount } from "svelte";
  import {
    attackCatalogueOptions,
    attackTechniqueHasReviewedControls,
    filterAttackTechniques,
    primaryAttackTactic,
    readAttackCatalogueUrl,
    writeAttackCatalogueUrl,
    type AttackCoverageFilter,
  } from "$lib/attack-catalogue-model";
  import { parseAttackMitigationDescription } from "$lib/attack-mitigation-description";
  import type { AttackCatalogueResult, Rule1DataClient } from "$lib/db/contracts";
  import { openRule1DataClient } from "$lib/db/rpc";
  import { formatAttackLabel, safeMitreUrl } from "$lib/explorer/attack-model";

  type CatalogueStatus = "loading" | "ready" | "error";
  const coverageOptions: { value: AttackCoverageFilter; label: string }[] = [
    { value: "all", label: "All techniques" },
    { value: "mitigated", label: "Has mitigations" },
    { value: "controls", label: "Has reviewed ISM controls" },
  ];

  let client: Rule1DataClient | null = null;
  let result = $state<AttackCatalogueResult>({ attackVersion: null, ismCatalogVersion: null, techniques: [] });
  let status = $state<CatalogueStatus>("loading");
  let search = $state("");
  let selectedTactics = $state<string[]>([]);
  let selectedPlatforms = $state<string[]>([]);
  let showSubtechniques = $state(true);
  let coverage = $state<AttackCoverageFilter>("all");
  let selectedId = $state<string | null>(null);

  let options = $derived(attackCatalogueOptions(result.techniques));
  let tactics = $derived(options.tactics);
  let platforms = $derived(options.platforms);
  let filteredTechniques = $derived(
    filterAttackTechniques(result.techniques, {
      search,
      tactics: selectedTactics,
      platforms: selectedPlatforms,
      showSubtechniques,
      coverage,
      selectedId,
    }),
  );
  let selectedTechnique = $derived(result.techniques.find((technique) => technique.techniqueId === selectedId) ?? null);
  let reviewedControlCount = $derived(
    new Set(selectedTechnique?.mitigations.flatMap((mitigation) => mitigation.controls.map((control) => control.controlId))).size,
  );

  function readUrl(url: URL): void {
    const filters = readAttackCatalogueUrl(url, result.techniques);
    search = filters.search;
    selectedTactics = filters.tactics;
    selectedPlatforms = filters.platforms;
    showSubtechniques = filters.showSubtechniques;
    coverage = filters.coverage;
    selectedId = filters.selectedId;
  }

  function syncUrl(): void {
    history.replaceState(
      null,
      "",
      writeAttackCatalogueUrl(new URL(window.location.href), {
        search,
        tactics: selectedTactics,
        platforms: selectedPlatforms,
        showSubtechniques,
        coverage,
        selectedId,
      }),
    );
  }

  function toggleFilter(value: string, values: string[]): string[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  function wordCount(value: string): number {
    return value.trim().split(/\s+/).filter(Boolean).length;
  }

  function toggleTactic(tactic: string): void {
    selectedTactics = toggleFilter(tactic, selectedTactics);
    syncUrl();
  }

  function togglePlatform(platform: string): void {
    selectedPlatforms = toggleFilter(platform, selectedPlatforms);
    syncUrl();
  }

  function clearFilters(): void {
    search = "";
    selectedTactics = [];
    selectedPlatforms = [];
    showSubtechniques = true;
    coverage = "all";
    syncUrl();
  }

  function selectTechnique(techniqueId: string): void {
    selectedId = techniqueId;
    syncUrl();
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-technique-detail]")?.focus());
  }

  function controlHref(controlId: string): string {
    const params = new URLSearchParams({ framework: "ism", id: controlId, tab: "attack" });
    return `${base}/explorer/?${params}`;
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
        result = await client.attackCatalogue();
        if (!mounted) return;
        readUrl(new URL(window.location.href));
        status = "ready";
      } catch {
        if (mounted) status = "error";
      }
    })();
    return () => {
      mounted = false;
      client = null;
      if (closeClient) void closeClient();
    };
  });
</script>

<svelte:head>
  <title>ATT&amp;CK — rule1</title>
  <meta name="description" content="Browse Enterprise ATT&CK techniques, official mitigations, and reviewed ISM control mappings." />
  <meta property="og:title" content="ATT&CK — rule1" />
  <meta property="og:description" content="Browse Enterprise ATT&CK techniques, official mitigations, and reviewed ISM control mappings." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://rule1.link42.app/attack/" />
  <meta property="og:site_name" content="rule1" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="ATT&CK — rule1" />
  <meta name="twitter:description" content="Browse Enterprise ATT&CK techniques, official mitigations, and reviewed ISM control mappings." />
  <link rel="canonical" href="https://rule1.link42.app/attack/" />
</svelte:head>

<div class="attack-page">
  <header class="page-heading">
    <div>
      <p class="eyebrow">Enterprise matrix</p>
      <h1>ATT&amp;CK</h1>
      <p>Explore every retained technique, then follow official mitigations to reviewed ISM controls.</p>
    </div>
    {#if result.attackVersion}
      <div class="source-version" aria-label="Catalogue source versions">
        <span>ATT&amp;CK {result.attackVersion}</span>
        {#if result.ismCatalogVersion}<span>ISM {result.ismCatalogVersion}</span>{/if}
      </div>
    {/if}
  </header>

  {#if status === "loading"}
    <p class="page-state" role="status">Loading the Enterprise ATT&amp;CK catalogue…</p>
  {:else if status === "error"}
    <p class="page-state error" role="alert">Could not load ATT&amp;CK data from the local catalogue.</p>
  {:else}
    <section class="filter-panel" aria-labelledby="filter-heading">
      <div class="filter-title-row">
        <div><p class="eyebrow">Navigator filters</p><h2 id="filter-heading">Find techniques</h2></div>
        <button type="button" class="clear-button" onclick={clearFilters}>Clear filters</button>
      </div>
      <label class="search-field">
        <span>Search name, ID or description</span>
        <input type="search" bind:value={search} oninput={syncUrl} placeholder="e.g. T1485 or Data Destruction" />
      </label>
      <fieldset>
        <legend>Tactics <span>Match any selected tactic</span></legend>
        <div class="chip-row">
          {#each tactics as tactic}
            <button type="button" class:active={selectedTactics.includes(tactic)} aria-pressed={selectedTactics.includes(tactic)} onclick={() => toggleTactic(tactic)}>{formatAttackLabel(tactic)}</button>
          {/each}
        </div>
      </fieldset>
      <fieldset>
        <legend>Platforms <span>Match any selected platform</span></legend>
        <div class="chip-row platforms">
          {#each platforms as platform}
            <button type="button" class:active={selectedPlatforms.includes(platform)} aria-pressed={selectedPlatforms.includes(platform)} onclick={() => togglePlatform(platform)}>{platform}</button>
          {/each}
        </div>
      </fieldset>
      <div class="filter-footer">
        <fieldset class="coverage-filter">
          <legend>Coverage</legend>
          <div class="segmented">
            {#each coverageOptions as option}
              <button type="button" class:active={coverage === option.value} aria-pressed={coverage === option.value} onclick={() => { coverage = option.value; syncUrl(); }}>{option.label}</button>
            {/each}
          </div>
        </fieldset>
        <label class="subtechnique-toggle"><input type="checkbox" bind:checked={showSubtechniques} onchange={syncUrl} /> Show sub-techniques</label>
      </div>
    </section>

    <div class="results-summary" role="status">
      <strong>{filteredTechniques.length}</strong> of {result.techniques.length} techniques
      {#if selectedTactics.length + selectedPlatforms.length > 0}<span>Filters combine across categories</span>{/if}
    </div>

    <div class="catalogue-layout">
      <section class="technique-browser" aria-label="Enterprise ATT&CK techniques">
        {#if filteredTechniques.length === 0}
          <p class="empty-state">No techniques match these filters.</p>
        {:else}
          {#each filteredTechniques as technique, index}
            {#if index === 0 || primaryAttackTactic(technique) !== primaryAttackTactic(filteredTechniques[index - 1])}
              <h2 class="tactic-heading">{formatAttackLabel(primaryAttackTactic(technique))}</h2>
            {/if}
            <button
              type="button"
              class="technique-row"
              class:selected={selectedId === technique.techniqueId}
              class:subtechnique={Boolean(technique.parentTechniqueId)}
              aria-pressed={selectedId === technique.techniqueId}
              onclick={() => selectTechnique(technique.techniqueId)}
            >
              <span class="technique-id">{technique.techniqueId}</span>
              <span class="technique-name">{technique.name}</span>
              <span class="coverage-badges" aria-label="Relationship coverage">
                {#if technique.parentTechniqueId}<span title={`Sub-technique of ${technique.parentTechniqueId}`}>Sub</span>{/if}
                {#if technique.mitigations.length > 0}<span>{technique.mitigations.length} M</span>{/if}
                {#if attackTechniqueHasReviewedControls(technique)}<span class="reviewed">ISM</span>{/if}
              </span>
            </button>
          {/each}
        {/if}
      </section>

      <aside class="technique-detail" aria-label="Selected technique details">
        {#if selectedTechnique}
          <article data-technique-detail tabindex="-1">
            <p class="detail-id">{selectedTechnique.techniqueId}{#if selectedTechnique.parentTechniqueId} · Sub-technique of {selectedTechnique.parentTechniqueId}{/if}</p>
            <div class="detail-title-row">
              <h2>{selectedTechnique.name}</h2>
              {#if safeMitreUrl(selectedTechnique.url)}<a class="mitre-link" href={safeMitreUrl(selectedTechnique.url) ?? undefined} target="_blank" rel="noopener noreferrer">View at MITRE <span aria-hidden="true">↗</span></a>{/if}
            </div>
            <div class="detail-tags">
              {#each selectedTechnique.tactics as tactic}<span>{formatAttackLabel(tactic)}</span>{/each}
              {#each selectedTechnique.platforms as platform}<span class="platform-tag">{platform}</span>{/each}
            </div>
            {#if selectedTechnique.description}
              <details class="description-disclosure">
                <summary aria-label={`Technique description (${wordCount(selectedTechnique.description)} words)`}>
                  <span>Technique description</span>
                  <span>{wordCount(selectedTechnique.description)} words</span>
                </summary>
                <p class="technique-description">{selectedTechnique.description}</p>
              </details>
            {/if}
            <div class="relationship-heading">
              <div><p class="eyebrow">Official relationships</p><h3>Mitigations</h3></div>
              <span>{selectedTechnique.mitigations.length} mitigations · {reviewedControlCount} reviewed controls</span>
            </div>

            {#if selectedTechnique.mitigations.length === 0}
              <p class="relationship-empty">MITRE records no Enterprise ATT&amp;CK mitigations for this technique.</p>
            {:else}
              <div class="mitigation-list">
                {#each selectedTechnique.mitigations as mitigation}
                  {@const guidanceBlocks = mitigation.description ? parseAttackMitigationDescription(mitigation.description) : []}
                  <section class="mitigation-card">
                    <div class="mitigation-title-row">
                      <h4>{mitigation.name} <span>{mitigation.mitigationId}</span></h4>
                      {#if safeMitreUrl(mitigation.url)}<a href={safeMitreUrl(mitigation.url) ?? undefined} target="_blank" rel="noopener noreferrer" aria-label={`View ${mitigation.name} at MITRE`}>↗</a>{/if}
                    </div>
                    {#if guidanceBlocks.length > 0}
                      <section class="mitigation-guidance" aria-label={`${mitigation.name} mitigation guidance`}>
                        <h5>Mitigation guidance</h5>
                        <div class="guidance-blocks">
                          {#each guidanceBlocks as block}
                            {#if block.type === "heading"}
                              <h6>{block.text}</h6>
                            {:else if block.type === "list"}
                              <ul>
                                {#each block.items as item}<li>{item}</li>{/each}
                              </ul>
                            {:else}
                              <p>{block.text}</p>
                            {/if}
                          {/each}
                        </div>
                      </section>
                    {/if}
                    <section class:muted={!mitigation.relationshipDescription} class="relationship-copy" aria-label={`${mitigation.name} relationship to ${selectedTechnique.name}`}>
                      <h5>Relationship to this technique</h5>
                      {#if mitigation.relationshipDescription}<p>{mitigation.relationshipDescription}</p>
                      {:else}<p>MITRE retains the relationship without a descriptive note.</p>{/if}
                    </section>
                    {#if mitigation.controls.length === 0}
                      <p class="control-empty">No reviewed ISM controls currently enable this mitigation.</p>
                    {:else}
                      <section class="control-list" aria-label={`Reviewed ISM controls enabling ${mitigation.name}`}>
                        <h5 class="control-list-label">Reviewed ISM controls enabling this mitigation</h5>
                        {#each mitigation.controls as control}
                          <a class="control-card" href={controlHref(control.controlId)}>
                            <span class="control-title"><strong>{control.displayId}</strong>{#if control.title} · {control.title}{/if}</span>
                            {#if control.statement}<span class="control-statement">{control.statement}</span>{/if}
                            <span class="control-meta"><span class={`function ${control.securityFunction}`}>{control.securityFunction}</span><span>{control.confidence} confidence</span><span aria-hidden="true">Open in Explorer →</span></span>
                          </a>
                        {/each}
                      </section>
                    {/if}
                  </section>
                {/each}
              </div>
            {/if}
          </article>
        {:else}
          <div class="detail-placeholder"><span aria-hidden="true">⌖</span><h2>Select a technique</h2><p>Choose any technique to inspect its official mitigations and reviewed ISM control mappings.</p></div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .attack-page { width: min(1480px, 100%); min-width: 0; margin: 0 auto; padding: 36px 24px 64px; }
  .page-heading, .filter-title-row, .filter-footer, .detail-title-row, .mitigation-title-row, .relationship-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
  h1, h2, h3, h4, h5, h6, p { margin-top: 0; }
  .page-heading h1 { margin-bottom: 6px; color: var(--text); font-size: clamp(30px, 4vw, 46px); letter-spacing: -0.04em; }
  .page-heading > div > p:last-child { max-width: 690px; margin: 0; color: var(--text-mid); line-height: 1.55; }
  .eyebrow { margin-bottom: 5px; color: var(--accent-text); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .source-version { display: grid; flex: 0 0 auto; gap: 4px; padding-top: 5px; color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; text-align: right; }
  .page-state { padding: 80px 20px; color: var(--text-dim); text-align: center; }
  .page-state.error { color: var(--red); }
  .filter-panel { margin-top: 26px; padding: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-subtle); }
  .filter-title-row h2, .relationship-heading h3 { margin: 0; color: var(--text); font-size: 17px; }
  button, input { border: 1px solid var(--border); border-radius: 7px; background: var(--bg-card); color: var(--text-mid); font: inherit; }
  button { cursor: pointer; }
  button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .clear-button { padding: 6px 10px; font-size: 11px; }
  .search-field { display: grid; gap: 6px; margin-top: 16px; color: var(--text-dim); font-size: 11px; font-weight: 600; }
  .search-field input { width: min(560px, 100%); padding: 10px 12px; color: var(--text); }
  fieldset { min-width: 0; margin: 16px 0 0; padding: 0; border: 0; }
  legend { margin-bottom: 7px; color: var(--text); font-size: 11px; font-weight: 650; }
  legend span { margin-left: 5px; color: var(--text-dim); font-weight: 400; }
  .chip-row { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip-row button, .segmented button { padding: 5px 9px; font-size: 11px; }
  .chip-row button.active, .segmented button.active { border-color: var(--accent); background: var(--bg-card); box-shadow: inset 0 0 0 1px var(--accent); color: var(--text); font-weight: 700; }
  .platforms { max-height: 72px; overflow-y: auto; padding: 2px; }
  .filter-footer { align-items: flex-end; margin-top: 4px; }
  .coverage-filter { margin-top: 12px; }
  .segmented { display: flex; flex-wrap: wrap; gap: 5px; }
  .subtechnique-toggle { display: flex; align-items: center; gap: 7px; padding-bottom: 5px; color: var(--text-mid); font-size: 12px; }
  .subtechnique-toggle input { width: 16px; height: 16px; accent-color: var(--accent); }
  .results-summary { display: flex; gap: 5px; margin: 16px 0 8px; color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
  .results-summary strong { color: var(--text); }
  .results-summary span { margin-left: auto; }
  .catalogue-layout { display: grid; grid-template-columns: minmax(320px, .72fr) minmax(460px, 1.28fr); gap: 16px; align-items: start; }
  .technique-browser { max-height: calc(100vh - 180px); overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
  .tactic-heading { position: sticky; top: 0; z-index: 1; margin: 0; padding: 9px 12px; border-bottom: 1px solid var(--border); background: var(--bg-subtle); color: var(--text-dim); font-size: 10px; letter-spacing: .07em; text-transform: uppercase; }
  .technique-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; gap: 9px; align-items: center; width: 100%; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; text-align: left; }
  .technique-row:hover { background: var(--bg-hover); }
  .technique-row.selected { box-shadow: inset 3px 0 var(--accent); background: var(--accent-bg); }
  .technique-row.subtechnique .technique-name { padding-left: 12px; }
  .technique-id { color: var(--accent-text); font-family: var(--font-mono); font-size: 10px; }
  .technique-name { min-width: 0; color: var(--text); font-size: 12px; font-weight: 600; }
  .coverage-badges { display: flex; gap: 4px; }
  .coverage-badges span { padding: 2px 5px; border: 1px solid var(--border); border-radius: 99px; color: var(--text-dim); font-family: var(--font-mono); font-size: 8px; }
  .technique-row.selected .coverage-badges span:not(.reviewed) { color: var(--text-mid); }
  .coverage-badges .reviewed { border-color: var(--accent-border); background: var(--accent-bg); color: var(--accent-text); }
  .empty-state, .relationship-empty { padding: 26px 18px; color: var(--text-dim); font-size: 12px; line-height: 1.5; }
  .technique-detail { position: sticky; top: 16px; min-width: 0; max-height: calc(100vh - 32px); overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
  .technique-detail article { padding: 22px; }
  .detail-id { margin-bottom: 6px; color: var(--accent-text); font-family: var(--font-mono); font-size: 11px; }
  .detail-title-row h2 { margin: 0; color: var(--text); font-size: clamp(22px, 3vw, 30px); letter-spacing: -.025em; }
  .mitre-link { flex: 0 0 auto; color: var(--accent-text); font-size: 11px; }
  .detail-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
  .detail-tags span { padding: 3px 7px; border-radius: 5px; background: var(--accent-bg); color: var(--accent-text); font-size: 9px; font-weight: 650; }
  .detail-tags .platform-tag { background: var(--bg-subtle); color: var(--text-dim); }
  .description-disclosure { margin-top: 16px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-subtle); }
  .description-disclosure summary { display: flex; justify-content: space-between; gap: 10px; padding: 9px 11px; color: var(--text); font-size: 11px; font-weight: 650; cursor: pointer; }
  .description-disclosure summary > span:last-child { color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; font-weight: 400; }
  .technique-description { margin: 0; padding: 0 11px 11px; color: var(--text-mid); font-size: 12px; line-height: 1.65; }
  .relationship-heading { align-items: end; margin-top: 16px; padding-top: 18px; border-top: 1px solid var(--border); }
  .relationship-heading > span { color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; }
  .mitigation-list { display: grid; gap: 10px; margin-top: 12px; }
  .mitigation-card { padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-subtle); }
  .mitigation-title-row h4 { margin: 0; color: var(--text); font-size: 13px; }
  .mitigation-title-row h4 span { margin-left: 4px; color: var(--accent-text); font-family: var(--font-mono); font-size: 10px; }
  .mitigation-title-row a { color: var(--accent-text); text-decoration: none; }
  .mitigation-guidance, .relationship-copy { margin-top: 12px; }
  .mitigation-guidance > h5, .relationship-copy > h5, .control-list-label { margin: 0; color: var(--text-dim); font-size: 9px; letter-spacing: .04em; text-transform: uppercase; }
  .guidance-blocks { display: grid; gap: 7px; margin-top: 7px; padding: 10px 11px; border-left: 2px solid var(--accent-border); border-radius: 0 6px 6px 0; background: var(--bg-card); color: var(--text-mid); font-size: 11px; line-height: 1.55; }
  .guidance-blocks h6 { margin: 4px 0 -1px; color: var(--text); font-size: 11px; font-weight: 700; line-height: 1.4; }
  .guidance-blocks p, .guidance-blocks ul { margin: 0; }
  .guidance-blocks p { white-space: pre-line; }
  .guidance-blocks ul { display: grid; gap: 4px; padding-left: 18px; }
  .guidance-blocks li { padding-left: 1px; }
  .guidance-blocks li::marker { color: var(--accent-text); }
  .relationship-copy { padding-top: 10px; border-top: 1px solid var(--border); color: var(--text-mid); font-size: 11px; line-height: 1.55; }
  .relationship-copy p { margin: 5px 0 0; }
  .relationship-copy.muted, .control-empty { color: var(--text-dim); }
  .control-empty { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--border); font-size: 10px; }
  .control-list { display: grid; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
  .control-list-label { margin-bottom: 2px; font-weight: 700; }
  .control-card { display: grid; gap: 5px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: inherit; text-decoration: none; }
  .control-card:hover { border-color: var(--accent-border); }
  .control-title { color: var(--text); font-size: 11px; }
  .control-title strong { color: var(--accent-text); font-family: var(--font-mono); }
  .control-statement { color: var(--text-mid); font-size: 10px; line-height: 1.5; }
  .control-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--text-dim); font-size: 9px; }
  .control-meta > span:last-child { margin-left: auto; color: var(--accent-text); }
  .function { font-weight: 700; text-transform: uppercase; }
  .function.protect { color: var(--green); }
  .function.detect { color: var(--amber); }
  .function.recover { color: var(--purple); }
  .detail-placeholder { display: grid; min-height: 440px; place-content: center; padding: 36px; color: var(--text-dim); text-align: center; }
  .detail-placeholder > span { color: var(--accent-text); font-size: 30px; }
  .detail-placeholder h2 { margin: 12px 0 5px; color: var(--text); font-size: 17px; }
  .detail-placeholder p { max-width: 360px; font-size: 12px; line-height: 1.55; }

  @media (max-width: 900px) {
    .catalogue-layout { grid-template-columns: minmax(0, 1fr); }
    .technique-browser { max-height: 520px; }
    .technique-detail { position: static; max-height: none; }
  }

  @media (max-width: 640px) {
    .attack-page { padding: 28px 14px 48px; }
    .page-heading, .filter-footer, .detail-title-row, .relationship-heading { align-items: stretch; flex-direction: column; }
    .source-version { text-align: left; }
    .filter-panel { padding: 14px; }
    .search-field input { min-width: 0; }
    .results-summary span { display: none; }
    .technique-browser { max-height: 460px; }
    .technique-row { grid-template-columns: 64px minmax(0, 1fr) auto; padding: 10px; }
    .technique-detail article { padding: 16px; }
    .mitre-link { align-self: flex-start; }
    .relationship-heading > span { line-height: 1.5; }
    .control-meta > span:last-child { width: 100%; margin-left: 0; }
  }
</style>
