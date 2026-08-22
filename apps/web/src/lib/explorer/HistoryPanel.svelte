<script lang="ts">
  import type { Revision } from "@rule1/shared";
  import { historyLabel } from "./relationships";

  let {
    history,
    status,
  }: {
    history: Revision[];
    status: "idle" | "loading" | "ready" | "error";
  } = $props();
</script>

{#if status === "loading"}
  <p class="panel-state">Loading version history…</p>
{:else if status === "error"}
  <p class="panel-state error">Could not load the retained history for this control.</p>
{:else if status === "ready" && history.length === 0}
  <p class="panel-state">No version history is retained for this control.</p>
{:else if status === "ready"}
  <div class="timeline">
    {#each history as revision, index}
      {@const label = historyLabel(revision, index)}
      {@const previous = history[index + 1]}
      <article class="revision" class:current={index === 0}>
        <span class="timeline-dot"></span>
        <div class="revision-heading">
          <strong>{revision.catalog_version ?? revision.commit_date ?? "Unknown version"}</strong>
          <span class:withdrawn={label === "Withdrawn"}>{label}</span>
        </div>
        {#if previous?.guideline && revision.guideline && previous.guideline !== revision.guideline}
          <p class="moved">Moved from {previous.guideline} → {revision.guideline}</p>
        {/if}
        {#if revision.statement}
          <p class="statement">{revision.statement}</p>
        {:else}
          <p class="missing">No statement was retained for this version.</p>
        {/if}
        {#if revision.applicability?.length}
          <div class="applicability">
            {#each revision.applicability as value}<span>{value}</span>{/each}
          </div>
        {/if}
      </article>
    {/each}
  </div>
{:else}
  <p class="panel-state">Select the Changelog tab to load retained history.</p>
{/if}

<style>
  .panel-state {
    margin: 0;
    padding: 8px 0;
    color: var(--text-dim);
    font-size: 13px;
  }

  .panel-state.error {
    color: var(--red);
  }

  .timeline {
    position: relative;
    padding-left: 25px;
  }

  .timeline::before {
    position: absolute;
    top: 7px;
    bottom: 8px;
    left: 7px;
    width: 1px;
    background: var(--border);
    content: "";
  }

  .revision {
    position: relative;
    margin-bottom: 24px;
  }

  .timeline-dot {
    position: absolute;
    top: 5px;
    left: -22px;
    z-index: 1;
    width: 10px;
    height: 10px;
    border: 2px solid var(--border-strong);
    border-radius: 50%;
    background: var(--bg);
  }

  .revision.current .timeline-dot {
    border-color: var(--accent);
    background: var(--accent);
  }

  .revision-heading {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .revision-heading strong {
    color: var(--text);
    font-size: 13px;
  }

  .revision-heading span {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-subtle);
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .revision-heading span.withdrawn {
    border-color: var(--red-border);
    background: var(--red-bg);
    color: var(--red);
  }

  .statement,
  .missing,
  .moved {
    margin: 8px 0 0;
    color: var(--text-mid);
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre-line;
  }

  .missing {
    color: var(--text-dim);
    font-style: italic;
  }

  .moved {
    padding: 7px 10px;
    border: 1px solid var(--purple-border);
    border-radius: 7px;
    background: var(--purple-bg);
    color: var(--purple);
  }

  .applicability {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }

  .applicability span {
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 10px;
  }
</style>
