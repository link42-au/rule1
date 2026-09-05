<script lang="ts">
  import type { AttackMappingResult } from "$lib/db/contracts";
  import {
    attackOutcomeSections,
    attackTacticSummary,
    effectInfinitive,
    effectRelationshipPhrase,
    formatAttackLabel,
    groupAttackMappings,
  } from "./attack-model";

  let {
    result,
    status,
  }: {
    result: AttackMappingResult;
    status: "idle" | "loading" | "ready" | "error";
  } = $props();

  let techniques = $derived(groupAttackMappings(result.mappings));
  let outcomeSections = $derived(attackOutcomeSections(result.mappings));
  let tacticSummary = $derived(attackTacticSummary(techniques));
</script>

<section class="attack-panel" aria-labelledby="attack-heading">
  <div class="attack-intro">
    <div>
      <p class="eyebrow">Threat-informed view</p>
      <h2 id="attack-heading">MITRE ATT&amp;CK mappings</h2>
    </div>
    {#if result.ismCatalogVersion || result.attackVersion}
      <div class="version-row" aria-label="Mapping source versions">
        {#if result.ismCatalogVersion}<span>ISM {result.ismCatalogVersion}</span>{/if}
        {#if result.attackVersion}<span>ATT&amp;CK {result.attackVersion}</span>{/if}
      </div>
    {/if}
  </div>

  <p class="mapping-caveat">
    Reviewed mappings show where this control may prevent, constrain, detect, contain, or support recovery from a technique.
    Outcomes depend on implementation and context. Confidence describes confidence in the mapping, not control effectiveness.
  </p>

  {#if status === "idle" || status === "loading"}
    <div class="attack-state" role="status">
      <span class="state-mark" aria-hidden="true">···</span>
      <div><strong>Loading reviewed mappings</strong><span>Querying the browser-local catalogue.</span></div>
    </div>
  {:else if status === "error"}
    <div class="attack-state error" role="alert">
      <span class="state-mark" aria-hidden="true">!</span>
      <div><strong>ATT&amp;CK mappings unavailable</strong><span>Could not read mapping data from the local catalogue.</span></div>
    </div>
  {:else if techniques.length === 0}
    <div class="attack-state empty">
      <span class="state-mark" aria-hidden="true">◇</span>
      <div>
        <strong>No reviewed ATT&amp;CK mappings</strong>
        <span>Candidate relationships stay hidden until an exact human review decision is committed.</span>
      </div>
    </div>
  {:else}
    <div class="tactic-strip" aria-label="Mapped ATT&CK tactics">
      {#each tacticSummary as tactic (tactic.id)}
        <div class:active={tactic.count > 0} class="tactic-cell">
          <span>{tactic.label}</span><strong>{tactic.count}</strong>
        </div>
      {/each}
    </div>

    <p class="coverage-summary">
      {techniques.length} reviewed technique{techniques.length === 1 ? "" : "s"} across
      {tacticSummary.filter((tactic) => tactic.count > 0).length} tactic{tacticSummary.filter((tactic) => tactic.count > 0).length === 1 ? "" : "s"}.
    </p>

    <div class="outcome-sections">
      {#each outcomeSections as outcome (outcome.outcomeClass)}
        <section class="outcome-section" aria-labelledby={`attack-outcome-${outcome.outcomeClass}`}>
          <div class="outcome-heading">
            <div>
              <p class="eyebrow">Outcome class</p>
              <h3 id={`attack-outcome-${outcome.outcomeClass}`}>{outcome.title}</h3>
            </div>
            <span>{outcome.techniques.length} technique{outcome.techniques.length === 1 ? "" : "s"}</span>
          </div>
          <p class="outcome-description">{outcome.description}</p>

          <div class="technique-list">
            {#each outcome.techniques as technique (technique.techniqueId)}
              <article class="technique-card">
                <header class="technique-header">
                  <div class="technique-title">
                    {#if technique.techniqueUrl}
                      <a class="technique-id" href={technique.techniqueUrl} target="_blank" rel="noopener noreferrer">
                        {technique.techniqueId}<span class="sr-only"> on MITRE ATT&amp;CK</span><span aria-hidden="true"> ↗</span>
                      </a>
                    {:else}
                      <span class="technique-id">{technique.techniqueId}</span>
                    {/if}
                    <h4>{technique.techniqueName}</h4>
                  </div>
                  <div class="effect-row" aria-label="Relationship outcomes">
                    {#each technique.effects as effect}<span class="effect-chip" data-effect={effect}>{effectRelationshipPhrase(effect)}</span>{/each}
                  </div>
                </header>

                <div class="badge-row">
                  {#each technique.tactics as tactic}<span class="tactic-badge">{formatAttackLabel(tactic)}</span>{/each}
                  {#each technique.platforms as platform}<span class="platform-badge">{platform}</span>{/each}
                </div>

                {#if technique.techniqueDescription}<p class="technique-description">{technique.techniqueDescription}</p>{/if}

                <div class="mapping-list">
                  {#each technique.mappings as mapping, index (`${mapping.mitigationId}-${mapping.effect}-${mapping.confidence}-${index}`)}
                    <section
                      class="mapping-row"
                      aria-label={`This control supports ${mapping.mitigationName} (${mapping.mitigationId}) to ${effectInfinitive(mapping.effect)} ${technique.techniqueName} (${technique.techniqueId})`}
                    >
                      <p class="relationship-copy">
                        This control supports
                        {#if mapping.mitigationUrl}
                          <a href={mapping.mitigationUrl} target="_blank" rel="noopener noreferrer">
                            {mapping.mitigationName} ({mapping.mitigationId})<span class="sr-only"> on MITRE ATT&amp;CK</span><span aria-hidden="true"> ↗</span>
                          </a>
                        {:else}
                          <strong>{mapping.mitigationName} ({mapping.mitigationId})</strong>
                        {/if}
                        to <strong>{effectInfinitive(mapping.effect)}</strong>
                        {technique.techniqueName} ({technique.techniqueId}).
                      </p>
                      <div class="mapping-meta">
                        <span class="outcome-chip" data-effect={mapping.effect}>{effectRelationshipPhrase(mapping.effect)}</span>
                        <span class="confidence-chip" data-confidence={mapping.confidence}>{mapping.confidence} mapping confidence</span>
                      </div>
                      <p class="rationale">{mapping.rationale}</p>
                      {#if mapping.evidenceNotes.length > 0}
                        <div class="evidence">
                          <strong>Review evidence</strong>
                          {#each mapping.evidenceNotes as note}<p>{note}</p>{/each}
                        </div>
                      {/if}
                    </section>
                  {/each}
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</section>

<style>
  .attack-panel { padding-bottom: 28px; }
  .attack-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .eyebrow { margin: 0 0 4px; color: var(--accent-text); font-size: 10px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
  h2 { margin: 0; color: var(--text); font-size: 20px; letter-spacing: -0.02em; }
  .version-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
  .version-row span { padding: 4px 7px; border: 1px solid var(--accent-border); border-radius: 5px; background: var(--accent-bg); color: var(--accent-text); font-family: var(--font-mono); font-size: 9px; font-weight: 600; }
  .mapping-caveat { margin: 12px 0 18px; padding: 11px 13px; border-left: 3px solid var(--accent); background: var(--bg-subtle); color: var(--text-mid); font-size: 12px; line-height: 1.55; }
  .attack-state { display: flex; align-items: center; gap: 13px; min-height: 90px; padding: 18px; border: 1px dashed var(--border-strong); border-radius: 10px; background: var(--bg-subtle); color: var(--text-mid); }
  .attack-state .state-mark { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border: 1px solid var(--accent-border); border-radius: 50%; color: var(--accent-text); font-family: var(--font-mono); font-weight: 700; }
  .attack-state strong, .attack-state span { display: block; }
  .attack-state div > span { margin-top: 3px; color: var(--text-dim); font-size: 12px; line-height: 1.5; }
  .attack-state.error .state-mark, .attack-state.error strong { color: var(--red); }
  .tactic-strip { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 5px; }
  .tactic-cell { display: flex; min-width: 70px; flex: 1 0 70px; flex-direction: column; align-items: center; gap: 5px; padding: 7px 4px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-dim); }
  .tactic-cell.active { border-color: var(--accent-border); background: var(--accent-bg); color: var(--accent-text); }
  .tactic-cell span { font-size: 9px; line-height: 1.15; text-align: center; }
  .tactic-cell strong { font-family: var(--font-mono); font-size: 16px; }
  .coverage-summary { margin: 7px 0 14px; color: var(--text-dim); font-size: 11px; }
  .outcome-sections, .technique-list { display: grid; gap: 12px; }
  .outcome-sections { gap: 22px; }
  .outcome-section { min-width: 0; }
  .outcome-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .outcome-heading .eyebrow { margin-bottom: 2px; }
  .outcome-heading h3 { margin: 0; color: var(--text); font-size: 15px; }
  .outcome-heading > span { color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; }
  .outcome-description { margin: 8px 0 10px; color: var(--text-dim); font-size: 11px; line-height: 1.5; }
  .technique-card { overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
  .technique-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px 10px; }
  .technique-title { min-width: 0; }
  .technique-id { color: var(--accent-text); font-family: var(--font-mono); font-size: 11px; font-weight: 650; text-decoration: none; }
  a.technique-id:hover { text-decoration: underline; }
  .technique-title h4 { margin: 3px 0 0; color: var(--text); font-size: 15px; }
  .effect-row, .badge-row { display: flex; flex-wrap: wrap; gap: 5px; }
  .effect-row { justify-content: flex-end; }
  .effect-chip, .tactic-badge, .platform-badge, .confidence-chip { padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; font-size: 9px; font-weight: 650; }
  .effect-chip { background: var(--accent-bg); color: var(--accent-text); text-transform: capitalize; }
  .effect-chip[data-effect="detect"] { border-color: var(--purple-border); background: var(--purple-bg); color: var(--purple); }
  .effect-chip[data-effect="recover"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .effect-chip[data-effect="contain"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .effect-chip[data-effect="constrain"] { border-color: var(--amber-border); background: var(--amber-bg); color: var(--amber); }
  .badge-row { padding: 0 16px 12px; }
  .tactic-badge { border-color: var(--accent-border); color: var(--accent-text); }
  .platform-badge { color: var(--text-dim); }
  .technique-description { margin: 0; padding: 0 16px 14px; color: var(--text-mid); font-size: 12px; line-height: 1.55; }
  .mapping-list { border-top: 1px solid var(--border); }
  .mapping-row { padding: 13px 16px; background: var(--bg-subtle); }
  .mapping-row + .mapping-row { border-top: 1px solid var(--border); }
  .relationship-copy { margin: 0; color: var(--text-mid); font-size: 12px; line-height: 1.55; }
  .relationship-copy a, .relationship-copy strong { color: var(--text); font-weight: 650; text-decoration: none; }
  .relationship-copy a:hover { text-decoration: underline; }
  .mapping-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .outcome-chip { padding: 3px 7px; border: 1px solid var(--accent-border); border-radius: 999px; background: var(--accent-bg); color: var(--accent-text); font-size: 9px; font-weight: 650; }
  .outcome-chip[data-effect="constrain"] { border-color: var(--amber-border); background: var(--amber-bg); color: var(--amber); }
  .outcome-chip[data-effect="detect"] { border-color: var(--purple-border); background: var(--purple-bg); color: var(--purple); }
  .outcome-chip[data-effect="contain"], .outcome-chip[data-effect="recover"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .confidence-chip { color: var(--text-dim); text-transform: capitalize; }
  .confidence-chip[data-confidence="high"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .mapping-row > p.rationale, .evidence p { margin: 8px 0 0; color: var(--text-mid); font-size: 12px; line-height: 1.55; }
  .evidence { margin-top: 9px; padding-top: 9px; border-top: 1px dashed var(--border); }
  .evidence strong { color: var(--text-dim); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; }
  .evidence p { margin-top: 4px; color: var(--text-dim); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; margin: -1px; padding: 0; border: 0; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 720px) {
    .attack-intro, .technique-header { flex-direction: column; }
    .version-row, .effect-row { justify-content: flex-start; }
    .tactic-cell { min-width: 64px; flex-basis: 64px; }
    .outcome-heading { align-items: flex-start; flex-direction: column; }
  }
</style>
