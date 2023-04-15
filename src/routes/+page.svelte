<script lang="ts">
    import Monaco from "./Monaco.svelte";
    import Terminal from "./Terminal.svelte";
    import {tick} from "svelte";

    let value, editor, run = false;

    async function exec() {
        run = false;
        await tick();
        run = true;
    }
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