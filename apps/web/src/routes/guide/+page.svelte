<script lang="ts">
  import { base } from "$app/paths";
</script>

<svelte:head><title>Guide — rule1</title></svelte:head>

<div class="cl-main guide-page">
  <h1 class="cl-title">Rule1 guide</h1>
  <p class="cl-sub">How to use the standalone security-controls catalogue.</p>

  <section><span>Explore</span><h2>Browse retained frameworks</h2><p>Use the <a href={`${base}/explorer/`}>Explorer</a> to switch between the Australian ISM, New Zealand ISM, Cyber Essentials, NIST Cybersecurity Framework, and NIST SP 800-53. Search and filters apply to the current framework. Selecting a control exposes its retained version history and same-section relationships.</p></section>
  <section><span>Compare</span><h2>Review catalogue changes</h2><p>The <a href={`${base}/compare/`}>comparison view</a> shows controls added, modified, or withdrawn between two retained versions. CSV export contains only the rows visible after filtering.</p></section>
  <section><span>Local data</span><h2>No operated Rule1 backend</h2><p>Rule1 downloads a checked SQLite snapshot and queries it inside your browser. It does not provide a runtime API, account system, community service, or bypass tokens. GitHub Actions rebuilds the snapshot from framework source files retained in this repository.</p></section>
  <section><span>Interpretation</span><h2>Verify authoritative sources</h2><p>Rule1 is a navigation and change-review aid, not compliance advice. Source provenance is retained with the database, but decisions should be checked against the relevant publisher’s authoritative framework. Named Essential Eight strategies and glossary entries are absent where the archived source does not provide them.</p></section>
  <section><span>Licensing</span><h2>Code and source material</h2><p>The application’s licence is distributed with its public repository when published. Framework documents remain subject to their publishers’ terms and are included with provenance; Rule1 does not claim ownership of them.</p></section>
</div>

<style>
  .guide-page { display: block; width: min(900px, calc(100% - 48px)); margin: 0 auto; }
  section { margin-top: 18px; padding: 20px 22px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
  section > span { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  h2 { margin: 5px 0 9px; color: var(--text); font-size: 17px; }
  p { margin: 0; color: var(--text-mid); font-size: 13.5px; line-height: 1.7; }
</style>
