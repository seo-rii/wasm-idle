<script lang="ts">
    import Monaco from "./Monaco.svelte";
    import Terminal from "$lib";

    let value, editor, terminal, log = true;

    function exec() {
        terminal.clear();
        terminal.run('PYTHON3', editor.getValue(), log);
    }
</script>


<main>
    <div style="width: 50%">
        <button on:click={exec}>Run</button>
        <input type="checkbox" bind:checked={log}/>
        <label>Log</label>
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