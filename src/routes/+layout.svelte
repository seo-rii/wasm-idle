<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	if (browser)
		onMount(async () => {
			if ('serviceWorker' in navigator) {
				let path: string = page.url.pathname;
				if (path.endsWith('/')) path = path.slice(0, -1);
				const workerPath = path ? `${path}/worker.js` : '/worker.js';
				navigator.serviceWorker
					.register(workerPath)
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
