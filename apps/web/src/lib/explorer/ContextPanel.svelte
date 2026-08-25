<script lang="ts">
  import type { GraphData } from "@rule1/shared";
  import { graphCenter, graphNeighbors } from "./relationships";

  let {
    graph,
    status,
    onSelect,
  }: {
    graph: GraphData | null;
    status: "idle" | "loading" | "ready" | "error";
    onSelect: (id: string) => void;
  } = $props();

  const MAX_GRAPH_NODES = 24;
  let center = $derived(graphCenter(graph));
  let neighbors = $derived(graphNeighbors(graph));
  let visibleNeighbors = $derived(neighbors.slice(0, MAX_GRAPH_NODES));

  function point(index: number, total: number): { x: number; y: number } {
    const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: 300 + Math.cos(angle) * 215, y: 160 + Math.sin(angle) * 115 };
  }

  function selectNeighbor(event: KeyboardEvent, id: string): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(id);
  }
</script>

{#if status === "loading"}
  <p class="panel-state" role="status">Loading control relationships…</p>
{:else if status === "error"}
  <p class="panel-state error" role="alert">Could not load relationships for this control.</p>
{:else if status === "ready" && (!center || neighbors.length === 0)}
  <p class="panel-state">No related controls are retained in the same section.</p>
{:else if status === "ready" && center}
  <section class="graph-section">
    <div class="section-heading">
      <h2>Graph neighbourhood</h2>
      <span>{graph?.group?.title ?? "Same section"}</span>
    </div>
    <svg viewBox="0 0 600 320" role="img" aria-label={`${neighbors.length} controls related to ${center.data.display_id}`}>
      {#each visibleNeighbors as neighbor, index}
        {@const position = point(index, visibleNeighbors.length)}
        <line x1="300" y1="160" x2={position.x} y2={position.y}></line>
        <g
          role="button"
          tabindex="0"
          aria-label={`Open ${neighbor.data.display_id ?? neighbor.data.id}`}
          onclick={() => onSelect(neighbor.data.id)}
          onkeydown={(event) => selectNeighbor(event, neighbor.data.id)}
        >
          <circle cx={position.x} cy={position.y} r="19"></circle>
          <text x={position.x} y={position.y + 3}>{neighbor.data.display_id ?? neighbor.data.id}</text>
        </g>
      {/each}
      <circle class="center" cx="300" cy="160" r="31"></circle>
      <text class="center-label" x="300" y="164">{center.data.display_id ?? center.data.id}</text>
    </svg>
    {#if neighbors.length > MAX_GRAPH_NODES}
      <p class="graph-note">Showing 24 of {neighbors.length} related controls in the graph. The complete list appears below.</p>
    {/if}
  </section>

  <section class="related-section">
    <h2>Related controls (same section)</h2>
    <div class="related-list">
      {#each neighbors as neighbor}
        <button type="button" onclick={() => onSelect(neighbor.data.id)}>
          <strong>{neighbor.data.display_id ?? neighbor.data.id}</strong>
          <span>{neighbor.data.statement ?? neighbor.data.label ?? "No description available."}</span>
          <span class="arrow">→</span>
        </button>
      {/each}
    </div>
  </section>
{:else}
  <p class="panel-state">Select the Context tab to load relationships.</p>
{/if}

<style>
  .panel-state,
  .graph-note {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  .panel-state.error {
    color: var(--red);
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  h2 {
    margin: 0 0 10px;
    color: var(--text-dim);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .section-heading span {
    color: var(--text-dim);
    font-size: 11px;
  }

  svg {
    width: 100%;
    max-height: 340px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-subtle);
  }

  line {
    stroke: var(--border-strong);
    stroke-dasharray: 4 3;
    stroke-width: 1;
  }

  circle {
    fill: var(--bg-card);
    stroke: var(--accent-border);
    stroke-width: 1.5;
  }

  g {
    cursor: pointer;
  }

  g:hover circle,
  g:focus circle {
    fill: var(--accent-bg);
    stroke: var(--accent);
  }

  text {
    fill: var(--text-mid);
    font-family: var(--font-mono);
    font-size: 7px;
    text-anchor: middle;
  }

  .center {
    fill: var(--accent);
    stroke: var(--accent);
  }

  .center-label {
    fill: white;
    font-size: 9px;
    font-weight: 700;
  }

  .graph-note {
    margin-top: 7px;
  }

  .related-section {
    margin-top: 24px;
  }

  .related-list {
    display: grid;
    gap: 5px;
  }

  .related-list button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    color: var(--text-mid);
    cursor: pointer;
    text-align: left;
  }

  .related-list button:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  .related-list strong {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .related-list span {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .related-list .arrow {
    color: var(--text-dim);
  }
</style>
