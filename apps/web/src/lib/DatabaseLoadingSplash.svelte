<script lang="ts">
  import { onDestroy } from "svelte";
  import { databaseLoading, formatBytes } from "./db/loading";

  let {
    initiallyVisible = false,
    routeKey = "",
    onVisibilityChange,
  }: {
    initiallyVisible?: boolean;
    routeKey?: string;
    onVisibilityChange?: (visible: boolean) => void;
  } = $props();

  const initialVisibility = (): boolean => initiallyVisible;
  const initialRouteKey = (): string => routeKey;

  let bootstrapVisible = $state(initialVisibility());
  let lifecycleStarted = $state(false);
  let previousRouteKey = $state(initialRouteKey());
  let databaseCard: HTMLElement | undefined = $state();

  $effect(() => {
    if (routeKey !== previousRouteKey) {
      previousRouteKey = routeKey;
      bootstrapVisible = initiallyVisible;
      lifecycleStarted = false;
    }

    if ($databaseLoading.visible) {
      lifecycleStarted = true;
    } else if (lifecycleStarted) {
      bootstrapVisible = false;
    }
  });

  let visible = $derived(bootstrapVisible || $databaseLoading.visible);
  let stageAnnouncement = $derived(
    $databaseLoading.visible && $databaseLoading.stage === "downloading"
      ? "Downloading the local catalogue."
      : $databaseLoading.visible && $databaseLoading.stage === "verifying"
        ? "Verifying the local catalogue."
        : "Opening the local catalogue.",
  );
  const percentage = (received: number, total: number): number => Math.min(100, Math.round((received / total) * 100));

  $effect(() => {
    onVisibilityChange?.(visible);
    if (visible) requestAnimationFrame(() => databaseCard?.focus());
  });

  onDestroy(() => onVisibilityChange?.(false));
</script>

{#if visible}
  <div class="database-splash">
    <div
      bind:this={databaseCard}
      class="database-card"
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby="database-loading-title"
      aria-describedby="database-loading-retention"
      tabindex="-1"
    >
      <p class="sr-only" role="status">{stageAnnouncement}</p>
      <div class="database-mark" aria-hidden="true">R1</div>
      {#if $databaseLoading.visible && $databaseLoading.stage === "downloading"}
        <p class="eyebrow">Preparing local catalogue</p>
        <h1 id="database-loading-title">Downloading Rule1 data</h1>
        {#if $databaseLoading.totalBytes !== null}
          <progress aria-label="Catalogue download progress" max={$databaseLoading.totalBytes} value={$databaseLoading.receivedBytes}></progress>
          <p class="progress-copy" aria-hidden="true">
            {formatBytes($databaseLoading.receivedBytes)} of {formatBytes($databaseLoading.totalBytes)}
            <span>{$databaseLoading.totalBytes > 0 ? percentage($databaseLoading.receivedBytes, $databaseLoading.totalBytes) : 0}%</span>
          </p>
        {:else}
          <progress aria-label="Catalogue download in progress" max="1"></progress>
          <p class="progress-copy" aria-hidden="true">{formatBytes($databaseLoading.receivedBytes)} downloaded <span>Total size unavailable</span></p>
        {/if}
      {:else if $databaseLoading.visible && $databaseLoading.stage === "verifying"}
        <p class="eyebrow">Preparing local catalogue</p>
        <h1 id="database-loading-title">Verifying catalogue integrity</h1>
        <progress aria-label="Catalogue integrity verification in progress" max="1"></progress>
        <p class="progress-copy">Checking the downloaded snapshot before it is opened.</p>
      {:else}
        <p class="eyebrow">Almost ready</p>
        <h1 id="database-loading-title">Opening the local catalogue</h1>
        <progress aria-label="Local catalogue opening in progress" max="1"></progress>
        <p class="progress-copy">Starting SQLite inside your browser.</p>
      {/if}
      <p id="database-loading-retention" class="retention-copy">
        The first visit downloads about 51 MiB. When browser storage is available, Rule1 retains the checked copy locally so
        later visits normally open without downloading it again.
      </p>
    </div>
  </div>
{/if}

<style>
  .database-splash {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: grid;
    place-items: center;
    padding: 32px;
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(8px);
  }

  .database-card {
    width: min(480px, calc(100vw - 64px));
    padding: 36px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-card);
    box-shadow: 0 24px 70px color-mix(in srgb, var(--text) 14%, transparent);
  }

  .database-mark {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    margin-bottom: 24px;
    border-radius: 9px;
    background: var(--accent);
    color: white;
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 700;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0 0 24px;
    color: var(--text);
    font-size: 24px;
    line-height: 1.25;
  }

  progress {
    display: block;
    width: 100%;
    height: 8px;
    overflow: hidden;
    border: 0;
    border-radius: 999px;
    background: var(--bg-subtle);
    accent-color: var(--accent);
  }

  progress::-webkit-progress-bar {
    background: var(--bg-subtle);
  }

  progress::-webkit-progress-value {
    border-radius: 999px;
    background: var(--accent);
  }

  progress::-moz-progress-bar {
    border-radius: 999px;
    background: var(--accent);
  }

  .progress-copy {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    min-height: 20px;
    margin: 10px 0 0;
    color: var(--text-mid);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .progress-copy span {
    color: var(--text);
    text-align: right;
  }

  .retention-copy {
    margin: 24px 0 0;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    color: var(--text-mid);
    font-size: 13px;
    line-height: 1.6;
  }

  @media (max-width: 480px) {
    .database-splash {
      padding: 16px;
    }

    .database-card {
      width: 100%;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      padding: 24px;
    }

    .database-mark {
      margin-bottom: 18px;
    }

    h1 {
      margin-bottom: 20px;
      font-size: 21px;
    }

    .progress-copy {
      flex-wrap: wrap;
      gap: 4px 12px;
    }

    .retention-copy {
      margin-top: 20px;
      padding-top: 16px;
    }
  }
</style>
