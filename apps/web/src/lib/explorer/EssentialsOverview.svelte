<script lang="ts">
  import type { ControlDetail } from "@rule1/shared";
  import { essentialsInfo, sourceLabel } from "./essentials-model";
  import SourceParts from "./SourceParts.svelte";
  let { detail }: { detail: ControlDetail } = $props();
  let info = $derived(essentialsInfo(detail.latest.metadata));
</script>

<div class="essentials-overview">
  <p class="attribution">ASD Essentials for Enterprise IT · {detail.latest.catalog_version}. Source: Australian Signals Directorate, © Commonwealth of Australia 2026, CC BY 4.0. This is a separate framework from ISM, Essential Eight and UK Cyber Essentials.</p>
  {#each info.principles as principle}
    <section>
      <h2>Principle · {principle.title ?? principle.id}</h2>
      <SourceParts parts={principle.parts ?? []} />
    </section>
  {/each}
  <section>
    <h2>Action · {detail.display_id}</h2>
    <p class="action">{detail.latest.statement}</p>
  </section>
  <section aria-label="Applicable domains and priority phases">
    <h2>Domains and priority phases</h2>
    <div class="domains">
      {#each info.domains as domain}
        <article>
          <h3>{sourceLabel(domain.id)}</h3>
          <p>{domain.description}</p>
          <p class="phases">{#each domain.phases as phase}<span>{sourceLabel(phase)}</span>{:else}No priority phase supplied.{/each}</p>
          <a href={domain.source}>ASD domain profile</a>
        </article>
      {/each}
    </div>
  </section>
  {#each info.indicators as indicator}
    <section aria-label="Indicators of Good Practice">
      <h2>{indicator.title ?? "Indicators of Good Practice"}</h2>
      <p>These publisher-supplied indicators support assessment and expert judgement; they are not a checklist.</p>
      {#each indicator.parts ?? [] as group}
        <article class="indicator-group">
          <h3>{group.title ?? group.class}</h3>
          <SourceParts parts={group.parts ?? []} />
        </article>
      {/each}
    </section>
  {/each}
  {#if info.additional.length}<section><h2>Additional source information</h2><SourceParts parts={info.additional} /></section>{/if}
  {#if info.techniques.length}
    <section>
      <h2>Publisher-supplied ATT&amp;CK references</h2>
      <p>ASD lists these techniques as mitigated by this action. These references do not imply equivalence to ISM controls.</p>
      <ul>{#each info.techniques as technique}<li><a href={technique.url}>{technique.title}</a></li>{/each}</ul>
    </section>
  {/if}
  <footer>
    <a href="https://www.cyber.gov.au/e4eit/oscal/v2026.10.15">Official release</a>
    · <a href="https://www.cyber.gov.au/ns/essentials/oscal/1.0">Essentials namespace definitions</a>
    · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
  </footer>
  <details><summary>Retained publisher metadata</summary><pre>{JSON.stringify(detail.latest.metadata, null, 2)}</pre></details>
</div>

<style>
  .essentials-overview { min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
  section { margin: 22px 0; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  h3 { font-size: 14px; margin: 0 0 8px; }
  p { line-height: 1.65; }
  .attribution, footer { color: var(--text-dim); font-size: 12px; line-height: 1.65; }
  .action { white-space: pre-wrap; }
  .domains { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 12px; }
  article { padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-subtle); }
  .indicator-group { margin: 12px 0; }
  .phases { display: flex; flex-wrap: wrap; gap: 6px; }
  .phases span { border: 1px solid var(--accent-border); border-radius: 12px; padding: 2px 8px; }
  a { color: var(--accent); }
  details { margin-top: 18px; }
  summary { cursor: pointer; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
</style>
