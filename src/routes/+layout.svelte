<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';

	if (browser)
		onMount(async () => {
			if ('serviceWorker' in navigator) {
				const workerPath = `${base}/worker.js`;
				navigator.serviceWorker
					.register(workerPath, { scope: base ? `${base}/` : '/' })
					.then(
						function (registration) {
							console.log('COOP/COEP Service Worker registered', registration.scope);
							if (registration.active && !navigator.serviceWorker.controller)
								window.location.reload();
						},
						function (err) {
							console.log('COOP/COEP Service Worker failed to register', err);
						}
					);
			} else {
				console.warn('Cannot register a service worker');
			}
		});
</script>

<slot />
