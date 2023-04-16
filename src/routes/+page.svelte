<script lang="ts">
    import Monaco from "./Monaco.svelte";
    import Terminal from "./Terminal.svelte";

    let value, editor, terminal;

    function exec() {
        terminal.clear();
        terminal.run('CPP', editor.getValue());
    }
</script>


<main>
    <div style="width: 50%">
        <button on:click={exec}>Run</button>
        <Terminal bind:terminal/>
    </div>
    <Monaco bind:editor/>
</main>

<style>
    main {
        height: calc(100vh - 40px);
        display: flex;
        flex-direction: row;
    }
</style>