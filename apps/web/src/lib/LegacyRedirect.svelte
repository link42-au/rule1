<script lang="ts">
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { onMount } from "svelte";

  let { destination, message }: { destination: string; message: string } = $props();
  let href = $derived(`${base}${destination}`);
  onMount(() => void goto(href, { replaceState: true }));
</script>

<div class="cl-main">
  <div class="error-state">
    <div class="error-state-icon">◇</div>
    <h1 class="error-state-title">Moved</h1>
    <p class="error-state-msg">{message}</p>
    <a class="error-state-link" {href}>Continue →</a>
  </div>
</div>
