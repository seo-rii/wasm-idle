<script lang="ts">
    import Clang from "$lib/clang";

    import {browser} from "$app/environment";
    import {onMount} from "svelte";
    import Monaco from "./Monaco.svelte";

    let value;

    let clang, out;

    if (browser) onMount(() => {
        clang = new Clang({
            stdout: (str) => out += str,
        });
    });

    const run = () => {
        out = '';
        clang.compileLinkRun(value());
    }
</script>

<main>
    <button on:click={run}>run</button>
    <textarea value={out} rows="20"></textarea>

    <Monaco bind:value/>
</main>

<style>
    main {
        height: calc(100vh - 20px);
        display: flex;
        flex-direction: column;
    }
</style>