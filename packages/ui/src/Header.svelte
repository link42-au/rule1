<script lang="ts">
interface NavItem {
	href: string;
	label: string;
	badge?: number;
	group?: string;
}

interface SearchConfig {
	placeholder: string;
	onSubmit: (query: string) => void;
	onInput?: (query: string) => void;
	value?: string;
}

interface Props {
	appName?: string;
	navItems: NavItem[];
	activePath?: string;
	search?: SearchConfig;
	children?: import("svelte").Snippet;
}

let { appName, navItems, activePath, search, children }: Props = $props();

let mobileMenuOpen = $state(false);
let searchQuery = $state("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;

$effect(() => {
	const value = search?.value;
	if (value !== undefined) searchQuery = value;
});

$effect(() => () => clearTimeout(searchTimer));

function toggleMobileMenu() {
	mobileMenuOpen = !mobileMenuOpen;
}

function closeMobileMenu() {
	mobileMenuOpen = false;
}

function handleSearchSubmit(e: Event) {
	e.preventDefault();
	if (!search) return;
	clearTimeout(searchTimer);
	search.onSubmit(searchQuery.trim());
}

function handleSearchInput(event: Event) {
	searchQuery = (event.currentTarget as HTMLInputElement).value;
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => search?.onInput?.(searchQuery.trim()), 250);
}
</script>

<header class="header">
  <div class="header-container">
    <div class="header-left">
      <nav class="nav-desktop">
        {#each navItems as item, i}
          {#if item.group && (i === 0 || navItems[i - 1].group !== item.group)}
            {#if i > 0}
              <span class="nav-sep"></span>
            {/if}
            <span class="nav-group-label">{item.group}</span>
          {/if}
          <a
            href={item.href}
            class="nav-link"
            class:active={activePath === item.href}
          >
            {item.label}
            {#if item.badge !== undefined && item.badge > 0}
              <span class="badge">{item.badge}</span>
            {/if}
          </a>
        {/each}
        {@render children?.()}
      </nav>
    </div>

    <div class="header-right">
      {#if search}
        <form class="search-form" onsubmit={handleSearchSubmit}>
          <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="16" y1="16" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            type="text"
            class="search-input"
            placeholder={search.placeholder}
            aria-label="Search"
            value={searchQuery}
            oninput={handleSearchInput}
          />
        </form>
      {/if}

      <button class="hamburger" onclick={toggleMobileMenu} aria-label="Toggle menu" aria-expanded={mobileMenuOpen}>
        <span class="hamburger-bar"></span>
        <span class="hamburger-bar"></span>
        <span class="hamburger-bar"></span>
      </button>
    </div>
  </div>

  {#if mobileMenuOpen}
    <nav class="nav-mobile">
      {#each navItems as item}
        <a
          href={item.href}
          class="nav-mobile-link"
          class:active={activePath === item.href}
          onclick={closeMobileMenu}
        >
          {item.label}
          {#if item.badge !== undefined && item.badge > 0}
            <span class="badge">{item.badge}</span>
          {/if}
        </a>
      {/each}
      <div class="nav-mobile-children" onclick={closeMobileMenu} onkeydown={(e) => e.key === 'Enter' && closeMobileMenu()} role="presentation">
        {@render children?.()}
      </div>
    </nav>
  {/if}
</header>

<style>
  .header {
    height: 50px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-container {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  .nav-desktop {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .nav-sep {
    width: 1px;
    height: 16px;
    background: var(--border);
    margin: 0 4px;
    align-self: center;
  }

  .nav-group-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    padding: 6px 6px 6px 2px;
    align-self: center;
  }

  .nav-link {
    font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-mid);
    text-decoration: none;
    padding: 6px 10px;
    border-radius: 6px;
    transition: background 0.15s, color 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .nav-link:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .nav-link.active {
    color: var(--text);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--red, #ef4444);
    color: white;
    font-size: 10px;
    font-weight: 600;
    min-width: 16px;
    height: 16px;
    border-radius: 8px;
    padding: 0 4px;
    line-height: 1;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .search-form {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 8px;
    height: 28px;
    background: var(--bg);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .search-form:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }

  .search-icon {
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .search-input {
    border: none;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    padding: 0 0 0 6px;
    width: 140px;
    outline: none;
    transition: width 0.15s;
  }

  .search-input::placeholder {
    color: var(--text-dim);
  }

  .search-input:focus {
    width: 200px;
  }

  .hamburger {
    display: none;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 5px;
  }

  .hamburger-bar {
    width: 18px;
    height: 2px;
    background: var(--text-mid);
    border-radius: 1px;
    transition: background 0.15s;
  }

  .hamburger:hover .hamburger-bar {
    background: var(--text);
  }

  .nav-mobile {
    display: none;
    position: absolute;
    top: 50px;
    left: 0;
    right: 0;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.05));
  }

  .nav-mobile-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-mid);
    text-decoration: none;
    border-bottom: 1px solid var(--border);
  }

  .nav-mobile-link:last-child {
    border-bottom: none;
  }

  .nav-mobile-link.active {
    color: var(--text);
  }

  .nav-mobile-children {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .nav-mobile-children:empty {
    display: none;
  }

  @media (max-width: 640px) {
    .header-container {
      padding: 0 16px;
    }

    .nav-desktop {
      display: none;
    }

    .search-form {
      display: none;
    }

    .hamburger {
      display: flex;
    }

    .nav-mobile {
      display: block;
    }
  }
</style>
