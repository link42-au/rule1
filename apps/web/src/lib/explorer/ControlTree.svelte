<script lang="ts">
  import type { Control, Group } from "@rule1/shared";
  import ControlTree from "./ControlTree.svelte";
  import { countGroupControls, groupContainsControl } from "./state";

  let {
    groups,
    bySection,
    selectedId,
    favourites,
    openGroupIds,
    onSelect,
    onToggleFavourite,
    onGroupToggle,
    depth = 0,
  }: {
    groups: Group[];
    bySection: Map<string, Control[]>;
    selectedId: string | null;
    favourites: Set<string>;
    openGroupIds: Set<string>;
    onSelect: (id: string) => void;
    onToggleFavourite: (id: string) => void;
    onGroupToggle: (id: string, open: boolean) => void;
    depth?: number;
  } = $props();

  function groupIsOpen(group: Group): boolean {
    return openGroupIds.has(group.id) || groupContainsControl(group, selectedId, bySection);
  }
</script>

{#each groups as group (group.id)}
  {@const count = countGroupControls(group, bySection)}
  {#if count > 0}
    <details
      class="ctrl-group"
      class:ctrl-group-child={depth > 0}
      data-group-id={group.id}
      open={groupIsOpen(group)}
      ontoggle={(event) => onGroupToggle(group.id, event.currentTarget.open)}
    >
      <summary class="ctrl-group-header" style:padding-left={`${8 + depth * 12}px`}>
        <span class="ctrl-group-chevron">▶</span>
        <span class="ctrl-group-name">{group.title.replace(/^Guidelines for /i, "")}</span>
        <span class="ctrl-group-count">{count}</span>
      </summary>

      {#if groupIsOpen(group)}
        {#if group.children.length > 0}
          <ControlTree
            groups={group.children}
            {bySection}
            {selectedId}
            {favourites}
            {openGroupIds}
            {onSelect}
            {onToggleFavourite}
            {onGroupToggle}
            depth={depth + 1}
          />
        {/if}

        {#each bySection.get(group.id) ?? [] as control (control.id)}
          <div
            class="ctrl-row"
            class:active={selectedId === control.id}
            class:withdrawn={control.change_type === "withdrawn"}
            data-id={control.id}
            role="button"
            tabindex="0"
            onclick={() => onSelect(control.id)}
            onkeydown={(event) => (event.key === "Enter" || event.key === " ") && onSelect(control.id)}
          >
            <span class="ctrl-row-content">
              <span class="ctrl-row-id">
                {control.display_id}
                {#if control.change_type === "withdrawn"}<span class="withdrawn-badge">Withdrawn</span>{/if}
              </span>
              {#if control.title && !control.title.startsWith("Control: ")}
                <span class="ctrl-row-title">{control.title}</span>
              {/if}
              <span class="ctrl-row-name">{control.statement ?? control.label ?? "No description available."}</span>
            </span>
            <button
              type="button"
              class="favourite"
              class:active={favourites.has(control.id)}
              aria-label={favourites.has(control.id) ? `Remove ${control.display_id} from favourites` : `Add ${control.display_id} to favourites`}
              onclick={(event) => {
                event.stopPropagation();
                onToggleFavourite(control.id);
              }}
            >★</button>
          </div>
        {/each}
      {/if}
    </details>
  {/if}
{/each}

<style>
  .ctrl-group {
    border-bottom: 1px solid var(--border);
  }

  .ctrl-group-child {
    border-bottom: 0;
    border-top: 1px solid var(--border);
  }

  .ctrl-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-block: 7px;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    list-style: none;
    text-transform: uppercase;
  }

  .ctrl-group-header:hover {
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text);
  }

  .ctrl-group-chevron {
    font-size: 7px;
    transition: transform 0.15s;
  }

  details[open] > .ctrl-group-header .ctrl-group-chevron {
    transform: rotate(90deg);
  }

  .ctrl-group-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctrl-group-count {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-subtle);
    font-weight: 500;
  }

  .ctrl-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: calc(100% - 12px);
    margin: 1px 6px;
    padding: 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .ctrl-row:hover,
  .ctrl-row.active {
    background: var(--bg-active);
  }

  .ctrl-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .ctrl-row-id,
  .ctrl-row-title,
  .ctrl-row-name {
    display: block;
  }

  .ctrl-row-content {
    min-width: 0;
    flex: 1;
  }

  .favourite {
    padding: 2px;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
    opacity: 0;
  }

  .ctrl-row:hover .favourite,
  .favourite.active,
  .favourite:focus-visible {
    opacity: 1;
  }

  .favourite.active {
    color: var(--amber);
  }

  .ctrl-row-id {
    margin-bottom: 1px;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }

  .ctrl-row-title {
    overflow: hidden;
    color: var(--text-dim);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctrl-row-name {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text-mid);
    font-size: 12px;
    line-height: 1.35;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .ctrl-row.withdrawn {
    opacity: 0.62;
  }

  .ctrl-row.withdrawn .ctrl-row-id {
    color: var(--text-dim);
    text-decoration: line-through;
  }

  .withdrawn-badge {
    display: inline-flex;
    margin-left: 5px;
    padding: 1px 5px;
    border: 1px solid var(--red-border);
    border-radius: 4px;
    background: var(--red-bg);
    color: var(--red);
    font-family: var(--font-sans);
    font-size: 9px;
    font-weight: 650;
    line-height: 1.3;
    text-decoration: none;
    vertical-align: 1px;
  }
</style>
