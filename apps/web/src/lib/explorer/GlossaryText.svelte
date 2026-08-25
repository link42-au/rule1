<script lang="ts">
  import type { GlossaryTerm } from "@rule1/shared";
  import { glossarySegments } from "./state";

  let { text, terms }: { text: string; terms: GlossaryTerm[] } = $props();
  let segments = $derived(glossarySegments(text, terms));
</script>

{#each segments as segment}
  {#if segment.meaning}
    <span class="term-link" title={segment.meaning}>{segment.text}</span>
  {:else}{segment.text}{/if}
{/each}

<style>
  .term-link {
    border-bottom: 1px dotted var(--accent);
    color: var(--accent);
    cursor: help;
  }
</style>
