<script lang="ts">
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import type { Framework } from "@rule1/shared";
  import { theme } from "@link42/ui";
  import { onMount } from "svelte";
  import type { Rule1DataClient } from "$lib/db/contracts";
  import { canonicalFrameworkId } from "$lib/db/contracts";
  import { openRule1DataClient } from "$lib/db/rpc";

  type CatalogueState =
    | { status: "loading" }
    | { status: "ready"; frameworks: Framework[]; controlCount: number | null }
    | { status: "unavailable"; message: string };

  const siteName = "rule1";

  let catalogue = $state<CatalogueState>({
    status: "loading",
  });
  let searchValue = $state("");
  let curFramework = $state("ism");
  let dataClient: Rule1DataClient | null = null;

  let logoSrc = $derived(`${base}/${theme.value === "dark" ? "logo-dark.svg" : "logo-light.svg"}`);
  let frameworks = $derived(catalogue.status === "ready" ? catalogue.frameworks : []);
  let controlCount = $derived(catalogue.status === "ready" ? catalogue.controlCount : null);
  let catalogueAvailable = $derived(catalogue.status === "ready");
  let isISM = $derived(curFramework === "ism");

  onMount(() => {
    let mounted = true;
    let closeClient: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        const opened = await openRule1DataClient(base, window.location.href);
        if (!mounted) {
          await opened.close();
          return;
        }

        dataClient = opened.client;
        closeClient = opened.close;
        const availableFrameworks = await opened.client.frameworks();
        const initialFramework = availableFrameworks.some((framework) => framework.id === "ism")
          ? "ism"
          : availableFrameworks[0]?.id;
        if (!initialFramework) throw new Error("The local catalogue contains no frameworks.");

        const framework = canonicalFrameworkId(initialFramework);
        const stats = await opened.client.stats({ framework });
        if (!mounted) return;

        curFramework = framework;
        catalogue = { status: "ready", frameworks: availableFrameworks, controlCount: stats.controls };
      } catch {
        if (mounted) {
          dataClient = null;
          catalogue = {
            status: "unavailable",
            message: "Could not load the local catalogue. Reload to try again.",
          };
        }
      }
    })();

    return () => {
      mounted = false;
      dataClient = null;
      if (closeClient) void closeClient();
    };
  });

  function appHref(path: string): string {
    return `${base}${path}`;
  }

  function fwParam(framework: string): string {
    return framework === "ism" ? "" : `&framework=${framework}`;
  }

  async function selectFramework(frameworkId: string): Promise<void> {
    if (catalogue.status !== "ready" || !dataClient) return;

    const framework = canonicalFrameworkId(frameworkId);
    const availableFrameworks = catalogue.frameworks;
    curFramework = framework;
    catalogue = { status: "ready", frameworks: availableFrameworks, controlCount: null };

    try {
      const stats = await dataClient.stats({ framework });
      if (curFramework === framework && catalogue.status === "ready") {
        catalogue = { status: "ready", frameworks: availableFrameworks, controlCount: stats.controls };
      }
    } catch {
      if (curFramework === framework) {
        catalogue = {
          status: "unavailable",
          message: "Could not load the selected framework. Reload to try again.",
        };
      }
    }
  }

  function handleSearch(event: SubmitEvent): void {
    event.preventDefault();
    if (!catalogueAvailable) return;

    const query = searchValue.trim();
    const framework = curFramework !== "ism" ? `framework=${curFramework}` : "";
    const params = [query ? `search=${encodeURIComponent(query)}` : "", framework].filter(Boolean).join("&");
    goto(appHref(`/explorer${params ? `?${params}` : ""}`));
  }

  function blockUnavailableAction(event: MouseEvent): void {
    if (!catalogueAvailable) event.preventDefault();
  }
</script>

<svelte:head>
  <title>{siteName}</title>
  <meta
    name="description"
    content="Explore Australian ISM security controls, Essential Eight strategies, and IRAP assessment guidance. Search, filter, and compare controls across framework versions."
  />
  <meta property="og:title" content={siteName} />
  <meta
    property="og:description"
    content="Explore Australian ISM security controls, Essential Eight strategies, and IRAP assessment guidance. Search, filter, and compare controls across framework versions."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://wan0.net/rule1/" />
  <meta property="og:site_name" content="Rule1" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content={siteName} />
  <meta
    name="twitter:description"
    content="Explore Australian ISM security controls, Essential Eight strategies, and IRAP assessment guidance. Search, filter, and compare controls across framework versions."
  />
  <link rel="canonical" href="https://wan0.net/rule1/" />
</svelte:head>

<div class="landing">
  <div class="landing-logo">
    <img src={logoSrc} alt={siteName} />
  </div>

  <h1 class="landing-title">{siteName}</h1>
  <p class="landing-tagline">security controls, explored</p>
  <p class="landing-description">
    Browse and search security controls across frameworks — explore control history, track changes across catalog versions,
    and navigate section relationships.
  </p>

  {#if catalogue.status === "loading"}
    <p class="catalogue-status" aria-live="polite">Loading local catalogue…</p>
  {:else if catalogue.status === "unavailable"}
    <p class="catalogue-status catalogue-status--unavailable" role="status">{catalogue.message}</p>
  {:else if frameworks.length > 1}
    <div class="landing-fw-bar" role="group" aria-label="Security framework">
      {#each frameworks as framework}
        <button
          class="landing-fw-pill"
          class:active={curFramework === framework.id}
          aria-pressed={curFramework === framework.id}
          onclick={() => void selectFramework(framework.id)}
          title={framework.name}
        >
          {framework.short_name}
          {#if framework.country}
            <span class="landing-fw-country">{framework.country}</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if controlCount !== null}
      <p class="landing-fw-count">{controlCount} controls</p>
    {/if}
  {/if}

  <form class="landing-search-form" onsubmit={handleSearch}>
    <label for="landing-search" class="sr-only">Search controls</label>
    <input
      id="landing-search"
      type="text"
      class="landing-search-input"
      placeholder="Search controls… e.g. multi-factor, patch management"
      autocomplete="off"
      disabled={!catalogueAvailable}
      bind:value={searchValue}
    />
    <button type="submit" class="landing-search-btn" disabled={!catalogueAvailable}>Search</button>
  </form>

  <div class="landing-filters">
    <a
      class="landing-filter-pill lf-changed"
      class:is-unavailable={!catalogueAvailable}
      href={catalogueAvailable ? appHref(`/explorer?filter=changed${fwParam(curFramework)}`) : undefined}
      aria-disabled={!catalogueAvailable}
      onclick={blockUnavailableAction}>Changed</a
    >
    <a
      class="landing-filter-pill lf-new"
      class:is-unavailable={!catalogueAvailable}
      href={catalogueAvailable ? appHref(`/explorer?filter=new${fwParam(curFramework)}`) : undefined}
      aria-disabled={!catalogueAvailable}
      onclick={blockUnavailableAction}>New</a
    >
    <a
      class="landing-filter-pill lf-withdrawn"
      class:is-unavailable={!catalogueAvailable}
      href={catalogueAvailable ? appHref(`/explorer?filter=withdrawn${fwParam(curFramework)}`) : undefined}
      aria-disabled={!catalogueAvailable}
      onclick={blockUnavailableAction}>Withdrawn</a
    >
  </div>

  {#if isISM}
    <div class="landing-filter-group-label">Essential 8</div>
    <div class="landing-filters">
      {#each ["ml1", "ml2", "ml3"] as maturityLevel}
        <a
          class="landing-filter-pill lf-ml"
          class:is-unavailable={!catalogueAvailable}
          href={catalogueAvailable ? appHref(`/explorer?filter=${maturityLevel}`) : undefined}
          aria-disabled={!catalogueAvailable}
          onclick={blockUnavailableAction}>{maturityLevel.toUpperCase()}</a
        >
      {/each}
    </div>

    <div class="landing-filter-group-label">Data Classification</div>
    <div class="landing-filters landing-filters-applic">
      <a class="landing-filter-pill lf-nc" class:is-unavailable={!catalogueAvailable} href={catalogueAvailable ? appHref("/explorer?applicability=NC") : undefined} aria-disabled={!catalogueAvailable} onclick={blockUnavailableAction}>Not Classified</a>
      <a class="landing-filter-pill lf-os" class:is-unavailable={!catalogueAvailable} href={catalogueAvailable ? appHref("/explorer?applicability=OS") : undefined} aria-disabled={!catalogueAvailable} onclick={blockUnavailableAction}>OFFICIAL:Sensitive</a>
      <a class="landing-filter-pill lf-p" class:is-unavailable={!catalogueAvailable} href={catalogueAvailable ? appHref("/explorer?applicability=P") : undefined} aria-disabled={!catalogueAvailable} onclick={blockUnavailableAction}>Protected</a>
      <a class="landing-filter-pill lf-c" class:is-unavailable={!catalogueAvailable} href={catalogueAvailable ? appHref("/explorer?applicability=C") : undefined} aria-disabled={!catalogueAvailable} onclick={blockUnavailableAction}>Confidential</a>
      <a class="landing-filter-pill lf-s" class:is-unavailable={!catalogueAvailable} href={catalogueAvailable ? appHref("/explorer?applicability=S") : undefined} aria-disabled={!catalogueAvailable} onclick={blockUnavailableAction}>Secret</a>
      <a class="landing-filter-pill lf-ts" class:is-unavailable={!catalogueAvailable} href={catalogueAvailable ? appHref("/explorer?applicability=TS") : undefined} aria-disabled={!catalogueAvailable} onclick={blockUnavailableAction}>Top Secret</a>
    </div>
  {/if}

  <a
    class="landing-browse"
    class:is-unavailable={!catalogueAvailable}
    href={catalogueAvailable
      ? appHref(`/explorer${curFramework !== "ism" ? `?framework=${curFramework}` : ""}`)
      : undefined}
    aria-disabled={!catalogueAvailable}
    onclick={blockUnavailableAction}>Browse all controls &rarr;</a
  >
</div>

<style>
  :global(body) {
    display: flex;
    flex-direction: column;
  }

  .landing {
    flex: 1;
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    gap: 0;
  }

  .landing-logo {
    width: 200px;
    height: 200px;
  }

  .landing-logo img {
    width: 100%;
    height: 100%;
  }

  .landing-title {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.04em;
    color: var(--text);
    margin-bottom: 8px;
    text-align: center;
  }

  .landing-tagline {
    font-size: 15px;
    color: var(--text-mid);
    margin-bottom: 12px;
    text-align: center;
    max-width: 380px;
    line-height: 1.5;
  }

  .landing-description {
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 24px;
    text-align: center;
    max-width: 480px;
    line-height: 1.65;
  }

  .catalogue-status {
    min-height: 20px;
    margin-bottom: 12px;
    color: var(--text-dim);
    font-family: "Geist Mono", ui-monospace, monospace;
    font-size: 11px;
    text-align: center;
  }

  .catalogue-status--unavailable {
    max-width: 480px;
  }

  .landing-search-form {
    display: flex;
    gap: 8px;
    width: 100%;
    max-width: 480px;
    margin-bottom: 20px;
  }

  .landing-search-input {
    flex: 1;
    min-width: 0;
    padding: 10px 16px;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 10px;
    font-family: inherit;
    font-size: 14px;
    color: var(--text);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .landing-search-input::placeholder {
    color: var(--text-dim);
  }

  .landing-search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }

  .landing-search-btn {
    padding: 10px 20px;
    background: var(--text);
    color: var(--text-inv);
    border: none;
    border-radius: 10px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .landing-search-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .landing-filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 6px;
  }

  .landing-filter-group-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin: 6px 0 8px;
    text-align: center;
  }

  .landing-filter-pill {
    display: inline-flex;
    align-items: center;
    padding: 5px 14px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text-mid);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    cursor: pointer;
  }

  .landing-filter-pill:hover {
    filter: brightness(0.92);
  }

  .is-unavailable {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .lf-ml {
    background: var(--purple-bg);
    border-color: var(--purple-border);
    color: var(--purple);
  }

  .landing-filters-applic {
    margin-bottom: 24px;
  }

  .landing-filters-applic .landing-filter-pill {
    border-radius: 5px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .lf-nc {
    background: #ffffff;
    border-color: #c8c8c8;
    color: #1a1a1a;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .lf-os {
    background: #6b7280;
    border-color: #4b5563;
    color: #ffffff;
  }

  .lf-p {
    background: #1d4ed8;
    border-color: #1e40af;
    color: #ffffff;
  }

  .lf-c {
    background: #16a34a;
    border-color: #15803d;
    color: #ffffff;
  }

  .lf-s {
    background: #db2777;
    border-color: #be185d;
    color: #ffffff;
  }

  .lf-ts {
    background: #dc2626;
    border-color: #b91c1c;
    color: #ffffff;
  }

  .landing-browse {
    font-size: 13px;
    color: var(--text-dim);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: color 0.12s;
  }

  .landing-browse:hover {
    color: var(--accent);
  }

  .landing-fw-bar {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .landing-fw-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text-mid);
    cursor: pointer;
    transition: all 0.15s;
  }

  .landing-fw-pill:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .landing-fw-pill.active {
    background: var(--accent-solid);
    color: var(--accent-solid-text);
    border-color: var(--accent-solid);
  }

  .landing-fw-country {
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.03em;
  }

  .landing-fw-pill.active .landing-fw-country {
    color: var(--accent-solid-text);
  }

  .landing-fw-count {
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 20px;
    text-align: center;
  }

  @media (max-width: 640px) {
    .landing {
      justify-content: flex-start;
      padding: 28px 16px 36px;
    }

    .landing-logo {
      width: 150px;
      height: 150px;
    }

    .landing-title {
      font-size: 28px;
    }

    .landing-description,
    .catalogue-status--unavailable {
      max-width: 100%;
    }

    .landing-fw-pill {
      padding: 6px 10px;
      font-size: 12px;
    }

    .landing-search-form {
      max-width: 100%;
    }
  }

  @media (max-width: 420px) {
    .landing-search-form {
      gap: 6px;
    }

    .landing-search-input {
      padding-inline: 12px;
    }

    .landing-search-btn {
      padding-inline: 14px;
    }
  }
</style>
