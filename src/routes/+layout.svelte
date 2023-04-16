<script lang="ts">
    import {browser} from "$app/environment";
    import {onMount} from "svelte";

    if (browser) onMount(async () => {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register(new URL(location.href + "worker.js", import.meta.url)).then(
                function (registration) {
                    console.log("COOP/COEP Service Worker registered", registration.scope);
                    if (registration.active && !navigator.serviceWorker.controller) window.location.reload();
                },
                function (err) {
                    console.log("COOP/COEP Service Worker failed to register", err);
                }
            );
        } else {
            console.warn("Cannot register a service worker");
        }
    })
</script>

<slot/>