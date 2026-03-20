<script lang="ts">
	import type {
		CompilerDiagnostic,
		DebugCommand,
		DebugSessionEvent,
		SandboxExecutionOptions
	} from '$lib/playground/options';
	import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
	import type { Sandbox } from '$lib/playground/sandbox';
	import type { TerminalControl } from '$lib/terminal/types';
	import { Theme, registerAllPlugins } from '$lib/terminal';
	import load from '$lib/playground';
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal as TerminalType } from '@xterm/xterm';

	interface Props {
		dark?: boolean;
		path?: string;
		runtimeAssets?: string | PlaygroundRuntimeAssets;
		font?: string;

		onload?: () => void;
		onfinish?: () => void;
		onkey?: (e: KeyboardEvent) => void;
		ondebug?: (event: DebugSessionEvent) => void;
		oncompilediagnostic?: (diagnostic: CompilerDiagnostic) => void;
		onimage?: (payload: { mime: string; b64: string; ts?: number }) => void;
		terminal?: TerminalControl;
	}

	let {
		dark = false,
		path = '',
		runtimeAssets = undefined,
		font = "'D2 coding', monospace",
		onload,
		onfinish,
		onkey,
		ondebug,
		oncompilediagnostic,
		onimage,
		terminal = $bindable()
	}: Props = $props();

	let ref = $state<HTMLElement>(),
		clientWidth = $state(0),
		clientHeight = $state(0),
		term = $state<TerminalType>(),
		debugOutput = $state(''),
		finish = true,
		input = '',
		sandbox: Sandbox,
		first = true,
		tc = 0,
		plugin = $state(),
		ll: string | null = null,
		stopRequested = false;

	function writeTerminalOutput(text: string) {
		if (!text) return;
		debugOutput += text;
		term?.write(text);
	}

	function phaseProgress(
		progress: { set?: (value: number) => void } | undefined,
		start: number,
		end: number
	) {
		if (!progress) return undefined;
		return {
			set(value: number) {
				const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
				progress.set?.(start + (end - start) * clamped);
			}
		};
	}

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
		sandbox.image = onimage;
		sandbox.ondebug = ondebug;
		sandbox.oncompilerdiagnostic = oncompilediagnostic;
		sandbox.output = (output: string) =>
			_tc === tc && writeTerminalOutput(output.replaceAll('\n', '\r\n'));
	}

	function runSandbox<T>(pr: Promise<T>) {
		return pr
			.then((x) => {
				writeTerminalOutput(`\r\nProcess finished after ${sandbox.elapse}ms\u001B[?25l`);
				return x;
			})
			.catch((msg) => {
				if (stopRequested) return false;
				writeTerminalOutput(`\r\n\x1B[1;3;31m${msg}\u001B[?25l`);
				return false;
			})
			.finally(() => {
				stopRequested = false;
				onfinish?.();
				finish = true;
				if (term) term.options.cursorBlink = false;
			});
	}

	async function initTerm(blink = true) {
		await wait();
		if (!term) return;
		term.options.cursorBlink = blink;
		term.write('\u001B[?25h');
		term.focus();

		if (!first) term?.write(`\r\n\x1b[0m`);
		first = false;
	}

	function appendInputText(text: string) {
		if (!text) return;
		input += text;
		term?.write(text);
	}

	function submitCurrentInput() {
		term?.write('\r\n');
		sandbox?.write?.(input + '\n');
		input = '';
	}

	function applyPastedText(text: string) {
		const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
		for (let i = 0; i < lines.length; i++) {
			appendInputText(lines[i]);
			if (i < lines.length - 1) submitCurrentInput();
		}
	}

	async function waitForInput() {
		await wait();
		const startedAt = Date.now();
		while (!sandbox && Date.now() - startedAt < 30_000) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	const terminalControl: TerminalControl = {
		async clear() {
			await wait();
			term?.reset();
			term?.write(`\u001B[?25l\x1b[0m\x1b[?25h`);
			if (term) term.options.cursorBlink = false;
			debugOutput = '';
			input = '';
			first = true;
			await new Promise((r) => setTimeout(r, 100));
		},
		async prepare(
			language: string,
			code: string,
			log = true,
			prog?: { set?: (value: number) => void },
			args: string[] = [],
			options: SandboxExecutionOptions = {}
		) {
			const loadProgress = phaseProgress(prog, 0, 0.85);
			const prepareProgress = phaseProgress(prog, 0.85, 0.99);
			await Promise.all([
				initSandbox(language).then(() =>
					sandbox.load(runtimeAssets || path, code, log, args, options, loadProgress)
				),
				initTerm(false)
			]);
			prepareProgress?.set?.(0);
			return !!(await runSandbox(
				sandbox.run(code, true, log, prepareProgress, args, options)
			));
		},
		async run(
			language: string,
			code: string,
			log = true,
			prog?: { set?: (value: number) => void },
			args: string[] = [],
			options: SandboxExecutionOptions = {}
		) {
			await Promise.all([
				initSandbox(language).then(() =>
					sandbox.load(runtimeAssets || path, code, log, args, options, prog)
				),
				initTerm()
			]);
			return await runSandbox(sandbox.run(code, false, log, prog, args, options));
		},
		async destroy() {
			await wait();
			term?.dispose();
			if (sandbox) await sandbox.clear();
		},
		async stop() {
			await wait();
			stopRequested = true;
			finish = true;
			if (sandbox?.kill) sandbox.kill();
			else sandbox?.terminate?.();
		},
		async debugCommand(command: DebugCommand) {
			await wait();
			sandbox.debugCommand?.(command);
		},
		async debugEvaluate(expression: string) {
			await wait();
			return (await sandbox.debugEvaluate?.(expression)) || '?';
		},
		async waitForInput() {
			await waitForInput();
		},
		async write(input: string) {
			await waitForInput();
			applyPastedText(input);
			if (!input.endsWith('\n') && !input.endsWith('\r')) submitCurrentInput();
		},
		async eof() {
			await waitForInput();
			sandbox?.eof?.();
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
					submitCurrentInput();
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
						appendInputText(e.key);
					}
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'c') {
					if (term.hasSelection()) {
						const selectedText = term.getSelection();
						if (selectedText) {
							navigator.clipboard.writeText(selectedText).catch(() => {});
							return;
						}
					}
					sandbox.kill?.();
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
					if (input.length > 0) submitCurrentInput();
					sandbox?.eof?.();
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v') {
					navigator.clipboard.readText().then((text) => {
						applyPastedText(text);
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
	<pre data-testid="terminal-debug-output" style="display: none;">{debugOutput}</pre>
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

	:global(.xterm),
	:global(.xterm .xterm-viewport),
	:global(.xterm .composition-view) {
		background-color: transparent;
	}
</style>
