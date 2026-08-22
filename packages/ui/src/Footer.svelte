<script lang="ts">
interface FooterLink {
	href: string;
	label: string;
}

interface FooterChip {
	label: string;
	value: string;
}

interface Props {
	appName: string;
	attribution?: string;
	extraLinks?: FooterLink[];
	chips?: FooterChip[];
	excludeApps?: string[];
}

let {
	appName,
	attribution = "part of the link42 platform",
	extraLinks = [],
	chips = [],
	excludeApps = [],
}: Props = $props();

const ALL_APPS = [
	{ id: "login2", label: "login2", href: "https://login2.link42.app" },
	{ id: "rule1", label: "rule1", href: "https://rule1.link42.app" },
	{ id: "threat10", label: "threat10", href: "https://threat10.link42.app" },
	{ id: "patch8", label: "patch8", href: "https://patch8.link42.app" },
	{ id: "peer6", label: "peer6", href: "https://peer6.link42.app" },
];

let platformApps = $derived(
	ALL_APPS.filter((app) => !excludeApps.includes(app.id)),
);
</script>

<footer class="footer">
  <div class="footer-content">
    <div class="footer-main">
      {#if chips.length > 0}
        <div class="chips">
          {#each chips as chip}
            <span class="chip">
              <span class="chip-label">{chip.label}</span>
              <span class="chip-value">{chip.value}</span>
            </span>
          {/each}
        </div>
      {/if}

      <span class="attribution">
        <strong>{appName}</strong> — {attribution}
      </span>

      {#if extraLinks.length > 0}
        <div class="extra-links">
          {#each extraLinks as link, i}
            <a href={link.href} class="extra-link">{link.label}</a>
            {#if i < extraLinks.length - 1}
              <span class="separator">·</span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <div class="platform-links">
      {#each platformApps as app, i}
        <a href={app.href} class="platform-link">{app.label}</a>
        {#if i < platformApps.length - 1}
          <span class="separator">·</span>
        {/if}
      {/each}
    </div>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--border);
    background: var(--bg);
    padding: 14px 16px 10px;
    text-align: center;
    font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
  }

  .footer-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .footer-main {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .chips {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    line-height: 1;
  }

  .chip-label {
    background: var(--bg-subtle);
    padding: 3px 5px;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
  }

  .chip-value {
    padding: 3px 5px;
    color: var(--text-mid);
    background: var(--bg);
  }

  .attribution strong {
    font-weight: 600;
    color: var(--text-mid);
  }

  .extra-links {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .extra-link {
    color: var(--text-dim);
    text-decoration: none;
    transition: color 0.15s;
  }

  .extra-link:hover {
    color: var(--text-mid);
    text-decoration: underline;
  }

  .platform-links {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 10px;
    opacity: 0.85;
  }

  .platform-link {
    color: var(--text-dim);
    text-decoration: none;
    transition: color 0.15s;
  }

  .platform-link:hover {
    color: var(--text-mid);
    text-decoration: underline;
  }

  .separator {
    color: var(--border-strong);
  }
</style>
