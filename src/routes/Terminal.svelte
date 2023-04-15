<script lang='ts'>
    import {onMount, tick} from 'svelte';
    import {Theme, registerAllPlugins} from '$lib/terminal';
    import {createEventDispatcher} from 'svelte';
    import {load} from '$lib/playground';
    import 'xterm/css/xterm.css';
    import {browser} from "$app/environment";

    const dispatch = createEventDispatcher();
    let ref, clientWidth, clientHeight, term;
    export let language, editor;

    let plugin;

    $: if (plugin) {
        let _ = clientHeight, __ = clientWidth;
        try {
            plugin.fit.fit();
        } catch (e) {
        }
    }

    if (browser) onMount(async () => {
        const {Terminal} = await import('xterm');
        let input = '', finish = false;
        term = new Terminal({
            theme: Theme.Tango_Light,
            cursorBlink: true,
            allowTransparency: true,
            fontFamily: '\'D2 coding\', monospace',
            fontWeight: 'bold',
            allowProposedApi: true
        });
        await tick();
        const code = editor.getValue();
        const sandbox = await load(language);
        await sandbox.clear();
        sandbox.output = (output) => {
            term.write(output);
        };
        term.open(ref);
        plugin = await registerAllPlugins(term);
        term.onKey((e: { key: string, domEvent: KeyboardEvent }) => {
            if (finish) return;
            const ev = e.domEvent;
            const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;
            if (ev.key === 'Enter') {
                term.write('\r\n');
                sandbox.write(input);
                input = '';
            } else if (ev.key === 'Backspace') {
                if (term._core.buffer.x > 0) {
                    term.write('\b \b');
                    if (input.length > 0) {
                        input = input.substring(0, input.length - 1);
                    }
                }
            } else if (printable) {
                if (e.key >= String.fromCharCode(0x20) && e.key <= String.fromCharCode(0x7E) || e.key >= '\u00a0') {
                    input += e.key;
                    term.write(e.key);
                }
            }
        });
        term.focus();
        await sandbox.load(code);
        dispatch('load');
        sandbox.run(code).then(() => {
            dispatch('finish');
            finish = true;
            term.write(`\r\nProcess finished after ${sandbox.elapse}ms\r\n\u001B[?25l`);
            term.options.cursorBlink = false;
        }).catch((msg) => {
            dispatch('finish');
            finish = true;
            term.write(`\r\n\x1B[1;3;31m${msg}`);
            term.options.cursorBlink = false;
        });

        return async () => {
            term.dispose();
            await sandbox.clear();
        };
    });

</script>

<main>
    <div bind:this={ref} bind:clientWidth bind:clientHeight></div>
</main>


<style>
    main {
        padding: 10px;
        width: calc(100% - 20px);
        height: calc(100% - 20px);
        overflow: hidden;
    }

    div {
        width: 100%;
        height: 100%;
    }
</style>