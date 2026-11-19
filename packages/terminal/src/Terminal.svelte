<script lang="ts">
	import {
		RuntimeProgressController,
		TimeoutError,
		createRuntimeAssetsKey,
		normalizeDebugSourceBreakpoints,
		mergeDebugBreakpointLines,
		assertDebugBreakpointSupport,
		normalizeDebugSteppingOptions,
		type DebugEvaluateOptions,
		type DebugSourceBreakpoint,
		type DebugSteppingOptions,
		type DebugCommand,
		type DebugDataBreakpoint,
		type DebugDataBreakpointInfoArguments,
		type DebugSessionEvent,
		type ProgressLike
	} from '@wasm-idle/core';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import '@xterm/xterm/css/xterm.css';
	import type { IMarker, Terminal as TerminalType } from '@xterm/xterm';
	import { loadWebglPlugin, registerBasicPlugins } from './plugin/index.js';
	import { fitAtInputOrigin, InputLineLayout, revealScrolledInput } from './input-line-layout.js';
	import Theme from './theme.js';
	import { createReadlineOutput } from './readline-output.js';
	import type {
		BoundSandbox,
		CompilerDiagnostic,
		PlaygroundBinding,
		TerminalControl,
		TerminalExecutionOptions,
		TerminalShellBinding
	} from './types.js';

	interface Props {
		dark?: boolean;
		playground: PlaygroundBinding;
		/** Share this terminal with a real shell while no Run or Debug operation owns stdin. */
		shell?: TerminalShellBinding;
		font?: string;
		/** Load the optional WebGL renderer after the terminal is ready. */
		webgl?: boolean;

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
		shell,
		font = "'D2 coding', monospace",
		webgl = false,
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
		pendingDebugBreakpoints = new SvelteMap<string, number[]>(),
		pendingDebugSpecifications = new Map<string, DebugSourceBreakpoint[]>(),
		pendingSandboxEof = false,
		sandboxInputGeneration = 0,
		sandbox: BoundSandbox,
		sandboxAcceptingInput = false,
		first = true,
		tc = 0,
		plugin = $state<Awaited<ReturnType<typeof registerBasicPlugins>>>(),
		ll: string | null = null,
		loadedRuntimeAssetsKey: string | undefined = undefined,
		loadedPlayground: PlaygroundBinding | undefined = undefined,
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
	let preparedExecutionGeneration = 0;
	let lastExecutionError: unknown;
	let executionInputOwners = 0;
	let inputStartColumn = 0;
	let inputStartMarker: IMarker | undefined;
	let visibleInputLength: number | undefined;
	// A string continues the program byte stream; null starts a new terminal
	// message and cancels any incomplete sequence left by a finished program.
	type ScreenUpdate = { apply: (output?: string) => void; output?: string | null };
	let pendingScreenUpdates: ScreenUpdate[] | undefined;
	let continueProgramOutput: ((text: string) => void) | undefined;
	let reservedInput: { queued?: Array<() => void>; interrupt: () => void } | undefined;
	let terminalDisposed = false;
	let abortInitialization: (() => void) | undefined;
	let terminalDisposal: Promise<void> | undefined;
	let connectedShell: TerminalShellBinding | undefined;
	let shellConnection: Promise<void> | undefined;
	let readlineOutput: ReturnType<typeof createReadlineOutput> | undefined;
	let shellInput = Promise.resolve();
	const shellDisposals = new Map<TerminalShellBinding, Promise<void>>();
	const progressController = new RuntimeProgressController();
	const maxDebugOutputCharacters = 64 * 1024;
	const terminalOutputReadinessLanguages = new Set([
		'C',
		'CPP',
		'OBJC',
		'OBJECTIVECXX',
		'RUST',
		'GO',
		'D',
		'CSHARP',
		'FSHARP',
		'VBNET',
		'FORTRAN',
		'COBOL',
		'V',
		'OCAML',
		'HASKELL'
	]);

	function clearPreparedExecution() {
		preparedExecution = undefined;
	}

	function invalidatePreparedExecution() {
		preparedExecutionGeneration += 1;
		clearPreparedExecution();
		return preparedExecutionGeneration;
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
		const tail =
			text.length >= maxDebugOutputCharacters
				? text.slice(-maxDebugOutputCharacters)
				: (debugOutput + text).slice(-maxDebugOutputCharacters);
		// Keep a bounded debug tail without starting in the middle of a surrogate pair.
		debugOutput = /^[\uDC00-\uDFFF]/.test(tail) ? tail.slice(1) : tail;
		const characters = executionOutput && input ? getInputCharacters(input) : [];
		const cursor = inputCursor;
		updateScreen(
			(output = text) => {
				if (!term || !characters.length) {
					term?.write(output);
					return;
				}
				atInputOrigin(characters, cursor, () => {
					afterScreenWrite(output, (current) =>
						paintDraft(current, characters, cursor, current.buffer.active.cursorX)
					);
				});
			},
			executionOutput ? text : null
		);
	}

	function reportShellError(error: unknown) {
		if (terminalDisposed) return;
		const message = error instanceof Error ? error.message : String(error);
		writeTerminalOutput(`\r\n\x1b[31mShell: ${message}\x1b[0m\r\n`);
	}

	function disposeShell(binding: TerminalShellBinding) {
		let disposal = shellDisposals.get(binding);
		if (!disposal) {
			disposal = Promise.resolve().then(() => binding.dispose());
			shellDisposals.set(binding, disposal);
		}
		return disposal;
	}

	function connectShell(binding: TerminalShellBinding) {
		if (terminalDisposed) return Promise.reject(new Error('Terminal has been disposed'));
		if (connectedShell === binding && shellConnection) return shellConnection;
		const previous = connectedShell;
		connectedShell = binding;
		readlineOutput?.dispose();
		readlineOutput = term && createReadlineOutput(term, writeTerminalOutput, () =>
			!terminalDisposed && connectedShell === binding && finish && executionInputOwners === 0
		);
		let previousCarriageReturn = false;
		shellConnection = Promise.resolve().then(() => {
			if (terminalDisposed || connectedShell !== binding) return;
			return binding.connect(
				(text) => {
					if (terminalDisposed || connectedShell !== binding || !text) return;
					const output = text.replace(/\r\n|\n/g, (newline, offset: number) =>
						newline === '\r\n' || (offset === 0 && previousCarriageReturn)
							? newline
							: '\r\n'
					);
					previousCarriageReturn = text.endsWith('\r');
					if (readlineOutput) readlineOutput.write(output);
					else writeTerminalOutput(output);
				},
				(error) => {
					if (connectedShell === binding) reportShellError(error);
				}
			);
		});
		void shellConnection.catch((error) => {
			if (connectedShell === binding) reportShellError(error);
		});
		if (previous) void disposeShell(previous).catch(reportShellError);
		return shellConnection;
	}

	function sendShellInput(binding: TerminalShellBinding, text: string) {
		const connection = connectShell(binding);
		// Interrupts use the control path even when a prior stdin write is blocked.
		if (text === '\u0003')
			return connection.then(async () => {
				if (!terminalDisposed && connectedShell === binding) await binding.interrupt();
			});
		const operation = shellInput
			.catch(() => {})
			.then(async () => {
				await connection;
				if (terminalDisposed || connectedShell !== binding) return;
				for (const chunk of text.split(/([\u0003\u0004])/)) {
					if (chunk === '\u0003') await binding.interrupt();
					else if (chunk === '\u0004') await binding.eof();
					else if (chunk) await binding.write(chunk);
				}
			});
		shellInput = operation;
		return operation;
	}

	function disposeTerminal() {
		return (terminalDisposal ??= (async () => {
			terminalDisposed = true;
			readlineOutput?.dispose();
			abortInitialization?.();
			progressController.invalidate();
			invalidatePreparedExecution();
			sandboxAcceptingInput = false;
			discardPendingSandboxInput();
			const cleanups = [Promise.resolve().then(() => term?.dispose())];
			if (sandbox) cleanups.push(Promise.resolve().then(() => sandbox.clear()));
			if (connectedShell) cleanups.push(disposeShell(connectedShell));
			cleanups.push(...shellDisposals.values());
			const results = await Promise.allSettled(cleanups);
			discardPendingSandboxInput();
			const errors = results
				.filter((result) => result.status === 'rejected')
				.map((result) => result.reason);
			if (errors.length) throw new AggregateError(errors, 'Terminal cleanup failed');
		})());
	}

	function wait() {
		if (terminalDisposed) return Promise.reject(new Error('Terminal has been disposed'));
		if (term) return Promise.resolve();
		return new Promise<void>((r, reject) => {
			const i = setInterval(() => {
				if (terminalDisposed) {
					clearInterval(i);
					reject(new Error('Terminal has been disposed'));
					return;
				}
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
			ll !== language ||
			loadedRuntimeAssetsKey !== currentRuntimeAssetsKey ||
			loadedPlayground !== currentPlayground;
		let _tc = ++tc;
		await wait();
		sandboxAcceptingInput = false;
		if (requiresSandboxReset) clearPreparedExecution();
		if (sandbox && requiresSandboxReset) {
			discardPendingSandboxInput();
			await sandbox.clear();
			discardPendingSandboxInput();
		}
		input = '';
		inputCursor = 0;
		finish = false;
		if (!sandbox || requiresSandboxReset) {
			sandbox = await currentPlayground.load(language);
			await sandbox.clear();
			ll = language;
			loadedRuntimeAssetsKey = currentRuntimeAssetsKey;
			loadedPlayground = currentPlayground;
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
		return requiresSandboxReset;
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

	function discardPendingSandboxInput() {
		sandboxInputGeneration += 1;
		pendingSandboxInput = [];
		pendingSandboxEof = false;
	}

	function submitSandboxEof() {
		if (input.length > 0) submitCurrentInput();
		if (sandbox && sandboxAcceptingInput) sandbox.eof?.();
		else pendingSandboxEof = true;
	}

	function finishSandboxRun() {
		sandboxAcceptingInput = false;
		input = '';
		inputCursor = 0;
		stopRequested = false;
		onfinish?.();
		finish = true;
		if (term) {
			term.options.cursorBlink = Boolean(shell);
			if (shell) writeTerminalOutput('\r\n\u001B[?25h');
		}
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
				lastExecutionError = msg;
				if (stopRequested) return false;
				const message = String(msg).replace(/\r\n|\n/g, '\r\n');
				writeTerminalOutput(`\r\n\x1B[1;3;31m${message}\u001B[?25l`);
				if (isTimeoutError(msg)) throw msg;
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
		executionInputOwners += 1;
		const lifecycle = progressController.begin(
			`${language}:${++progressLifecycleCounter}`,
			progress,
			`Loading ${language} runtime`
		);
		try {
			return await operation(lifecycle.progress);
		} finally {
			executionInputOwners -= 1;
			lifecycle.end();
		}
	}

	async function initTerm(blink = true) {
		await wait();
		if (!term) return;
		term.options.cursorBlink = blink;
		writeScreen('\u001B[?25h');
		term.focus();

		if (!first) writeScreen(`\r\n\x1b[0m`);
		first = false;
	}

	function updateScreen(apply: ScreenUpdate['apply'], output?: string | null) {
		if (continueProgramOutput && output !== undefined) {
			continueProgramOutput(output ?? '\x18');
			if (output !== null) return;
		}
		const previous = pendingScreenUpdates?.at(-1);
		if (typeof output === 'string' && typeof previous?.output === 'string') {
			previous.output += output;
		} else if (pendingScreenUpdates) pendingScreenUpdates.push({ apply, output });
		else apply(output ?? undefined);
	}

	function writeScreen(text: string) {
		updateScreen(() => term?.write(text));
	}

	function afterScreenWrite(text: string, action: (current: TerminalType) => void) {
		const current = term;
		if (!current) return;
		// xterm parses writes asynchronously. Keep echo, cursor measurements,
		// resizes and subsequent output in the same order as their producers.
		const updates: ScreenUpdate[] = [];
		pendingScreenUpdates = updates;
		const parsed = () => {
			if (terminalDisposed) {
				pendingScreenUpdates = undefined;
				return;
			}
			// Cursor controls and input echo must never be inserted in the middle
			// of a program's VT sequence or surrogate pair. xterm exposes parser
			// handlers publicly, but only its input handler exposes these states.
			const handler = (
				current as TerminalType & {
					_core?: {
						_inputHandler?: {
							_parser?: { currentState: number; initialState: number };
							_stringDecoder?: { _interim: number };
						};
					};
				}
			)._core?._inputHandler;
			if (
				handler?._parser?.currentState !== handler?._parser?.initialState ||
				handler?._stringDecoder?._interim
			) {
				continueProgramOutput = (next) => {
					continueProgramOutput = undefined;
					current.write(next, parsed);
				};
				const next = updates.findIndex((update) => update.output !== undefined);
				if (next >= 0) {
					const continuation = updates[next].output;
					if (continuation !== null) updates.splice(next, 1);
					continueProgramOutput(continuation ?? '\x18');
				}
				return;
			}
			pendingScreenUpdates = undefined;
			action(current);
			for (const update of updates) updateScreen(update.apply, update.output);
		};
		current.write(text, parsed);
	}

	function captureInputStart() {
		updateScreen(() =>
			afterScreenWrite('', (current) => {
				setInputOrigin(current, current.buffer.active.cursorX);
			})
		);
	}

	function setInputOrigin(current: TerminalType, column: number) {
		inputStartColumn = column;
		visibleInputLength = undefined;
		inputStartMarker?.dispose();
		// A fit can put the cursor at the next row's first cell for a prompt
		// that ended at the right margin of the previous row.
		const rowOffset = column === current.cols && !current.buffer.active.cursorX ? -1 : 0;
		inputStartMarker = current.registerMarker?.(rowOffset);
	}

	function atInputOrigin(
		characters: string[],
		cursor: number,
		action: (current: TerminalType) => void
	) {
		const current = term!;
		const painted =
			visibleInputLength === undefined ? characters : characters.slice(0, visibleInputLength);
		const old = inputLayout(painted);
		const erase = (scrolledColumn?: number) => {
			const column = scrolledColumn ?? inputStartColumn;
			// CHA cannot restore xterm's pending wrap one cell past the final column.
			const wrapped =
				column === current.cols
					? (
							current as TerminalType & {
								_core?: { buffers?: { active: { x: number } } };
							}
						)._core?.buffers?.active
					: undefined;
			const clear =
				scrolledColumn === undefined
					? inputLayout([]).redraw(old.rowAt(cursor), old.end, 0, 0)
					: (wrapped ? '\x1b[2;1H' : `\x1b[1;${column + 1}H`) + '\x1b[J';
			afterScreenWrite(clear + (wrapped ? '\x1b[A' : ''), (parsed) => {
				if (wrapped) wrapped.x = parsed.cols;
				action(parsed);
			});
		};
		if (old.rowAfterPrefix(painted.length) >= current.rows) {
			// A paste can still be in xterm's write queue when output arrives.
			afterScreenWrite('', () =>
				erase(revealScrolledInput(current, inputStartMarker, inputStartColumn))
			);
		} else erase();
	}

	function paintDraft(
		current: TerminalType,
		characters: string[],
		cursor: number,
		column: number
	) {
		setInputOrigin(current, column);
		const layout = inputLayout(characters);
		const end = layout.visibleLength(cursor, current.rows);
		if (end < characters.length) visibleInputLength = end;
		const shown = visibleInputLength === undefined ? characters : characters.slice(0, end);
		current.write(
			shown.join('') +
				(cursor === end ? '' : layout.moveTo(layout.rowAfterPrefix(end), cursor))
		);
	}

	function inputLayout(characters: string[]) {
		return new InputLineLayout(characters, term!.cols, inputStartColumn, getInputCellWidth);
	}

	function redrawInput(previous: string[], previousCursor: number, changed: number) {
		const characters = getInputCharacters(input);
		const cursor = inputCursor;
		// A combining mark can change the grapheme just before the insertion.
		if (changed && previous[changed - 1] !== characters[changed - 1]) changed--;
		updateScreen(() => {
			const next = inputLayout(characters);
			if (
				visibleInputLength !== undefined ||
				next.visibleLength(cursor, term!.rows) < characters.length
			) {
				atInputOrigin(previous, previousCursor, (current) =>
					paintDraft(current, characters, cursor, current.buffer.active.cursorX)
				);
				return;
			}
			const old = inputLayout(previous);
			term?.write(next.redraw(old.rowAt(previousCursor), old.end, changed, cursor));
		});
	}

	function appendInputText(text: string) {
		if (!text) return;
		const characters = getInputCharacters(input);
		const previousCursor = inputCursor;
		if (!input) captureInputStart();
		const prefix = characters.slice(0, previousCursor).join('') + text;
		input = prefix + characters.slice(previousCursor).join('');
		inputCursor = getInputCharacters(prefix).length;
		if (previousCursor === characters.length) writeScreen(text);
		else redrawInput(characters, previousCursor, previousCursor);
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

	function getInputCellWidth(text: string, offset: number) {
		if (!text) return 0;
		// xterm exposes neither Unicode cell widths nor the active VT tab stops publicly.
		const core = (
			term as
				| (TerminalType & {
						_core?: {
							buffers?: { active: { nextStop(column: number): number } };
							unicodeService?: {
								getStringCellWidth?: (text: string) => number;
								wcwidth?: (codepoint: number) => 0 | 1 | 2;
							};
						};
				  })
				| undefined
		)?._core;
		if (text === '\t' && term) {
			const column = offset % term.cols;
			if (offset > 0 && column === 0) return 0;
			const step = term.options.tabStopWidth || 8;
			const next =
				core?.buffers?.active.nextStop(column) ??
				Math.min(term.cols - 1, column + step - (column % step));
			return next - column;
		}
		const unicode = core?.unicodeService;
		return (
			unicode?.getStringCellWidth?.(text) ??
			Array.from(text).reduce(
				(width, character) =>
					width + (unicode?.wcwidth?.(character.codePointAt(0) || 0) ?? 1),
				0
			)
		);
	}

	function moveInputCursor(characters: string[], position: number) {
		if (inputCursor === position) return;
		const previousCursor = inputCursor;
		inputCursor = position;
		updateScreen(() => {
			const layout = inputLayout(characters);
			if (
				layout.visibleLength(position, term!.rows) !==
				(visibleInputLength ?? characters.length)
			) {
				atInputOrigin(characters, previousCursor, (current) =>
					paintDraft(current, characters, position, current.buffer.active.cursorX)
				);
				return;
			}
			term?.write(layout.moveTo(layout.rowAt(previousCursor), position));
		});
	}

	function eraseInputCharacter(characters: string[], position: number) {
		if (position < 0 || position >= characters.length) return;
		const previousCursor = inputCursor;
		input = characters
			.slice(0, position)
			.concat(characters.slice(position + 1))
			.join('');
		inputCursor = position;
		redrawInput(characters, previousCursor, position);
	}

	function handleInputKey(key: string) {
		const characters = getInputCharacters(input);
		switch (key) {
			case 'D':
				return moveInputCursor(characters, Math.max(0, inputCursor - 1));
			case 'C':
				return moveInputCursor(characters, Math.min(characters.length, inputCursor + 1));
			case 'H':
			case '1~':
			case '7~':
				return moveInputCursor(characters, 0);
			case 'F':
			case '4~':
			case '8~':
				return moveInputCursor(characters, characters.length);
			case '3~':
				return eraseInputCharacter(characters, inputCursor);
		}
	}

	function submitCurrentInput() {
		const characters = getInputCharacters(input);
		moveInputCursor(characters, characters.length);
		writeScreen('\r\n');
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

	function whenInputReady(write: () => void) {
		if (reservedInput?.queued) reservedInput.queued.push(write);
		else write();
	}

	function writeProgramInput(text: string) {
		applyPastedText(text);
		if (!text.endsWith('\n') && !text.endsWith('\r')) submitCurrentInput();
	}

	async function waitForInput() {
		await wait();
		if (finish && executionInputOwners === 0 && shell) await connectShell(shell);
	}

	const terminalControl: TerminalControl = {
		getExecutionError: () => lastExecutionError,
		reserveInput(interrupt) {
			const reservation = { queued: [] as Array<() => void>, interrupt };
			if (!reservedInput) executionInputOwners++;
			reservedInput = reservation;
			return () => {
				if (reservedInput !== reservation) return;
				reservedInput = undefined;
				executionInputOwners--;
			};
		},
		async clear() {
			await wait();
			lastExecutionError = undefined;
			invalidatePreparedExecution();
			discardPendingSandboxInput();
			updateScreen(() => term?.reset(), null);
			writeScreen(`\u001B[?25l\x1b[0m\x1b[?25h`);
			if (term) term.options.cursorBlink = false;
			debugOutput = '';
			input = '';
			inputCursor = 0;
			sandboxAcceptingInput = false;
			first = true;
			await new Promise((r) => setTimeout(r, 100));
			discardPendingSandboxInput();
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
				const preparationGeneration = invalidatePreparedExecution();
				const prepareProgress = activityOnlyProgress(runProgress);
				await Promise.all([
					initSandbox(language).then(() =>
						sandbox.load(code, log, args, options, prepareProgress)
					),
					initTerm(false)
				]);
				const preparationSandbox = sandbox;
				runProgress?.report?.({
					kind: 'activity',
					phase: 'starting',
					label: `Preparing ${language} program`
				});
				const prepared = !!(await runSandbox(
					preparationSandbox.run(code, true, log, prepareProgress, args, options),
					false
				));
				const preparationKey = executionPreparationKey(language, code, log, args, options);
				if (
					prepared &&
					preparationKey &&
					preparationGeneration === preparedExecutionGeneration &&
					preparationSandbox === sandbox
				) {
					preparedExecution = { key: preparationKey, sandbox: preparationSandbox };
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
				const preparedCandidate = preparedExecution;
				const executionGeneration = invalidatePreparedExecution();
				pendingDebugBreakpoints.clear();
				pendingDebugSpecifications.clear();
				for (const { sourcePath, lines, breakpoints } of options.sourceBreakpoints || []) {
					const values = breakpoints
						? normalizeDebugSourceBreakpoints(breakpoints)
						: undefined;
					pendingDebugBreakpoints.set(
						sourcePath,
						values
							? values
									.filter((value) => value.enabled !== false)
									.map((value) => value.line)
							: [...lines]
					);
					if (values) pendingDebugSpecifications.set(sourcePath, values);
				}
				const [sandboxWasReset] = await Promise.all([
					initSandbox(language).then(async (wasReset) => {
						await sandbox.load(
							code,
							log,
							args,
							options,
							activityOnlyProgress(runProgress)
						);
						return wasReset;
					}),
					initTerm()
				]);
				if (!sandbox.setSourceBreakpoints)
					for (const values of pendingDebugSpecifications.values())
						assertDebugBreakpointSupport(values, {});
				const executionOptions = {
					...options,
					sourceBreakpoints: Array.from(
						pendingDebugBreakpoints,
						([sourcePath, lines]) => ({
							sourcePath,
							lines: [...lines],
							...(pendingDebugSpecifications.has(sourcePath)
								? {
										breakpoints: normalizeDebugSourceBreakpoints(
											pendingDebugSpecifications.get(sourcePath)!
										)
									}
								: {})
						})
					)
				};
				const preparationKey = executionPreparationKey(language, code, log, args, options);
				const mayUsePreparedOutput =
					executionGeneration === preparedExecutionGeneration &&
					!sandboxWasReset &&
					!!preparationKey &&
					preparedCandidate?.sandbox === sandbox &&
					preparedCandidate.key === preparationKey;
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
					if (reservedInput?.queued) {
						const queued = reservedInput.queued;
						reservedInput.queued = undefined;
						for (const write of queued) write();
					}
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
			await disposeTerminal();
		},
		async restartRuntime() {
			await wait();
			if (!sandbox) return;
			progressController.invalidate();
			invalidatePreparedExecution();
			sandboxAcceptingInput = false;
			discardPendingSandboxInput();
			input = '';
			inputCursor = 0;
			finish = true;
			stopRequested = false;
			tc += 1;
			if (sandbox.restart) await sandbox.restart();
			else await sandbox.clear();
			discardPendingSandboxInput();
		},
		async stop() {
			await wait();
			progressController.invalidate();
			invalidatePreparedExecution();
			stopRequested = true;
			finish = true;
			sandboxAcceptingInput = false;
			input = '';
			inputCursor = 0;
			discardPendingSandboxInput();
			if (sandbox?.kill) await sandbox.kill();
			else await sandbox?.terminate?.();
			discardPendingSandboxInput();
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
			const existing = pendingDebugSpecifications.get(sourcePath || '');
			if (existing)
				return terminalControl.setSourceBreakpoints!(
					mergeDebugBreakpointLines(existing, lines),
					sourcePath
				);
			pendingDebugBreakpoints.set(sourcePath || '', [...lines]);
			pendingDebugSpecifications.delete(sourcePath || '');
			await wait();
			await sandbox?.setBreakpoints?.(lines, sourcePath);
		},
		async setSourceBreakpoints(breakpoints: DebugSourceBreakpoint[], sourcePath?: string) {
			const values = normalizeDebugSourceBreakpoints(breakpoints);
			pendingDebugSpecifications.set(sourcePath || '', values);
			pendingDebugBreakpoints.set(
				sourcePath || '',
				values.filter((value) => value.enabled !== false).map((value) => value.line)
			);
			await wait();
			if (sandbox?.setSourceBreakpoints)
				await sandbox.setSourceBreakpoints(values, sourcePath);
			else {
				assertDebugBreakpointSupport(values, {});
				await sandbox?.setBreakpoints?.(
					values.filter((value) => value.enabled !== false).map((value) => value.line),
					sourcePath
				);
			}
		},
		async debugSetSteppingOptions(options: DebugSteppingOptions) {
			const value = normalizeDebugSteppingOptions(options);
			await wait();
			if (!sandbox.debugSetSteppingOptions)
				throw new Error('Debugger does not support stepping options.');
			await sandbox.debugSetSteppingOptions(value);
		},
		async debugEvaluateValue(expression: string, options?: DebugEvaluateOptions) {
			await wait();
			if (sandbox?.debugEvaluateValue)
				return await sandbox.debugEvaluateValue(expression, options);
			if (options?.frameId !== undefined || options?.context === 'hover')
				return { result: '?', variablesReference: 0 };
			return {
				result: (await sandbox.debugEvaluate?.(expression)) ?? '?',
				variablesReference: 0
			};
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
		async debugFrameScopes(frameId: number) {
			await wait();
			return (await sandbox.debugFrameScopes?.(frameId)) ?? [];
		},
		async debugFrameName(frameId: number) {
			await wait();
			return (await sandbox.debugFrameName?.(frameId)) ?? null;
		},
		async debugReadMemory(memoryReference: string, offset: number, count: number) {
			await wait();
			return (await sandbox.debugReadMemory?.(memoryReference, offset, count)) ?? null;
		},
		async debugWriteMemory(
			memoryReference: string,
			offset: number,
			data: Uint8Array,
			allowPartial?: boolean
		) {
			await wait();
			return (
				(await sandbox.debugWriteMemory?.(memoryReference, offset, data, allowPartial)) ??
				null
			);
		},
		async debugDataBreakpointInfo(arguments_: DebugDataBreakpointInfoArguments) {
			await wait();
			return (await sandbox.debugDataBreakpointInfo?.(arguments_)) ?? null;
		},
		async debugSetDataBreakpoints(breakpoints: DebugDataBreakpoint[]) {
			await wait();
			return (await sandbox.debugSetDataBreakpoints?.(breakpoints)) ?? [];
		},
		async waitForInput() {
			await waitForInput();
		},
		async write(input: string) {
			if (reservedInput?.queued) {
				if (input) reservedInput.queued.push(() => writeProgramInput(input));
				return;
			}
			const shellTarget = finish && executionInputOwners === 0 ? shell : undefined;
			await waitForInput();
			if (!input) return;
			if (shellTarget) return await sendShellInput(shellTarget, input);
			writeProgramInput(input);
		},
		async eof() {
			if (reservedInput?.queued) {
				reservedInput.queued.push(submitSandboxEof);
				return;
			}
			const shellTarget = finish && executionInputOwners === 0 ? shell : undefined;
			await waitForInput();
			if (shellTarget) return await sendShellInput(shellTarget, '\u0004');
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
		if (!plugin || !term || terminalDisposed) return;
		const binding = shell;
		const resizeShell = (current: TerminalType) => {
			if (!binding || shell !== binding) return;
			void binding.resize?.(current.cols, current.rows).catch((error) => {
				if (connectedShell === binding) reportShellError(error);
			});
			void connectShell(binding).catch(() => {});
		};
		const fit = plugin.fit;
		const nextSize = fit?.proposeDimensions?.();
		if (fit && nextSize && nextSize.cols !== term.cols && input && !finish) {
			const characters = getInputCharacters(input);
			const cursor = inputCursor;
			updateScreen(() =>
				atInputOrigin(characters, cursor, (current) => {
					const column = fitAtInputOrigin(current, () => fit.fit());
					afterScreenWrite('', () => paintDraft(current, characters, cursor, column));
					resizeShell(current);
				})
			);
			return;
		}
		// Readline redraws relative to its old cursor row. xterm can move that row
		// when other lines reflow, even with reflowCursorLine disabled.
		const buffer =
			binding?.resize &&
			nextSize &&
			nextSize.cols !== term.cols &&
			finish &&
			executionInputOwners === 0 &&
			term.modes.bracketedPasteMode
				? term.buffer.active
				: undefined;
		const marker = buffer?.type === 'normal' ? term.registerMarker(0) : undefined;
		const column = buffer?.cursorX ?? 0;
		plugin.fit?.fit();
		if (marker && buffer) {
			const row = marker.line - buffer.baseY;
			if (!marker.isDisposed && row >= 0 && row < term.rows) {
				term.write(`\x1b[${row + 1};${Math.min(column + 1, term.cols)}H`);
			}
			marker.dispose();
		}
		resizeShell(term);
	});

	$effect(() => {
		terminal = terminalControl;
	});

	onMount(() => {
		const initialization = new AbortController();
		abortInitialization = () => initialization.abort();
		import('@xterm/xterm')
			.then(async ({ Terminal }) => {
				if (!ref || initialization.signal.aborted) return;
				term = new Terminal({
					theme: dark ? Theme.Tango_Dark : Theme.Tango_Light,
					cursorBlink: false,
					allowTransparency: true,
					fontFamily: font,
					allowProposedApi: true
				});
				term.open(ref);
				term.attachCustomKeyEventHandler((event) => {
					// Stop xterm before onKey emits Ctrl+C through onData. Leave the browser's
					// native copy event enabled so xterm can copy without Clipboard API permission.
					return !(
						event.type === 'keydown' &&
						(event.ctrlKey || event.metaKey) &&
						event.key.toLowerCase() === 'c' &&
						term?.hasSelection()
					);
				});
				term.onData(function receiveInput(data: string) {
					if (!term || terminalDisposed) return;
					if (reservedInput?.queued) {
						reservedInput.queued.push(() => receiveInput(data));
						return;
					}
					if (finish && executionInputOwners === 0) {
						if (shell) void sendShellInput(shell, data).catch(reportShellError);
						return;
					}
					let pendingText = '';
					for (let i = 0; i < data.length;) {
						// Match a complete CSI or SS3 key, including modifiers and unsupported keys.
						const escapeSequence =
							data[i] === '\x1b' &&
							/^\x1b(?:\[|O)([0-?]*)[ -/]*([@-~])/.exec(data.slice(i));
						if (escapeSequence) {
							appendInputText(pendingText);
							pendingText = '';
							const [, parameters, final] = escapeSequence;
							handleInputKey(final === '~' ? parameters.split(';')[0] + '~' : final);
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
							eraseInputCharacter(getInputCharacters(input), inputCursor - 1);
							continue;
						}
						if (chunk === '\t' || codePoint >= 0x20) {
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
					const isCopyShortcut =
						(ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'c';
					if (finish && executionInputOwners === 0) return;
					onkey?.(ev);
					if (isCopyShortcut) {
						ev.preventDefault();
						if (reservedInput?.queued) reservedInput.interrupt();
						else sandbox?.kill?.();
					} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
						ev.preventDefault();
						whenInputReady(submitSandboxEof);
					} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v') {
						ev.preventDefault();
						const generation = sandboxInputGeneration;
						const reservation = reservedInput;
						navigator.clipboard
							.readText()
							.then((text) => {
								const current = reservation
									? reservation === reservedInput
									: generation === sandboxInputGeneration;
								if (!current) return;
								whenInputReady(() => applyPastedText(text));
							})
							.catch(() => {});
					}
				});
				plugin = await registerBasicPlugins(term, initialization.signal);
				if (initialization.signal.aborted || terminalDisposed) return;

				onload?.();
				if (webgl) {
					// A missing GPU context must not prevent terminal input or output.
					void loadWebglPlugin(term, initialization.signal).catch(() => {});
				}
			})
			.catch((error) => {
				if (!initialization.signal.aborted)
					console.error('Failed to initialize terminal', error);
			});

		return () => {
			initialization.abort();
			void disposeTerminal().catch((error) =>
				console.error('Failed to dispose terminal', error)
			);
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
