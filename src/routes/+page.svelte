<script lang="ts">
    import Monaco from "./Monaco.svelte";
    import Terminal from "$lib";

    let value, editor, terminal, log = true, language = 'CPP';

    function exec() {
        terminal.clear();
        terminal.run(language, editor.getValue(), log);
    }
</script>


<main>
    <div style="width: 50%">
        <button on:click={exec}>Run</button>
        <input type="checkbox" bind:checked={log}/>
        <label>Log</label>
        <select bind:value={language}>
            <option value="CPP">C++</option>
            <option value="PYTHON">Python</option>
        </select>
        <Terminal bind:terminal/>
    </div>
    {#key language}
        <Monaco language={language.toLowerCase()} bind:editor/>
    {/key}
</main>

<style>
    main {
        height: calc(100vh - 40px);
        display: flex;
        flex-direction: row;
    }
</style>