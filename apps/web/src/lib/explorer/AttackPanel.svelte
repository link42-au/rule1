<script lang="ts">
  import type { AttackMappingResult } from "$lib/db/contracts";
  import {
    attackTacticSummary,
    formatAttackLabel,
    groupAttackMitigations,
    procedureReferenceLabel,
    safeMitreUrl,
    safeSourceUrl,
    uniqueAttackTechniques,
  } from "./attack-model";

  let {
    result,
    status,
  }: {
    result: AttackMappingResult;
    status: "idle" | "loading" | "ready" | "error";
  } = $props();

  let mitigations = $derived(groupAttackMitigations(result.mappings, result.procedures));
  let techniques = $derived(uniqueAttackTechniques(mitigations));
  let tacticSummary = $derived(attackTacticSummary(mitigations));
  let expandedMitigations = $state<Record<string, boolean>>({});

  const INITIAL_TECHNIQUE_LIMIT = 12;
  const mitigationKey = (candidateId: string, mitigationId: string) => `${candidateId}:${mitigationId}`;
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
    Reviewed mappings show where this control enables an ATT&amp;CK mitigation. Techniques are expanded from MITRE's
    official mitigation relationships; they are context, not a claim that this control prevents or detects each technique.
    Confidence applies to the control-to-mitigation mapping, not control effectiveness.
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
  {:else if mitigations.length === 0}
    <div class="attack-state empty">
      <span class="state-mark" aria-hidden="true">◇</span>
      <div>
        <strong>No reviewed ATT&amp;CK mappings to mitigations</strong>
        <span>Candidate relationships stay hidden until an exact human review decision is committed.</span>
      </div>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable labelled region needs keyboard access) -->
    <div class="tactic-strip" role="region" aria-label="Mapped ATT&CK tactics" tabindex="0">
      {#each tacticSummary as tactic (tactic.id)}
        <div class:active={tactic.count > 0} class="tactic-cell">
          <span>{tactic.label}</span><strong>{tactic.count}</strong>
        </div>
      {/each}
    </div>

    <p class="coverage-summary">
      {mitigations.length} reviewed mitigation{mitigations.length === 1 ? "" : "s"} reaching
      {techniques.length} official technique{techniques.length === 1 ? "" : "s"} across
      {tacticSummary.filter((tactic) => tactic.count > 0).length} tactic{tacticSummary.filter((tactic) => tactic.count > 0).length === 1 ? "" : "s"}.
    </p>

    <div class="mitigation-list">
      {#each mitigations as mitigation (`${mitigation.candidateId}-${mitigation.mitigationId}`)}
        <article class="mitigation-card" data-mitigation-id={mitigation.mitigationId}>
          <header class="mitigation-header">
            <div class="mitigation-title">
              <p class="relationship-label">This control <strong>{mitigation.relationship}</strong></p>
              {#if mitigation.mitigationUrl}
                <a href={mitigation.mitigationUrl} target="_blank" rel="noopener noreferrer">
                  {mitigation.mitigationName} ({mitigation.mitigationId})<span class="sr-only"> on MITRE ATT&amp;CK</span><span aria-hidden="true"> ↗</span>
                </a>
              {:else}
                <h3>{mitigation.mitigationName} ({mitigation.mitigationId})</h3>
              {/if}
            </div>
            <div class="mapping-meta" aria-label="Reviewed mapping classification">
              <span class="function-chip" data-function={mitigation.securityFunction}>{mitigation.securityFunction}</span>
              <span class="confidence-chip" data-confidence={mitigation.confidence}>{mitigation.confidence} mapping confidence</span>
            </div>
          </header>
          {#if mitigation.mitigationDescription}<p class="mitigation-description">{mitigation.mitigationDescription}</p>{/if}
          <div class="review-basis">
            <p>{mitigation.rationale}</p>
            {#if mitigation.evidenceNotes.length > 0}
              <div class="evidence">
                <strong>Review evidence</strong>
                {#each mitigation.evidenceNotes as note}<p>{note}</p>{/each}
              </div>
            {/if}
          </div>

          <details class="technique-disclosure" data-mitigation-id={mitigation.mitigationId}>
            <summary aria-label={`Official ATT&CK techniques (showing ${expandedMitigations[mitigationKey(mitigation.candidateId, mitigation.mitigationId)] ? mitigation.techniques.length : Math.min(INITIAL_TECHNIQUE_LIMIT, mitigation.techniques.length)} of ${mitigation.techniques.length})`}>
              <span>Official ATT&amp;CK techniques</span>
              <span class="item-count">
                showing {expandedMitigations[mitigationKey(mitigation.candidateId, mitigation.mitigationId)]
                  ? mitigation.techniques.length
                  : Math.min(INITIAL_TECHNIQUE_LIMIT, mitigation.techniques.length)} of {mitigation.techniques.length}
              </span>
            </summary>
            <div class="technique-list">
              {#each (expandedMitigations[mitigationKey(mitigation.candidateId, mitigation.mitigationId)]
                ? mitigation.techniques
                : mitigation.techniques.slice(0, INITIAL_TECHNIQUE_LIMIT)) as technique (technique.techniqueId)}
                <article class="technique-card" data-technique-id={technique.techniqueId}>
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
                    <div class="badge-row">
                      {#each technique.tactics as tactic}<span class="tactic-badge">{formatAttackLabel(tactic)}</span>{/each}
                      {#each technique.platforms as platform}<span class="platform-badge">{platform}</span>{/each}
                    </div>
                  </header>

                  <div class="relationship-list" aria-label={`MITRE guidance for ${technique.techniqueName}`}>
                    {#each technique.relationships as relationship (relationship.relationshipStixId)}
                      <div class="official-relationship">
                        <strong>MITRE mitigation guidance</strong>
                        <p>{relationship.description ?? "MITRE does not provide a description for this official mitigation relationship."}</p>
                      </div>
                    {/each}
                  </div>

                  <details class="procedure-disclosure" data-technique-id={technique.techniqueId}>
                    <summary aria-label={`Reported procedure examples (${technique.procedures.returned} of ${technique.procedures.total})`}>
                      <span>Reported procedure examples</span>
                      <span class="item-count">{technique.procedures.returned} of {technique.procedures.total}</span>
                    </summary>
                    <div class="procedure-content">
                      <p class="procedure-disclaimer">
                        These examples describe ATT&amp;CK-reported use of this technique. They do not mean this mapped ISM control defeats or covers the named group, campaign, malware, or tool.
                      </p>
                      {#if technique.procedures.examples.length === 0}
                        <p class="procedure-empty">No reported procedure examples are retained for this technique in the pinned ATT&amp;CK release.</p>
                      {:else}
                        <div class="procedure-examples">
                          {#each technique.procedures.examples as example (example.relationshipStixId)}
                            <article class="procedure-example">
                              <header>
                                <span class="entity-type">{formatAttackLabel(example.entityType)}</span>
                                {#if example.entityUrl && safeMitreUrl(example.entityUrl)}
                                  <a href={safeMitreUrl(example.entityUrl) ?? undefined} target="_blank" rel="noopener noreferrer">
                                    {example.entityName}{#if example.entityExternalId} ({example.entityExternalId}){/if}<span class="sr-only"> on MITRE ATT&amp;CK</span><span aria-hidden="true"> ↗</span>
                                  </a>
                                {:else}
                                  <strong>{example.entityName}{#if example.entityExternalId} ({example.entityExternalId}){/if}</strong>
                                {/if}
                              </header>
                              <p>{example.description}</p>
                              {#if example.references.length > 0}
                                <div class="procedure-references" aria-label={`Sources for ${example.entityName}`}>
                                  <span>Sources</span>
                                  {#each example.references as reference, index (`${reference.sourceName}-${reference.externalId ?? ""}-${index}`)}
                                    {#if safeSourceUrl(reference.url)}
                                      <a href={safeSourceUrl(reference.url) ?? undefined} target="_blank" rel="noopener noreferrer">
                                        {procedureReferenceLabel(reference)}<span class="sr-only">, source link</span><span aria-hidden="true"> ↗</span>
                                      </a>
                                    {:else}
                                      <span class="reference-label">{procedureReferenceLabel(reference)}</span>
                                    {/if}
                                  {/each}
                                </div>
                              {/if}
                            </article>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </details>
                </article>
              {/each}
              {#if mitigation.techniques.length > INITIAL_TECHNIQUE_LIMIT}
                <button
                  class="technique-toggle"
                  type="button"
                  aria-expanded={expandedMitigations[mitigationKey(mitigation.candidateId, mitigation.mitigationId)] ?? false}
                  onclick={() => {
                    const key = mitigationKey(mitigation.candidateId, mitigation.mitigationId);
                    expandedMitigations[key] = !expandedMitigations[key];
                  }}
                >
                  {expandedMitigations[mitigationKey(mitigation.candidateId, mitigation.mitigationId)]
                    ? "Show the first 12 techniques"
                    : `Show all ${mitigation.techniques.length} techniques`}
                </button>
              {/if}
            </div>
          </details>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .attack-panel { padding-bottom: 28px; }
  .attack-intro, .mitigation-header, .technique-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .eyebrow, .relationship-label { margin: 0 0 4px; color: var(--accent-text); font-size: 10px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
  h2 { margin: 0; color: var(--text); font-size: 20px; letter-spacing: -0.02em; }
  .version-row, .mapping-meta, .badge-row, .procedure-references { display: flex; flex-wrap: wrap; gap: 5px; }
  .version-row { justify-content: flex-end; }
  .version-row span, .function-chip, .confidence-chip, .tactic-badge, .platform-badge { padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; font-size: 9px; font-weight: 650; }
  .version-row span { border-color: var(--accent-border); border-radius: 5px; background: var(--accent-bg); color: var(--accent-text); font-family: var(--font-mono); }
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
  .mitigation-list { display: grid; gap: 12px; }
  .mitigation-card { overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
  .mitigation-header { padding: 15px 16px 9px; }
  .mitigation-title { min-width: 0; }
  .mitigation-title a, .mitigation-title h3 { margin: 0; color: var(--text); font-size: 15px; font-weight: 700; overflow-wrap: anywhere; text-decoration: none; }
  .mitigation-title a:hover, a.technique-id:hover { text-decoration: underline; }
  .mapping-meta { justify-content: flex-end; }
  .function-chip { border-color: var(--accent-border); background: var(--accent-bg); color: var(--accent-text); text-transform: capitalize; }
  .function-chip[data-function="detect"] { border-color: var(--purple-border); background: var(--purple-bg); color: var(--purple); }
  .function-chip[data-function="recover"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .confidence-chip { color: var(--text-dim); text-transform: capitalize; }
  .confidence-chip[data-confidence="high"] { border-color: var(--green-border); background: var(--green-bg); color: var(--green); }
  .mitigation-description, .review-basis > p { margin: 0; padding: 0 16px 11px; color: var(--text-mid); font-size: 12px; line-height: 1.55; }
  .review-basis { border-top: 1px solid var(--border); padding-top: 11px; background: var(--bg-subtle); }
  .evidence { margin: 0 16px 12px; padding-top: 9px; border-top: 1px dashed var(--border); }
  .evidence strong, .official-relationship strong { color: var(--text-dim); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; }
  .evidence p { margin: 4px 0 0; color: var(--text-dim); font-size: 11px; line-height: 1.55; }
  .technique-disclosure { border-top: 1px solid var(--border-strong); }
  details > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; color: var(--text); font-size: 12px; font-weight: 650; cursor: pointer; list-style-position: inside; }
  details > summary:hover { background: var(--bg-subtle); }
  details > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .item-count { flex: 0 0 auto; color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; font-weight: 600; }
  .technique-list { display: grid; max-height: 42rem; gap: 9px; overflow-y: auto; padding: 0 12px 12px; }
  .technique-card { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); }
  .technique-toggle { width: 100%; padding: 10px 12px; border: 1px solid var(--accent-border); border-radius: 7px; background: var(--accent-bg); color: var(--accent-text); font: inherit; font-size: 11px; font-weight: 650; cursor: pointer; }
  .technique-toggle:hover { border-color: var(--accent); }
  .technique-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .technique-header { padding: 12px; }
  .technique-title { min-width: 0; }
  .technique-id { color: var(--accent-text); font-family: var(--font-mono); font-size: 11px; font-weight: 650; text-decoration: none; }
  .technique-title h4 { margin: 3px 0 0; color: var(--text); font-size: 14px; }
  .badge-row { justify-content: flex-end; }
  .tactic-badge { border-color: var(--accent-border); color: var(--accent-text); }
  .platform-badge { color: var(--text-dim); }
  .relationship-list { border-top: 1px solid var(--border); }
  .official-relationship { padding: 11px 12px; background: var(--bg-subtle); }
  .official-relationship + .official-relationship { border-top: 1px solid var(--border); }
  .official-relationship p { margin: 5px 0 0; color: var(--text-mid); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .procedure-disclosure { border-top: 1px solid var(--border-strong); }
  .procedure-content { padding: 0 12px 12px; }
  .procedure-disclaimer, .procedure-empty { margin: 0; padding: 10px 12px; border-left: 3px solid var(--amber); background: var(--amber-bg); color: var(--text-mid); font-size: 11px; line-height: 1.55; }
  .procedure-empty { margin-top: 10px; border-left-color: var(--border-strong); background: var(--bg-subtle); color: var(--text-dim); }
  .procedure-examples { display: grid; max-height: 28rem; gap: 8px; overflow-y: auto; margin-top: 10px; padding-right: 3px; }
  .procedure-example { min-width: 0; padding: 11px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-subtle); }
  .procedure-example header { display: flex; min-width: 0; flex-wrap: wrap; align-items: baseline; gap: 7px; }
  .procedure-example header a, .procedure-example header strong { min-width: 0; color: var(--text); font-size: 12px; overflow-wrap: anywhere; text-decoration: none; }
  .procedure-example header a:hover { text-decoration: underline; }
  .entity-type { padding: 2px 6px; border: 1px solid var(--accent-border); border-radius: 999px; color: var(--accent-text); font-size: 8px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
  .procedure-example > p { margin: 8px 0 0; color: var(--text-mid); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
  .procedure-references { min-width: 0; align-items: center; margin-top: 9px; }
  .procedure-references > span:first-child { color: var(--text-dim); font-size: 8px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; }
  .procedure-references a, .reference-label { max-width: 100%; padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-dim); font-size: 9px; overflow-wrap: anywhere; text-decoration: none; }
  .procedure-references a:hover { border-color: var(--accent-border); color: var(--accent-text); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; margin: -1px; padding: 0; border: 0; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 720px) {
    .attack-intro, .mitigation-header, .technique-header { flex-direction: column; }
    .version-row, .mapping-meta, .badge-row { justify-content: flex-start; }
    .tactic-cell { min-width: 64px; flex-basis: 64px; }
    .technique-list { max-height: 34rem; padding-right: 8px; padding-left: 8px; }
    details > summary { align-items: flex-start; }
    .procedure-examples { max-height: 22rem; }
  }
</style>
