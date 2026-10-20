<script lang="ts">
  import SourceParts from "./SourceParts.svelte";
  import type { SourcePart } from "./essentials-model";
  let { parts }: { parts: SourcePart[] } = $props();
</script>

<ul>
  {#each parts as part}
    <li>
      {#if part.title}<strong>{part.title}</strong>{/if}
      {#if part.id}<span class="source-id">{part.id}</span>{/if}
      {#if part.prose}<p>{part.prose}</p>{/if}
      {#if part.parts?.length}<SourceParts parts={part.parts} />{/if}
    </li>
  {/each}
</ul>

<style>
  ul { margin: 8px 0; padding-left: 22px; }
  li { margin: 10px 0; overflow-wrap: anywhere; }
  p { margin: 6px 0; white-space: pre-wrap; line-height: 1.65; }
  .source-id { display: block; color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
</style>
