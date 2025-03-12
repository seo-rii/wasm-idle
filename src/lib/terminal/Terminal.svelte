<script lang="ts">
	import type { Sandbox } from '$lib/playground/sandbox';
	import { Theme, registerAllPlugins } from '$lib/terminal';
	import load from '$lib/playground';
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal as TerminalType } from '@xterm/xterm';

	type TerminalControl = typeof terminalControl;
	interface Props {
		dark?: boolean;
		path?: string;
		font?: string;

		onload?: () => void;
		onfinish?: () => void;
		onkey?: (e: KeyboardEvent) => void;
		terminal?: TerminalControl;
	}

	let {
		dark = false,
		path = '',
		font = "'D2 coding', monospace",
		onload,
		onfinish,
		onkey,
		terminal = $bindable()
	}: Props = $props();

	let ref = $state<HTMLElement>(),
		clientWidth = $state(0),
		clientHeight = $state(0),
		term = $state<TerminalType>(),
		finish = true,
		input = '',
		sandbox: Sandbox,
		first = true,
		tc = 0,
		plugin = $state(),
		ll: string | null = null;

	function wait() {
		return new Promise<void>((r) => {
			const i = setInterval(() => {
				if (term) {
					clearInterval(i);
					r();
				}
			}, 100);
		});
	}

	async function initSandbox(language: string) {
		let _tc = ++tc;
		await wait();
		if (sandbox) await sandbox.clear();
		input = '';
		finish = false;
		if (ll !== language) {
			sandbox = await load(language);
			await sandbox.clear();
			ll = language;
		}
		sandbox.output = (output: string) =>
			_tc === tc && term && term.write(output.replaceAll('\n', '\r\n'));
	}

	function runSandbox(pr: Promise<boolean>) {
		return pr
			.then((x) => {
				term?.write(`\r\nProcess finished after ${sandbox.elapse}ms\u001B[?25l`);
				return x;
			})
			.catch((msg) => {
				term?.write(`\r\n\x1B[1;3;31m${msg}\u001B[?25l`);
				return false;
			})
			.finally((ret) => {
				onfinish?.();
				finish = true;
				if (term) term.options.cursorBlink = false;
				return ret;
			});
	}

	async function initTerm(blink = true) {
		await wait();
		if (!term) return;
		term.options.cursorBlink = blink;
		term.focus();

		if (!first) term?.write(`\r\n\x1b[0m`);
		first = false;
	}

	const terminalControl = {
		async clear() {
			await wait();
			term?.reset();
			term?.write(`\u001B[?25l\x1b[0m\x1b[?25h`);
			if (term) term.options.cursorBlink = false;
			first = true;
			await new Promise((r) => setTimeout(r, 100));
		},
		async prepare(language: string, code: string, log = true, prog) {
			await Promise.all([
				initSandbox(language).then(() => sandbox.load(path, code, log)),
				initTerm(false)
			]);
			return await runSandbox(sandbox.run(code, true, log, prog));
		},
		async run(language: string, code: string, log = true, prog) {
			await Promise.all([
				initSandbox(language).then(() => sandbox.load(path, code, log)),
				initTerm()
			]);
			return await runSandbox(sandbox.run(code, false, log, prog));
		},
		async destroy() {
			await wait();
			term?.dispose();
			if (sandbox) await sandbox.clear();
		},
		async write(input: string) {
			await wait();
			term?.write(input + '\r\n');
			sandbox.write?.(input.replaceAll('\r', '\n') + '\n');
		}
	};

	$effect(() => {
		if (term) {
			if (dark) term.options.theme = Theme.Tango_Dark;
			else term.options.theme = Theme.Tango_Light;
		}
	});

	$effect(() => {
		let _ = clientWidth + clientHeight;
		(plugin as any)?.fit?.fit?.();
	});

	$effect(() => {
		terminal = terminalControl;
	});

	onMount(() => {
		import('@xterm/xterm').then(async ({ Terminal }) => {
			if (!ref) return;
			term = new Terminal({
				theme: dark ? Theme.Tango_Dark : Theme.Tango_Light,
				cursorBlink: false,
				allowTransparency: true,
				fontFamily: font,
				allowProposedApi: true
			});
			term.open(ref);
			term.onKey((e: { key: string; domEvent: KeyboardEvent }) => {
				if (finish || !term) return;
				const ev = e.domEvent;
				const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;
				onkey?.(ev);
				if (ev.key === 'Enter') {
					term.write('\r\n');
					sandbox.write?.(input + '\n');
					input = '';
				} else if (ev.key === 'Backspace') {
					if (term.buffer.active.cursorX > 0) {
						term.write('\b \b');
						if (input.length > 0) input = input.substring(0, input.length - 1);
					}
				} else if (printable) {
					if (
						(e.key >= String.fromCharCode(0x20) &&
							e.key <= String.fromCharCode(0x7e)) ||
						e.key >= '\u00a0'
					) {
						input += e.key;
						term.write(e.key);
					}
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'c') {
					sandbox.kill?.();
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'd') {
					sandbox.kill?.();
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'v') {
					navigator.clipboard.readText().then((text) => {
						term?.write(text);
						sandbox.write?.(text);
					});
				}
			});
			plugin = await registerAllPlugins(term);

			onload?.();
		});

		return async () => {
			term?.dispose();
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
