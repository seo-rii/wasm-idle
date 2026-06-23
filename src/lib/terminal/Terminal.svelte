<script lang="ts">
	import type {
		CompilerDiagnostic,
		DebugCommand,
		DebugSessionEvent,
		SandboxExecutionOptions
	} from '$lib/playground/options';
	import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
	import type {
		BoundSandbox,
		PlaygroundBinding,
		SandboxRuntimeAssets
	} from '$lib/playground/sandbox';
	import type { TerminalControl } from '$lib/terminal/types';
	import { Theme, registerAllPlugins } from '$lib/terminal';
	import load from '$lib/playground';
	import {
		createRuntimeAssetsKey,
		phaseProgress,
		progressBandsForLanguage
	} from '@wasm-idle/core';
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal as TerminalType } from '@xterm/xterm';

	interface Props {
		dark?: boolean;
		path?: string;
		runtimeAssets?: string | PlaygroundRuntimeAssets;
		playground?: PlaygroundBinding;
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
		playground = undefined,
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
		pendingSandboxInput: string[] = [],
		pendingSandboxEof = false,
		sandbox: BoundSandbox,
		sandboxAcceptingInput = false,
		first = true,
		tc = 0,
		plugin = $state(),
		ll: string | null = null,
		loadedRuntimeAssetsKey: string | undefined = undefined,
		stopRequested = false;

	function writeTerminalOutput(text: string) {
		if (!text) return;
		debugOutput += text;
		term?.write(text);
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
		const currentPlayground = playground;
		const currentRuntimeAssets = currentPlayground?.runtimeAssets || runtimeAssets || path;
		const currentRuntimeAssetsKey = createRuntimeAssetsKey(currentRuntimeAssets);
		const requiresSandboxReset =
			ll !== language || loadedRuntimeAssetsKey !== currentRuntimeAssetsKey;
		let _tc = ++tc;
		await wait();
		sandboxAcceptingInput = false;
		if (sandbox && requiresSandboxReset) await sandbox.clear();
		input = '';
		finish = false;
		if (!sandbox || requiresSandboxReset) {
			sandbox = currentPlayground
				? await currentPlayground.load(language)
				: await load(language, currentRuntimeAssets);
			await sandbox.clear();
			ll = language;
			loadedRuntimeAssetsKey = currentRuntimeAssetsKey;
		}
		sandbox.image = onimage;
		sandbox.ondebug = ondebug;
		sandbox.oncompilerdiagnostic = oncompilediagnostic;
		sandbox.output = (output: string) =>
			_tc === tc && writeTerminalOutput(output.replaceAll('\n', '\r\n'));
	}

	function flushPendingSandboxInput() {
		if (pendingSandboxInput.length > 0) {
			for (const pendingInput of pendingSandboxInput) {
				sandbox.write?.(pendingInput);
			}
			pendingSandboxInput = [];
		}
		if (pendingSandboxEof) {
			sandbox.eof?.();
			pendingSandboxEof = false;
		}
	}

	function submitSandboxEof() {
		if (sandbox && sandboxAcceptingInput) sandbox.eof?.();
		else pendingSandboxEof = true;
	}

	function runSandbox<T>(pr: Promise<T>, reportFinish = true) {
		return pr
			.then((x) => {
				if (reportFinish) {
					writeTerminalOutput(
						`\r\nProcess finished after ${sandbox.elapse}ms\u001B[?25l`
					);
				}
				return x;
			})
			.catch((msg) => {
				if (stopRequested) return false;
				writeTerminalOutput(`\r\n\x1B[1;3;31m${msg}\u001B[?25l`);
				return false;
			})
			.finally(() => {
				sandboxAcceptingInput = false;
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
		const submittedInput = input + '\n';
		if (sandbox && sandboxAcceptingInput) sandbox.write?.(submittedInput);
		else pendingSandboxInput.push(submittedInput);
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
	}

	const terminalControl: TerminalControl = {
		async clear() {
			await wait();
			term?.reset();
			term?.write(`\u001B[?25l\x1b[0m\x1b[?25h`);
			if (term) term.options.cursorBlink = false;
			debugOutput = '';
			input = '';
			sandboxAcceptingInput = false;
			pendingSandboxEof = false;
			first = true;
			await new Promise((r) => setTimeout(r, 100));
		},
		async prepare(
			language: string,
			code: string,
			log = true,
			prog?: { set?: (value: number, stage?: string) => void },
			args: string[] = [],
			options: SandboxExecutionOptions = {}
		) {
			prog?.set?.(0);
			const progressBands = progressBandsForLanguage(language);
			const loadProgress = phaseProgress(prog, progressBands.load[0], progressBands.load[1]);
			const prepareProgress = phaseProgress(
				prog,
				progressBands.prepare[0],
				progressBands.prepare[1]
			);
			await Promise.all([
				initSandbox(language).then(() =>
					sandbox.load(code, log, args, options, loadProgress)
				),
				initTerm(false)
			]);
			prepareProgress?.set?.(0);
			return !!(await runSandbox(
				sandbox.run(code, true, log, prepareProgress, args, options),
				false
			));
		},
		async run(
			language: string,
			code: string,
			log = true,
			prog?: { set?: (value: number, stage?: string) => void },
			args: string[] = [],
			options: SandboxExecutionOptions = {}
		) {
			await Promise.all([
				initSandbox(language).then(() => sandbox.load(code, log, args, options, prog)),
				initTerm()
			]);
			sandboxAcceptingInput = true;
			flushPendingSandboxInput();
			return await runSandbox(sandbox.run(code, false, log, prog, args, options));
		},
		async destroy() {
			await wait();
			sandboxAcceptingInput = false;
			pendingSandboxEof = false;
			term?.dispose();
			if (sandbox) await sandbox.clear();
		},
		async stop() {
			await wait();
			stopRequested = true;
			finish = true;
			sandboxAcceptingInput = false;
			pendingSandboxEof = false;
			if (sandbox?.kill) sandbox.kill();
			else sandbox?.terminate?.();
		},
		async debugCommand(command: DebugCommand) {
			await wait();
			sandbox.debugCommand?.(command);
		},
		async setBreakpoints(lines: number[]) {
			await wait();
			sandbox.setBreakpoints?.(lines);
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
			if (!input) return;
			applyPastedText(input);
			if (!input.endsWith('\n') && !input.endsWith('\r')) submitCurrentInput();
		},
		async eof() {
			await waitForInput();
			submitSandboxEof();
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
			term.onData((data: string) => {
				if (!term || finish) return;
				let pendingText = '';
				for (const chunk of data) {
					if (chunk === '\r' || chunk === '\n') {
						if (pendingText) {
							appendInputText(pendingText);
							pendingText = '';
						}
						submitCurrentInput();
						continue;
					}
					if (chunk === '\u007f') {
						if (pendingText) {
							appendInputText(pendingText);
							pendingText = '';
						}
						if (term.buffer.active.cursorX > 0 && input.length > 0) {
							term.write('\b \b');
							input = Array.from(input).slice(0, -1).join('');
						}
						continue;
					}
					if ((chunk.codePointAt(0) || 0) >= 0x20) {
						pendingText += chunk;
					}
				}
				if (pendingText) {
					appendInputText(pendingText);
				}
			});
			term.onKey((e: { key: string; domEvent: KeyboardEvent }) => {
				if (!term) return;
				const ev = e.domEvent;
				const isCopyShortcut = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'c';
				if (isCopyShortcut && term.hasSelection()) {
					const selectedText = term.getSelection();
					if (selectedText) {
						ev.preventDefault();
						navigator.clipboard.writeText(selectedText).catch(() => {});
						return;
					}
				}
				if (finish) return;
				onkey?.(ev);
				if (isCopyShortcut) {
					ev.preventDefault();
					sandbox.kill?.();
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
					ev.preventDefault();
					if (input.length > 0) submitCurrentInput();
					submitSandboxEof();
				} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v') {
					ev.preventDefault();
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
