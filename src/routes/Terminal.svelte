<script lang='ts'>
    import {onMount} from 'svelte';
    import {Theme, registerAllPlugins} from '$lib/terminal';
    import {createEventDispatcher} from 'svelte';
    import {load} from '$lib/playground';
    import {browser} from "$app/environment";
    import 'xterm/css/xterm.css';

    const dispatch = createEventDispatcher();
    let ref, clientWidth, clientHeight, term, finish = true, input = '', sandbox, first = true;
    export const terminal = {
        clear() {
            term.clear();
            term.write(`\x1b[0m`);
            term.write(`\x1b[1;3;31m`);
            term.write(`\x1b[?25l`);
            term.options.cursorBlink = false;
        },
        async run(language, code) {
            if (sandbox) await sandbox.clear();
            input = '';
            finish = false;
            sandbox = await load(language);
            await sandbox.clear();
            sandbox.output = (output) => {
                term.write(output.replaceAll('\n', '\r\n'));
            };
            term.options.cursorBlink = true;
            if (!first) term.write(`\r\n\x1b[0m`);

            await sandbox.load(code);
            term.focus();
            first = false;
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
        }
    }

    let plugin;
    $: if (plugin) {
        void clientWidth, clientHeight;
        try {
            plugin.fit.fit();
        } catch (e) {
        }
    }

    if (browser) onMount(() => {
        import('xterm').then(async ({Terminal}) => {
            term = new Terminal({
                theme: Theme.Tango_Light,
                cursorBlink: false,
                allowTransparency: true,
                fontFamily: '\'D2 coding\', monospace',
                fontWeight: 'bold',
                allowProposedApi: true
            });
            term.open(ref);
            term.onKey((e: { key: string, domEvent: KeyboardEvent }) => {
                if (finish) return;
                const ev = e.domEvent;
                const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;
                if (ev.key === 'Enter') {
                    term.write('\r\n');
                    sandbox.write(input + '\n');
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
                } else if (ev.ctrlKey && ev.key === 'c') {
                    sandbox.kill();
                }
            });
            plugin = await registerAllPlugins(term);
        });

        dispatch('load');
        return async () => {
            term.dispose();
            if (sandbox) await sandbox.clear();
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