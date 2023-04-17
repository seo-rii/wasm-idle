<script lang="ts">
    import Monaco from "./Monaco.svelte";
    import Terminal from "$lib";
    import {page} from "$app/stores";
    import {browser} from "$app/environment";

    let path = $page.url.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    let value, editor, terminal, log = true, language = 'CPP', init = false;

    async function exec() {
        if (browser) {
            localStorage.setItem('code', editor.getValue());
            localStorage.setItem('language', language);
        }
        if (!('SharedArrayBuffer' in window)) location.reload();
        await terminal.clear();
        await terminal.prepare(language, editor.getValue(), log);
        await terminal.run(language, editor.getValue(), log);
    }

    $: if (browser && editor && !init) {
        const code = localStorage.getItem('code');
        const lang = localStorage.getItem('language');
        if (code) editor.setValue(code);
        if (lang) language = lang;
        init = true;
    }
</script>

<main>
    <div style="width: 50%">
        {path}
        <button on:click={exec}>Run</button>
        <input type="checkbox" bind:checked={log}/>
        <label>Log</label>
        <select bind:value={language}>
            <option value="CPP">C++</option>
            <option value="PYTHON">Python</option>
        </select>
        <Terminal bind:terminal {path}/>
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