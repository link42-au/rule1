<script lang="ts">
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { Footer, Header, PlatformBar, Toast, theme } from "@link42/ui";
  import "@link42/tokens";
  import "@link42/ui/patterns.css";
  import "@link42/ui/components.css";
  import { onMount } from "svelte";
  import DatabaseLoadingSplash from "$lib/DatabaseLoadingSplash.svelte";
  import "../brand.css";

  let { children } = $props();

  const appPath = (path: string): string => `${base}${path}`;
  const navItems = [
    { href: appPath("/explorer/"), label: "Explorer" },
    { href: appPath("/compare/"), label: "Compare" },
    { href: appPath("/glossary/"), label: "Glossary" },
    { href: appPath("/guide/"), label: "Guide" },
  ];
  const catalogueRouteIds = new Set(["/", "/explorer", "/compare", "/glossary"]);
  const catalogueBackedRoute = $derived(page.route.id !== null && catalogueRouteIds.has(page.route.id));

  function searchControls(query: string): void {
    const params = page.url.pathname === appPath("/explorer/") ? new URLSearchParams(page.url.searchParams) : new URLSearchParams();
    params.delete("search");
    params.delete("id");
    params.delete("tab");
    if (query) params.set("search", query);
    goto(`${appPath("/explorer/")}${params.size > 0 ? `?${params}` : ""}`);
  }

  onMount(() => theme.init());
</script>

<a href="#main-content" class="skip-link">Skip to content</a>

<PlatformBar
  currentApp="rule1"
  currentAppHref={appPath("/")}
  hideAuth
  theme={theme.value}
  onToggleTheme={() => theme.toggle()}
/>

<Header
  {navItems}
  activePath={page.url.pathname}
  search={{ placeholder: "Search controls…", onSubmit: searchControls }}
/>

<main id="main-content">{@render children()}</main>

<Footer appName="rule1" excludeApps={["rule1", "login2", "threat10", "patch8", "peer6"]} />
<Toast />
<DatabaseLoadingSplash initiallyVisible={catalogueBackedRoute} routeKey={page.route.id ?? page.url.pathname} />

<style>
  .skip-link {
    position: absolute;
    top: -100%;
    left: 0;
    z-index: 300;
    padding: 0.5rem 1rem;
    border-radius: 0 0 6px 0;
    background: var(--accent);
    color: white;
    font-size: 13px;
    text-decoration: none;
  }

  .skip-link:focus {
    top: 0;
  }
</style>
