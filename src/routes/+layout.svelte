<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';

	let { children } = $props();

	if (browser)
		onMount(async () => {
			if ('serviceWorker' in navigator) {
				const workerPath = `${base}/worker.js`;
				try {
					const registration = await navigator.serviceWorker.register(workerPath, {
						scope: base ? `${base}/` : '/'
					});
					console.log('COOP/COEP Service Worker registered', registration.scope);
					await navigator.serviceWorker.ready;
					if (!crossOriginIsolated) window.location.reload();
				} catch (err) {
					console.log('COOP/COEP Service Worker failed to register', err);
				}
			} else {
				console.warn('Cannot register a service worker');
			}
		});
</script>

{@render children()}

<style>
	:global(html),
	:global(body) {
		margin: 0;
		min-height: 100%;
	}

	:global(body) {
		min-height: 100vh;
		min-height: 100dvh;
	}
</style>
