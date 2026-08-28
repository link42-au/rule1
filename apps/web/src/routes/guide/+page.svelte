<script lang="ts">
  import { base } from "$app/paths";
</script>

<svelte:head>
  <title>Guide — rule1</title>
  <meta name="description" content="Learn how to explore and compare the security framework history retained by the standalone Rule1 catalogue." />
  <meta property="og:title" content="Guide — rule1" />
  <meta property="og:description" content="Learn how to explore and compare the security framework history retained by the standalone Rule1 catalogue." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://rule1.link42.app/guide/" />
  <meta property="og:site_name" content="rule1" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Guide — rule1" />
  <meta name="twitter:description" content="Learn how to explore and compare the security framework history retained by the standalone Rule1 catalogue." />
  <link rel="canonical" href="https://rule1.link42.app/guide/" />
</svelte:head>

<div class="cl-main guide-page">
  <h1 class="cl-title">Rule1 guide</h1>
  <p class="cl-sub">How to use the standalone security-controls catalogue.</p>

  <section class="lic-section"><span class="lic-tag">Explore</span><h2>Browse retained frameworks</h2><p>Use the <a href={`${base}/explorer/`}>Explorer</a> to switch between the Australian ISM, New Zealand ISM, Cyber Essentials, NIST Cybersecurity Framework, and NIST SP 800-53. Search and filters apply to the current framework. Selecting a control exposes its retained version history and same-section relationships.</p></section>
  <section class="lic-section"><span class="lic-tag">Compare</span><h2>Review catalogue changes</h2><p>The <a href={`${base}/compare/`}>comparison view</a> shows controls added, modified, or withdrawn between two retained versions. CSV export contains only the rows visible after filtering.</p></section>
  <section class="lic-section"><span class="lic-tag">Local data</span><h2>No operated Rule1 backend</h2><p>Rule1 downloads a checked SQLite snapshot and queries it inside your browser. It does not provide a runtime API, account system, community service, or bypass tokens. GitHub Actions rebuilds the snapshot from framework source files retained in this repository.</p></section>
  <section class="lic-section"><span class="lic-tag">Interpretation</span><h2>Verify authoritative sources</h2><p>Rule1 is a navigation and change-review aid, not compliance advice. Source provenance is retained with the database, but decisions should be checked against the relevant publisher’s authoritative framework. Named Essential Eight strategies and glossary entries are absent where the archived source does not provide them.</p></section>
  <section class="lic-section"><span class="lic-tag">Licensing</span><h2>Code and source material</h2><p>Rule1 code and project-authored documentation are licensed under the <a href="https://github.com/link42-au/rule1/blob/main/LICENSE">GNU Affero General Public License v3.0 or later</a>. Framework source documents and data retained under <code>data/</code> remain subject to their publishers’ or source repositories’ terms and are not relicensed by Rule1.</p></section>
</div>

<style>
  .guide-page { display: block; width: 100%; max-width: 640px; min-height: 0; margin: 0 auto; padding: 48px 24px 64px; }
  .lic-section { margin-top: 40px; padding-bottom: 36px; border-bottom: 1px solid var(--border); }
  .lic-section:last-of-type { border-bottom: 0; }
  .lic-tag { display: inline-block; margin-bottom: 10px; padding: 3px 9px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-subtle); color: var(--text-dim); font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  h2 { margin: 0 0 14px; color: var(--text); font-size: 16px; letter-spacing: -0.02em; }
  p { margin: 0; color: var(--text-mid); font-size: 13px; line-height: 1.7; }
  a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

  @media (max-width: 640px) {
    .guide-page { padding: 32px 16px 48px; }
    .lic-section { margin-top: 32px; padding-bottom: 28px; }
  }
</style>
