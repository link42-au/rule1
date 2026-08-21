<script lang="ts">
import { gravatarUrl } from "./gravatar";

interface PlatformBarUser {
	name: string;
	email: string;
	image: string | null;
}

interface Props {
	currentApp?:
		| "link42"
		| "login2"
		| "peer6"
		| "rule1"
		| "threat10"
		| "patch8"
		| null;
	user?: PlatformBarUser | null;
	signInHref?: string;
	accountHref?: string;
	onSignOut?: () => void | Promise<void>;
	hideAuth?: boolean;
	theme?: "light" | "dark";
	onToggleTheme?: () => void;
}

const APPS = [
	{
		id: "link42",
		label: "link42",
		href: "https://link42.app",
		color: "#64748b",
	},
	{
		id: "rule1",
		label: "rule1",
		href: "https://rule1.link42.app",
		color: "#2563eb",
	},
] as const;

const PLATFORM_PAGES = [
	{ label: "Learn", href: "https://link42.app/learn" },
	{ label: "About", href: "https://link42.app/about" },
	{ label: "API", href: "https://link42.app/api" },
	{ label: "Changelog", href: "https://link42.app/changelog" },
	{ label: "Licence", href: "https://link42.app/licence" },
] as const;

let {
	currentApp,
	user,
	signInHref = "#",
	accountHref = "https://login2.link42.app",
	onSignOut,
	hideAuth = false,
	theme = "light",
	onToggleTheme,
}: Props = $props();

let dropdownOpen = $state(false);
let moreOpen = $state(false);
let avatarSrc = $state<string | null>(null);
let avatarFailed = $state(false);

$effect(() => {
	avatarFailed = false;
	if (user?.image) {
		avatarSrc = user.image;
	} else if (user?.email) {
		gravatarUrl(user.email).then((url) => {
			avatarSrc = url;
		});
	} else {
		avatarSrc = null;
	}
});

function getInitial(name: string): string {
	return name.charAt(0).toUpperCase();
}

function handleAvatarError() {
	avatarFailed = true;
}

function toggleDropdown() {
	dropdownOpen = !dropdownOpen;
}

function toggleMore() {
	moreOpen = !moreOpen;
}

function handleSignOut() {
	dropdownOpen = false;
	onSignOut?.();
}

function handleWindowClick(e: MouseEvent) {
	const target = e.target as HTMLElement;
	if (!target.closest(".pb-user-wrap")) {
		dropdownOpen = false;
	}
	if (!target.closest(".pb-more-wrap")) {
		moreOpen = false;
	}
}
function handleWindowKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		if (dropdownOpen) dropdownOpen = false;
		if (moreOpen) moreOpen = false;
	}
}
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="platform-bar">
  <nav class="pb-nav" aria-label="Platform navigation">
    {#each APPS as app}
      <a
        href={app.id === currentApp ? "/" : app.href}
        class="pb-app"
        class:pb-app--active={app.id === currentApp}
        aria-current={app.id === currentApp ? "page" : undefined}
        aria-label="Navigate to {app.label}"
      >
        {#if app.id === "link42"}
          <svg class="pb-icon" viewBox="0 0 120 120" width="28" height="28" aria-hidden="true">
            <path d="M 60 20 L 25 28 L 25 65 C 25 85 45 95 60 102 Z" fill="currentColor" opacity="0.2" />
            <path d="M 60 20 L 95 28 L 95 65 C 95 85 75 95 60 102 Z" fill="currentColor" opacity="0.4" />
            <circle cx="60" cy="60" r="20" fill="none" stroke="currentColor" stroke-width="5" />
            <line x1="74" y1="74" x2="86" y2="86" stroke="currentColor" stroke-width="8" stroke-linecap="round" />
            <polyline points="38,72 54,56 66,64 82,42" fill="none" stroke={app.color} stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />
            <circle cx="38" cy="72" r="5" fill={app.color} />
            <circle cx="82" cy="42" r="5" fill={app.color} />
          </svg>
        {:else if app.id === "rule1"}
          <svg class="pb-icon" viewBox="0 0 120 120" width="28" height="28" aria-hidden="true">
            <polyline points="38,72 54,56 66,64 82,42" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" />
            <circle cx="38" cy="72" r="6" fill={app.color} />
            <circle cx="54" cy="56" r="6" fill="currentColor" />
            <circle cx="66" cy="64" r="6" fill={app.color} />
            <circle cx="82" cy="42" r="6" fill="currentColor" />
          </svg>
        {/if}
        <span class="pb-label">{app.label}</span>
      </a>
    {/each}
    <div class="pb-more-wrap">
      <button class="pb-more-trigger" onclick={toggleMore} aria-expanded={moreOpen}>
        more
        <svg class="pb-more-caret" width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true">
          <path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {#if moreOpen}
        <div class="pb-more-dropdown">
          {#each PLATFORM_PAGES as page}
            <a href={page.href} class="pb-dropdown-item">{page.label}</a>
          {/each}
        </div>
      {/if}
    </div>
  </nav>

  <div class="pb-right">
    {#if onToggleTheme}
      <button class="pb-theme-toggle" onclick={onToggleTheme} aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}>
        {#if theme === "light"}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {/if}
      </button>
    {/if}
    {#if user}
      <div class="pb-user-wrap">
        <button class="pb-user" onclick={toggleDropdown} aria-expanded={dropdownOpen}>
          {#if avatarSrc && !avatarFailed}
            <img
              class="pb-avatar"
              src={avatarSrc}
              alt=""
              width="20"
              height="20"
              onerror={handleAvatarError}
            />
          {:else}
            <span class="pb-initials">{getInitial(user.name)}</span>
          {/if}
          <span class="pb-name">{user.name}</span>
          <svg class="pb-caret" width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        {#if dropdownOpen}
          <div class="pb-dropdown">
            <a href={accountHref} class="pb-dropdown-item">Account</a>
            <button class="pb-dropdown-item" onclick={handleSignOut}>Sign out</button>
          </div>
        {/if}
      </div>
    {:else if !hideAuth}
      <a href={signInHref} class="pb-signin">Sign in</a>
    {/if}
  </div>
</div>

<style>
  .platform-bar {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background: var(--bg-subtle);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    flex-shrink: 0;
    position: relative;
    z-index: 200;
  }

  .pb-nav {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .pb-app {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    color: var(--text-dim);
    font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 10px;
    font-weight: 500;
    text-decoration: none;
    transition: color 0.15s;
    line-height: 1;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
  }

  .pb-app:hover {
    color: var(--text-mid);
  }

  .pb-app--active {
    color: var(--text);
    font-weight: 600;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 8px;
  }

  .pb-more-wrap {
    position: relative;
    display: flex;
    align-items: center;
    margin-left: 4px;
  }

  .pb-more-trigger {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 10px;
    font-weight: 500;
    color: var(--text-dim);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
    line-height: 1;
  }

  .pb-more-trigger:hover {
    color: var(--text-mid);
    background: var(--bg-hover);
  }

  .pb-more-caret {
    flex-shrink: 0;
    opacity: 0.5;
  }

  .pb-more-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    min-width: 120px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-md);
    padding: 4px;
    z-index: 50;
  }

  .pb-icon {
    display: block;
    flex-shrink: 0;
  }

  .pb-label {
    white-space: nowrap;
  }

  .pb-theme-toggle {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: none;
    color: var(--text-mid);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    padding: 0;
    margin-right: 8px;
  }

  .pb-theme-toggle:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .pb-right {
    display: flex;
    align-items: center;
  }

  .pb-user-wrap {
    position: relative;
  }

  .pb-user {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 6px;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    color: var(--text-mid);
    transition: background 0.15s;
  }

  .pb-user:hover {
    background: var(--bg-hover);
  }

  .pb-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .pb-initials {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent, #6366f1);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .pb-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pb-caret {
    flex-shrink: 0;
    opacity: 0.5;
  }

  .pb-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 140px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-md);
    padding: 4px;
    z-index: 50;
  }

  .pb-dropdown-item {
    display: block;
    width: 100%;
    padding: 7px 12px;
    font-size: 12px;
    color: var(--text);
    text-decoration: none;
    border-radius: 5px;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s;
  }

  .pb-dropdown-item:hover {
    background: var(--bg-hover);
  }

  .pb-signin {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-mid);
    text-decoration: none;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    transition: all 0.15s;
  }

  .pb-signin:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
    color: var(--text);
  }

  @media (max-width: 640px) {
    .platform-bar {
      padding: 0 16px;
    }

    .pb-name {
      display: none;
    }

    .pb-more-dropdown {
      left: auto;
      right: 0;
    }
  }
</style>
