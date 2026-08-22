<script lang="ts">
// biome-ignore lint/correctness/noUnusedImports: used in Svelte template
import { dismissToast, toasts } from "./toast.svelte.ts";
</script>

{#if toasts.length > 0}
	<div class="toast-container" aria-live="polite">
		{#each toasts as t (t.id)}
			<div
				class="toast toast--{t.variant}"
				class:toast-out={t.dismissing}
				role="alert"
			>
				<span class="toast-icon">
					{#if t.variant === 'warning'}&#x26A0;{/if}
					{#if t.variant === 'error'}&#x2716;{/if}
					{#if t.variant === 'success'}&#x2714;{/if}
					{#if t.variant === 'info'}&#x2139;{/if}
				</span>
				<div class="toast-body">
					{#if t.title}<div class="toast-title">{t.title}</div>{/if}
					<div class="toast-msg">{t.message}</div>
				</div>
				<button
					class="toast-close"
					onclick={() => dismissToast(t.id)}
					aria-label="Dismiss"
				>&#x2715;</button>
			</div>
		{/each}
	</div>
{/if}
