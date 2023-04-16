<script lang="ts">
    import Monaco from "./Monaco.svelte";
    import Terminal from "./Terminal.svelte";
    import {onMount, tick} from "svelte";
    import {browser} from "$app/environment";

    let value, editor, run = false;

    async function exec() {
        run = false;
        await tick();
        run = true;
    }

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


<main>
    <div style="width: 520px">
        <button on:click={exec}>Run</button>
        {#if editor && run}
            <Terminal language="CPP" {editor}/>
        {/if}
    </div>
    <Monaco bind:editor/>
</main>

<style>
    main {
        height: calc(100vh - 20px);
        display: flex;
        flex-direction: row;
    }
</style>