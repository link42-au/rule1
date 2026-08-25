<script lang="ts">
  import type { Revision } from "@rule1/shared";
  import { buildHistoryEntries } from "./history-model";

  let {
    history,
    status,
    frameworkLabel,
  }: {
    history: Revision[];
    status: "idle" | "loading" | "ready" | "error";
    frameworkLabel: string;
  } = $props();

  const applicabilityLabels: Record<string, string> = {
    NC: "Not Classified",
    OS: "OFFICIAL:Sensitive",
    P: "PROTECTED",
    C: "CONFIDENTIAL",
    S: "SECRET",
    TS: "TOP SECRET",
  };
  let entries = $derived(buildHistoryEntries(history));
</script>

{#if status === "loading"}
  <p class="panel-state" role="status">Loading version history…</p>
{:else if status === "error"}
  <p class="panel-state error" role="alert">Could not load the retained history for this control.</p>
{:else if status === "ready" && history.length === 0}
  <p class="panel-state">No version history is retained for this control.</p>
{:else if status === "ready"}
  <div class="timeline">
    {#each entries as entry}
      <article class="timeline-entry">
        <span class="timeline-dot" data-kind={entry.dotKind}></span>
        <div class="timeline-header">
          <strong>{entry.version}</strong>
          <span class="badge" data-kind={entry.kind}>{entry.label}</span>
          {#if entry.source}
            <span class="badge source" class:pdf={entry.source.toLowerCase() === "pdf"}>
              {entry.source.toLowerCase() === "pdf" ? "PDF" : `Source: ${entry.source}`}
            </span>
          {/if}
          {#if entry.complexity}
            <span
              class="badge complexity"
              data-complexity={entry.complexity.value}
              title={`Implementation effort: ${entry.complexity.label}`}
            >{entry.complexity.label}</span>
          {/if}
          {#if entry.move}<span class="badge moved-badge">Moved</span>{/if}
        </div>

        {#if entry.withdrawn}
          <div class="callout withdrawn-callout">
            <span>Withdrawn</span>
            <p>This control was removed from the {frameworkLabel} catalogue in {entry.version}.</p>
          </div>
        {/if}

        {#if entry.move}
          <div class="callout moved-callout">
            <span>Moved</span><del>{entry.move.from}</del><span aria-hidden="true">→</span><strong>{entry.move.to}</strong>
          </div>
        {/if}

        {#if entry.compliance}
          <p class="compliance">Compliance: <strong>{entry.compliance}</strong></p>
        {/if}

        {#if entry.statementDiff}
          <div class="statement-diff" aria-label="Statement changes">
            {#each entry.statementDiff as part}
              {#if part.kind === "deleted"}
                <del>{part.text}</del>
              {:else if part.kind === "inserted"}
                <ins>{part.text}</ins>
              {:else}{part.text}{/if}
            {/each}
          </div>
        {/if}

        {#if entry.applicabilityChange}
          <div class="applicability-diff" aria-label="Applicability changes">
            <div class="applicability-before">
              <strong>Before</strong>
              {#if entry.applicabilityChange.before.length === 0}<em>none</em>{/if}
              {#each entry.applicabilityChange.before as value}
                <span data-classification={value}>{applicabilityLabels[value] ?? value}</span>
              {/each}
            </div>
            <div class="applicability-after">
              <strong>After</strong>
              {#if entry.applicabilityChange.after.length === 0}<em>none</em>{/if}
              {#each entry.applicabilityChange.after as value}
                <span data-classification={value}>{applicabilityLabels[value] ?? value}</span>
              {/each}
            </div>
          </div>
        {/if}
      </article>
    {/each}
  </div>
{:else}
  <p class="panel-state">Select the Changelog tab to load retained history.</p>
{/if}

<style>
  .panel-state { margin: 0; padding: 8px 0; color: var(--text-dim); font-size: 13px; }
  .panel-state.error { color: var(--red); }
  .timeline { position: relative; padding-left: 24px; }
  .timeline::before { position: absolute; top: 8px; bottom: 8px; left: 7px; width: 1px; background: var(--border); content: ""; }
  .timeline-entry { position: relative; margin-bottom: 24px; }
  .timeline-entry:last-child { margin-bottom: 0; }
  .timeline-dot { position: absolute; top: 6px; left: -21px; z-index: 1; width: 10px; height: 10px; border: 2px solid var(--border-strong); border-radius: 50%; background: var(--bg); }
  .timeline-dot[data-kind="current"] { border-color: var(--accent); background: var(--accent); }
  .timeline-dot[data-kind="modified"] { border-color: var(--amber); }
  .timeline-dot[data-kind="new"] { border-color: var(--green); }
  .timeline-dot[data-kind="withdrawn"] { border-color: var(--red); }
  .timeline-dot[data-kind="moved"] { border-color: var(--purple); }
  .timeline-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
  .timeline-header strong { color: var(--text); font-size: 13px; letter-spacing: -0.01em; }
  .badge { padding: 2px 7px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-subtle); color: var(--text-dim); font-size: 10px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
  .badge[data-kind="current"] { border-color: var(--accent-border); background: var(--accent-bg); color: var(--accent); }
  .badge[data-kind="modified"] { border-color: var(--amber-border); background: var(--amber-bg); color: var(--amber); }
  .badge[data-kind="new"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .badge[data-kind="withdrawn"] { border-color: var(--red-border); background: var(--red-bg); color: var(--red); }
  .badge.pdf { border-color: #d97706; background: #fef3c7; color: #92400e; }
  .badge[data-complexity="low"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .badge[data-complexity="medium"] { border-color: var(--amber-border); background: var(--amber-bg); color: var(--amber); }
  .badge[data-complexity="high"] { border-color: var(--red-border); background: var(--red-bg); color: var(--red); }
  .moved-badge { border-color: var(--purple-border); background: var(--purple-bg); color: var(--purple); }
  .compliance { margin: 0 0 6px; color: var(--text-dim); font-size: 12px; }
  .callout { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; padding: 8px 12px; border: 1px solid; border-radius: 8px; font-size: 12px; }
  .callout > span:first-child { margin-right: 2px; font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .callout p { margin: 0; color: var(--text-mid); }
  .moved-callout { border-color: var(--purple-border); background: var(--purple-bg); }
  .moved-callout > span:first-child, .moved-callout strong { color: var(--purple); }
  .moved-callout del { color: var(--text-dim); }
  .withdrawn-callout { border-color: var(--red-border); background: var(--red-bg); }
  .withdrawn-callout > span:first-child { color: var(--red); }
  .statement-diff, .applicability-diff { overflow: hidden; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-subtle); }
  .statement-diff { padding: 8px 14px; color: var(--text-mid); font-family: "Geist Mono", monospace; font-size: 12px; line-height: 1.65; white-space: pre-wrap; }
  .statement-diff del, .statement-diff ins { border-radius: 2px; padding: 0 2px; text-decoration: none; }
  .statement-diff del { background: var(--red-bg); color: var(--red); text-decoration: line-through; }
  .statement-diff ins { background: var(--green-bg); color: var(--green); font-weight: 600; }
  .applicability-diff > div { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 14px; font-size: 11px; }
  .applicability-before { border-bottom: 1px solid var(--red-border); background: var(--red-bg); }
  .applicability-after { background: var(--green-bg); }
  .applicability-before > strong { color: var(--red); }
  .applicability-after > strong { color: var(--green); }
  .applicability-diff em { color: var(--text-dim); }
  .applicability-diff span { padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text-mid); }
  .applicability-diff span[data-classification="P"], .applicability-diff span[data-classification="C"], .applicability-diff span[data-classification="S"], .applicability-diff span[data-classification="TS"] { font-weight: 600; }
</style>
