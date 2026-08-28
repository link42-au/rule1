<svelte:head>
  <title>Privacy — rule1</title>
  <meta name="description" content="How the standalone Rule1 application uses browser-local storage without accounts, analytics, or an application backend." />
  <meta property="og:title" content="Privacy — rule1" />
  <meta property="og:description" content="How the standalone Rule1 application uses browser-local storage without accounts, analytics, or an application backend." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://rule1.link42.app/privacy/" />
  <meta property="og:site_name" content="rule1" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Privacy — rule1" />
  <meta name="twitter:description" content="How the standalone Rule1 application uses browser-local storage without accounts, analytics, or an application backend." />
  <link rel="canonical" href="https://rule1.link42.app/privacy/" />
</svelte:head>

<div class="cl-main privacy-page">
  <h1 class="cl-title">Privacy</h1>
  <p class="cl-sub">Rule1 is a static, browser-local application.</p>
  <section class="lic-section"><span class="lic-tag">Application data</span><h2>What Rule1 processes</h2><p>Your browser downloads the public application files and SQLite catalogue from the static host. Catalogue searches, comparisons, and control queries run locally in a browser worker. Rule1 has no application backend receiving those queries.</p></section>
  <section class="lic-section"><span class="lic-tag">Browser storage</span><h2>Local preferences, favourites, and cache</h2><p>Theme preference and favourites are stored locally in your browser. Favourites can be imported from or exported to a local file without sending them to Rule1. The catalogue may also be cached in browser storage to avoid downloading the same checked snapshot again. Clearing Rule1 site data removes these locally stored preferences, favourites, and cached catalogue copies.</p></section>
  <section class="lic-section"><span class="lic-tag">Excluded services</span><h2>No accounts or community writes</h2><p>This standalone version does not use Rule1 authentication, account cookies, comments, votes, analytics, bypass tokens, or a runtime API. The static hosting provider may retain ordinary request logs under its own policies.</p></section>
</div>

<style>
  .privacy-page { display: block; width: 100%; max-width: 640px; min-height: 0; margin: 0 auto; padding: 48px 24px 64px; }
  .lic-section { margin-top: 40px; padding-bottom: 36px; border-bottom: 1px solid var(--border); }
  .lic-section:last-of-type { border-bottom: 0; }
  .lic-tag { display: inline-block; margin-bottom: 10px; padding: 3px 9px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-subtle); color: var(--text-dim); font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  h2 { margin: 0 0 14px; color: var(--text); font-size: 16px; letter-spacing: -0.02em; }
  p { margin: 0; color: var(--text-mid); font-size: 13px; line-height: 1.7; }

  @media (max-width: 640px) {
    .privacy-page { padding: 32px 16px 48px; }
    .lic-section { margin-top: 32px; padding-bottom: 28px; }
  }
</style>
