<svelte:head><title>Privacy — rule1</title></svelte:head>

<div class="cl-main privacy-page">
  <h1 class="cl-title">Privacy</h1>
  <p class="cl-sub">Rule1 is a static, browser-local application.</p>
  <section><span>Application data</span><h2>What Rule1 processes</h2><p>Your browser downloads the public application files and SQLite catalogue from the static host. Catalogue searches, comparisons, and control queries run locally in a browser worker. Rule1 has no application backend receiving those queries.</p></section>
  <section><span>Browser storage</span><h2>Local preferences and cache</h2><p>Theme preference is stored locally when available. The catalogue may be cached in browser storage to avoid downloading the same checked snapshot again. Clearing site data removes these copies. Browser-local favourites are not part of the current release.</p></section>
  <section><span>Excluded services</span><h2>No accounts or community writes</h2><p>This standalone version does not use Rule1 authentication, account cookies, comments, votes, analytics, bypass tokens, or a runtime API. The static hosting provider may retain ordinary request logs under its own policies.</p></section>
</div>

<style>
  .privacy-page { display: block; width: min(850px, calc(100% - 48px)); margin: 0 auto; }
  section { margin-top: 18px; padding: 20px 22px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
  section > span { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  h2 { margin: 5px 0 9px; color: var(--text); font-size: 17px; }
  p { margin: 0; color: var(--text-mid); font-size: 13.5px; line-height: 1.7; }
</style>
