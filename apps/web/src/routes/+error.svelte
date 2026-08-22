<script lang="ts">
  import { base } from "$app/paths";
  import { page } from "$app/state";
</script>

<svelte:head>
  <title>Error — rule1</title>
</svelte:head>

<div class="cl-main">
  <div class="error-state">
    <div class="error-state-icon">&#9670;</div>
    <div class="error-state-title">{page.status}</div>
    <div class="error-state-msg">{page.error?.message ?? "Something went wrong."}</div>
    <a href={`${base}/`} class="error-state-link">Back to home</a>
  </div>
</div>
