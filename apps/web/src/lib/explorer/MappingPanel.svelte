<script lang="ts">
  import type { E8Mapping } from "$lib/db/contracts";
  import { mappingState } from "./relationships";

  let {
    levels,
    mappings,
    version,
    currentVersion,
    status,
  }: {
    levels: string[];
    mappings: E8Mapping[];
    version: string | null;
    currentVersion: string | null;
    status: "idle" | "loading" | "ready" | "error";
  } = $props();

  let state = $derived(mappingState(levels, mappings));
  let historical = $derived(version !== null && version !== currentVersion);
</script>

<section class="mapping-panel">
  <h2>{historical ? "Historical Essential Eight mapping" : "Essential Eight mapping"}</h2>
  {#if status === "loading"}
    <p class="mapping-state" role="status">Loading retained mappings…</p>
  {:else if status === "error"}
    <p class="mapping-state error" role="alert">Could not load mapping data for this control.</p>
  {:else if state === "unmapped"}
    <p class="mapping-state">No Essential Eight mapping is retained for this control.</p>
  {:else}
    {#if version}
      <p class="mapping-version">
        Retained for {version}{historical ? "; this does not imply current coverage." : "."}
      </p>
    {/if}
    <div class="level-row" aria-label="Mapped maturity levels">
      {#each levels as level}<span>{level}</span>{/each}
    </div>
    {#if state === "mapped"}
      <div class="mapping-list">
        {#each mappings as mapping}
          <div class="mapping-row"><strong>{mapping.strategy}</strong><span>{mapping.level}</span></div>
        {/each}
      </div>
    {:else}
      <p class="mapping-state">Maturity levels are retained, but strategy names are not present in the archived source.</p>
    {/if}
  {/if}
</section>

<style>
  .mapping-panel {
    margin-top: 24px;
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-subtle);
  }

  h2 {
    margin: 0 0 10px;
    color: var(--text-dim);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .level-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .level-row span,
  .mapping-row span {
    padding: 3px 7px;
    border: 1px solid var(--purple-border);
    border-radius: 5px;
    background: var(--purple-bg);
    color: var(--purple);
    font-size: 10px;
    font-weight: 650;
  }

  .mapping-state {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
  }

  .mapping-version {
    margin: 0 0 9px;
    color: var(--text-dim);
    font-size: 11px;
  }

  .mapping-state.error {
    color: var(--red);
  }

  .mapping-list {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }

  .mapping-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--text-mid);
    font-size: 12px;
  }
</style>
