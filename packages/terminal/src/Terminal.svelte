<script lang="ts">
	import {
		RuntimeProgressController,
		TimeoutError,
		createRuntimeAssetsKey,
		type DebugCommand,
		type DebugSessionEvent,
		type ProgressLike
	} from '@wasm-idle/core';
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal as TerminalType } from '@xterm/xterm';
	import registerAllPlugins from './plugin/index.js';
	import Theme from './theme.js';
	import type {
		BoundSandbox,
		CompilerDiagnostic,
		PlaygroundBinding,
		TerminalControl,
		TerminalExecutionOptions
	} from './types.js';

	interface Props {
		dark?: boolean;
		playground: PlaygroundBinding;
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
		playground,
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
		inputCursor = 0,
		pendingSandboxInput: string[] = [],
		pendingDebugBreakpoints = new Map<string, number[]>(),
		pendingSandboxEof = false,
		sandbox: BoundSandbox,
		sandboxAcceptingInput = false,
		first = true,
		tc = 0,
		plugin = $state(),
		ll: string | null = null,
		loadedRuntimeAssetsKey: string | undefined = undefined,
		stopRequested = false,
		progressLifecycleCounter = 0,
		activeExecutionProgress: ProgressLike | undefined,
		activeExecutionLanguage: string | undefined,
		preparedExecution:
			| {
					key: string;
					sandbox: BoundSandbox;
			  }
			| undefined;
	const progressController = new RuntimeProgressController();
	const terminalOutputReadinessLanguages = new Set([
		'C',
		'CPP',
		'OBJC',
		'RUST',
		'GO',
		'D',
		'CSHARP',
		'FSHARP',
		'VBNET',
		'FORTRAN',
		'COBOL',
		'OCAML',
		'HASKELL'
	]);

	function invalidatePreparedExecution() {
		preparedExecution = undefined;
	}

	function executionPreparationKey(
		language: string,
		code: string,
		log: boolean,
		args: string[],
		options: TerminalExecutionOptions
	) {
		try {
			const keyOptions = { ...options };
			delete keyOptions.signal;
			return JSON.stringify([language, code, log, args, keyOptions]);
		} catch {
			return undefined;
		}
	}

	function activityOnlyProgress(progress: ProgressLike | undefined) {
		if (!progress) return undefined;
		return {
			set: progress.set,
			report: (event: Parameters<NonNullable<ProgressLike['report']>>[0]) => {
				if (event.kind === 'activity') progress.report?.(event);
			}
		} satisfies ProgressLike;
	}

	function writeTerminalOutput(text: string, executionOutput = false) {
		if (!text) return;
		if (
			executionOutput &&
			activeExecutionLanguage &&
			terminalOutputReadinessLanguages.has(activeExecutionLanguage)
		) {
			activeExecutionProgress?.report?.({
				kind: 'ready',
				state: 'running',
				reason: 'stdout',
				label: 'Program output received'
			});
		}
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
		const currentRuntimeAssets = currentPlayground.runtimeAssets;
		const currentRuntimeAssetsKey = createRuntimeAssetsKey(currentRuntimeAssets);
		const requiresSandboxReset =
			ll !== language || loadedRuntimeAssetsKey !== currentRuntimeAssetsKey;
		let _tc = ++tc;
		await wait();
		sandboxAcceptingInput = false;
		if (requiresSandboxReset) invalidatePreparedExecution();
		if (sandbox && requiresSandboxReset) await sandbox.clear();
		input = '';
		inputCursor = 0;
		finish = false;
		if (!sandbox || requiresSandboxReset) {
			sandbox = await currentPlayground.load(language);
			await sandbox.clear();
			ll = language;
			loadedRuntimeAssetsKey = currentRuntimeAssetsKey;
		}
		sandbox.image = onimage;
		sandbox.ondebug = (event) => {
			if (event.type === 'pause') {
				activeExecutionProgress?.report?.({
					kind: 'ready',
					state: 'paused',
					reason: 'debug-paused',
					label: 'Debugger paused'
				});
			}
			ondebug?.(event);
		};
		sandbox.oncompilerdiagnostic = oncompilediagnostic;
		sandbox.output = (output: string) =>
			_tc === tc && writeTerminalOutput(output.replaceAll('\n', '\r\n'), true);
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

	function finishSandboxRun() {
		sandboxAcceptingInput = false;
		stopRequested = false;
		onfinish?.();
		finish = true;
		if (term) term.options.cursorBlink = false;
	}

	function isTimeoutError(error: unknown) {
		return (
			error instanceof TimeoutError ||
			(error instanceof Error && error.name === 'TimeoutError')
		);
	}

	function runSandbox<T>(pr: Promise<T>, reportFinish = true, finalize = true) {
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
				if (isTimeoutError(msg)) {
					writeTerminalOutput(`\r\n\x1B[1;3;31m${msg}\u001B[?25l`);
					throw msg;
				}
				writeTerminalOutput(`\r\n\x1B[1;3;31m${msg}\u001B[?25l`);
				return false;
			})
			.finally(() => {
				if (finalize) finishSandboxRun();
			});
	}

	async function withProgressLifecycle<T>(
		language: string,
		progress: ProgressLike | undefined,
		operation: (progress: ProgressLike | undefined) => Promise<T>
	) {
		const lifecycle = progressController.begin(
			`${language}:${++progressLifecycleCounter}`,
			progress,
			`Loading ${language} runtime`
		);
		try {
			return await operation(lifecycle.progress);
		} finally {
			lifecycle.end();
		}
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
		const inputCharacters = getInputCharacters(input);
		const insertedCharacters = getInputCharacters(text);
		const inputTail = inputCharacters.slice(inputCursor).join('');
		inputCharacters.splice(inputCursor, 0, ...insertedCharacters);
		input = inputCharacters.join('');
		inputCursor += insertedCharacters.length;
		let inputEcho = text;
		if (inputTail && term) {
			inputEcho += inputTail;
			const inputTailCellWidth = getInputCellWidth(inputTail);
			if (inputTailCellWidth > 0) inputEcho += `\x1b[${inputTailCellWidth}D`;
		}
		term?.write(inputEcho);
	}

	function getInputCharacters(text: string) {
		const intlWithSegmenter = Intl as typeof Intl & {
			Segmenter?: new (
				locales?: string | string[],
				options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
			) => { segment(input: string): Iterable<{ segment: string }> };
		};
		return intlWithSegmenter.Segmenter
			? Array.from(
					new intlWithSegmenter.Segmenter(undefined, {
						granularity: 'grapheme'
					}).segment(text),
					({ segment }) => segment
				)
			: Array.from(text);
	}

	function getInputCellWidth(text: string) {
		if (!text) return 0;
		// The public Unicode API selects a provider but does not expose its width functions.
		const unicode = (
			term as
				| (TerminalType & {
						_core?: {
							unicodeService?: {
								getStringCellWidth?: (text: string) => number;
								wcwidth?: (codepoint: number) => 0 | 1 | 2;
							};
						};
				  })
				| undefined
		)?._core?.unicodeService;
		return (
			unicode?.getStringCellWidth?.(text) ??
			Array.from(text).reduce(
				(width, character) =>
					width + (unicode?.wcwidth?.(character.codePointAt(0) || 0) ?? 1),
				0
			)
		);
	}

	function submitCurrentInput() {
		term?.write('\r\n');
		const submittedInput = input + '\n';
		if (sandbox && sandboxAcceptingInput) sandbox.write?.(submittedInput);
		else pendingSandboxInput.push(submittedInput);
		input = '';
		inputCursor = 0;
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
			invalidatePreparedExecution();
			term?.reset();
			term?.write(`\u001B[?25l\x1b[0m\x1b[?25h`);
			if (term) term.options.cursorBlink = false;
			debugOutput = '';
			input = '';
			inputCursor = 0;
			sandboxAcceptingInput = false;
			pendingSandboxEof = false;
			first = true;
			await new Promise((r) => setTimeout(r, 100));
		},
		async prepare(
			language: string,
			code: string,
			log = true,
			prog?: ProgressLike,
			args: string[] = [],
			options: TerminalExecutionOptions = {}
		) {
			return await withProgressLifecycle(language, prog, async (runProgress) => {
				invalidatePreparedExecution();
				const prepareProgress = activityOnlyProgress(runProgress);
				await Promise.all([
					initSandbox(language).then(() =>
						sandbox.load(code, log, args, options, prepareProgress)
					),
					initTerm(false)
				]);
				runProgress?.report?.({
					kind: 'activity',
					phase: 'starting',
					label: `Preparing ${language} program`
				});
				const prepared = !!(await runSandbox(
					sandbox.run(code, true, log, prepareProgress, args, options),
					false
				));
				const preparationKey = executionPreparationKey(language, code, log, args, options);
				if (prepared && preparationKey) {
					preparedExecution = { key: preparationKey, sandbox };
				}
				return prepared;
			});
		},
		async run(
			language: string,
			code: string,
			log = true,
			prog?: ProgressLike,
			args: string[] = [],
			options: TerminalExecutionOptions = {}
		) {
			return await withProgressLifecycle(language, prog, async (runProgress) => {
				let executionRunWillFinalize = false;
				pendingDebugBreakpoints.clear();
				for (const { sourcePath, lines } of options.sourceBreakpoints || []) {
					pendingDebugBreakpoints.set(sourcePath, [...lines]);
				}
				await Promise.all([
					initSandbox(language).then(() => sandbox.load(code, log, args, options)),
					initTerm()
				]);
				const executionOptions = {
					...options,
					sourceBreakpoints: Array.from(
						pendingDebugBreakpoints,
						([sourcePath, lines]) => ({
							sourcePath,
							lines: [...lines]
						})
					)
				};
				const preparationKey = executionPreparationKey(language, code, log, args, options);
				const mayUsePreparedOutput =
					!!preparationKey &&
					preparedExecution?.sandbox === sandbox &&
					preparedExecution.key === preparationKey;
				invalidatePreparedExecution();
				try {
					if (terminalOutputReadinessLanguages.has(language) && !mayUsePreparedOutput) {
						const prepareProgress = activityOnlyProgress(runProgress);
						runProgress?.report?.({
							kind: 'activity',
							phase: 'starting',
							label: `Preparing ${language} program`
						});
						const prepared = !!(await runSandbox(
							sandbox.run(code, true, log, prepareProgress, args, options),
							false,
							false
						));
						if (!prepared) {
							runProgress?.report?.({
								kind: 'settled',
								outcome: options.signal?.aborted ? 'cancelled' : 'failed',
								label: `${language} run ended`
							});
							return false;
						}
					}

					activeExecutionProgress = runProgress;
					activeExecutionLanguage = language;
					sandboxAcceptingInput = true;
					flushPendingSandboxInput();
					executionRunWillFinalize = true;
					const result = await runSandbox(
						sandbox.run(code, false, log, runProgress, args, executionOptions)
					);
					if (result === false) {
						runProgress?.report?.({
							kind: 'settled',
							outcome: options.signal?.aborted ? 'cancelled' : 'failed',
							label: `${language} run ended`
						});
					} else {
						runProgress?.report?.({
							kind: 'ready',
							state: 'running',
							reason: 'result',
							label: `${language} run completed`
						});
						runProgress?.report?.({
							kind: 'settled',
							outcome: 'completed',
							label: `${language} run completed`
						});
					}
					return result;
				} catch (error) {
					if (isTimeoutError(error)) {
						runProgress?.report?.({
							kind: 'settled',
							outcome: 'timed-out',
							label: `${language} run timed out`
						});
					}
					throw error;
				} finally {
					if (!executionRunWillFinalize) finishSandboxRun();
					if (activeExecutionProgress === runProgress) {
						activeExecutionProgress = undefined;
						activeExecutionLanguage = undefined;
					}
				}
			});
		},
		async destroy() {
			await wait();
			progressController.invalidate();
			invalidatePreparedExecution();
			sandboxAcceptingInput = false;
			pendingSandboxEof = false;
			term?.dispose();
			if (sandbox) await sandbox.clear();
		},
		async restartRuntime() {
			await wait();
			if (!sandbox) return;
			progressController.invalidate();
			invalidatePreparedExecution();
			sandboxAcceptingInput = false;
			pendingSandboxInput = [];
			pendingSandboxEof = false;
			input = '';
			inputCursor = 0;
			finish = true;
			stopRequested = false;
			tc += 1;
			if (sandbox.restart) await sandbox.restart();
			else await sandbox.clear();
		},
		async stop() {
			await wait();
			progressController.invalidate();
			invalidatePreparedExecution();
			stopRequested = true;
			finish = true;
			sandboxAcceptingInput = false;
			pendingSandboxEof = false;
			if (sandbox?.kill) await sandbox.kill();
			else await sandbox?.terminate?.();
		},
		async debugCommand(command: DebugCommand) {
			await wait();
			await sandbox.debugCommand?.(command);
		},
		async debugPause() {
			await wait();
			await sandbox.debugPause?.();
		},
		async setBreakpoints(lines: number[], sourcePath?: string) {
			pendingDebugBreakpoints.set(sourcePath || '', [...lines]);
			await wait();
			await sandbox?.setBreakpoints?.(lines, sourcePath);
		},
		async debugEvaluate(expression: string) {
			await wait();
			return (await sandbox.debugEvaluate?.(expression)) || '?';
		},
		async debugVariables(variablesReference: number, start?: number, count?: number) {
			await wait();
			return (await sandbox.debugVariables?.(variablesReference, start, count)) || [];
		},
		async debugScopes(frameId: number) {
			await wait();
			return (await sandbox.debugScopes?.(frameId)) ?? [];
		},
		async debugReadMemory(memoryReference: string, offset: number, count: number) {
			await wait();
			return (await sandbox.debugReadMemory?.(memoryReference, offset, count)) ?? null;
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
				for (let i = 0; i < data.length; ) {
					const escapeSequence = data.slice(i).match(/^\x1b(?:\[[0-9;?]*[ABCD]|O[ABCD])/);
					if (escapeSequence) {
						if (pendingText) {
							appendInputText(pendingText);
							pendingText = '';
						}
						const direction = escapeSequence[0].at(-1);
						const inputCharacters = getInputCharacters(input);
						if (direction === 'D' && inputCursor > 0) {
							const inputCharacter = inputCharacters[inputCursor - 1];
							const inputCharacterCellWidth = getInputCellWidth(inputCharacter);
							if (inputCharacterCellWidth > 0)
								term.write(`\x1b[${inputCharacterCellWidth}D`);
							inputCursor--;
						} else if (direction === 'C' && inputCursor < inputCharacters.length) {
							const inputCharacter = inputCharacters[inputCursor];
							const inputCharacterCellWidth = getInputCellWidth(inputCharacter);
							if (inputCharacterCellWidth > 0)
								term.write(`\x1b[${inputCharacterCellWidth}C`);
							inputCursor++;
						}
						i += escapeSequence[0].length;
						continue;
					}
					const codePoint = data.codePointAt(i);
					if (codePoint === undefined) break;
					const chunk = String.fromCodePoint(codePoint);
					i += chunk.length;
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
						if (inputCursor > 0) {
							const inputCharacters = getInputCharacters(input);
							const removedInput = inputCharacters.splice(inputCursor - 1, 1)[0];
							if (removedInput) {
								inputCursor--;
								const inputTail = inputCharacters.slice(inputCursor).join('');
								const removedInputCellWidth = getInputCellWidth(removedInput);
								const inputTailCellWidth = getInputCellWidth(inputTail);
								let backspaceEcho = '';
								if (removedInputCellWidth > 0)
									backspaceEcho += `\x1b[${removedInputCellWidth}D`;
								if (inputTail) backspaceEcho += inputTail;
								if (removedInputCellWidth > 0)
									backspaceEcho += ' '.repeat(removedInputCellWidth);
								const cursorReturnCellWidth =
									inputTailCellWidth + removedInputCellWidth;
								if (cursorReturnCellWidth > 0)
									backspaceEcho += `\x1b[${cursorReturnCellWidth}D`;
								if (backspaceEcho) term.write(backspaceEcho);
								input = inputCharacters.join('');
							}
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
			progressController.invalidate();
			invalidatePreparedExecution();
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
