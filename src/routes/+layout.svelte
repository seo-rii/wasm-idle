<script lang="ts">
	import { browser } from '$app/env';
	import { asset, resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let { children } = $props();

	if (browser)
		onMount(async () => {
			if ('serviceWorker' in navigator) {
				const workerPath = `${asset('worker.js')}?build=${encodeURIComponent(__WASM_IDLE_BUILD__.builtAt)}`;
				try {
					const registration = await navigator.serviceWorker.register(workerPath, {
						scope: resolve('')
					});
					console.log('COOP/COEP Service Worker registered', registration.scope);
					await navigator.serviceWorker.ready;
					// Reload at most once per tab: isolation can stay unreachable (for example in a
					// cross-origin iframe without allow="cross-origin-isolated"), and the page must
					// then stay usable in degraded mode instead of reloading forever.
					const isolationReloadKey = 'wasm-idle:isolation-reload';
					try {
						if (crossOriginIsolated) sessionStorage.removeItem(isolationReloadKey);
						else if (sessionStorage.getItem(isolationReloadKey) === null) {
							sessionStorage.setItem(isolationReloadKey, '1');
							window.location.reload();
						}
					} catch {
						// Without sessionStorage the one-shot guard cannot hold, so do not reload.
					}
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
