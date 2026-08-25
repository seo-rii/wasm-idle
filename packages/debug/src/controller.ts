import type {
	DebugCommand,
	DebugFrame,
	DebugMemory,
	DebugResolvedBreakpoint,
	DebugScope,
	DebugSessionEvent,
	DebugSourceBreakpoints,
	DebugVariable,
	DebugWriteMemoryResult,
	TerminalControl
} from '@wasm-idle/core';
import { fromStore, get, writable } from 'svelte/store';

import type { DebugLanguageAdapter } from './language/index.js';

export type DebugWatchValue = {
	expression: string;
	value: string;
};

export type DebugTerminalControl = Pick<
	TerminalControl,
	| 'debugCommand'
	| 'debugPause'
	| 'setBreakpoints'
	| 'debugEvaluate'
	| 'debugVariables'
	| 'debugScopes'
	| 'debugReadMemory'
	| 'debugWriteMemory'
	| 'stop'
>;

export type DebugSessionControllerOptions = {
	terminal?: DebugTerminalControl;
	adapter?: DebugLanguageAdapter | null;
	breakpoints?: number[];
	sourcePath?: string;
	sourceBreakpoints?: DebugSourceBreakpoints[];
	cursorLine?: number | null;
	syncBreakpointsWhile?: boolean | (() => boolean);
};

export function createDebugSessionController(options: DebugSessionControllerOptions = {}) {
	const activeStore = writable(false);
	const pausedStore = writable(false);
	const pausedLineStore = writable<number | null>(null);
	const localsStore = writable<DebugVariable[]>([]);
	const callStackStore = writable<DebugFrame[]>([]);
	const scopesStore = writable<DebugScope[]>([]);
	const variablesByReferenceStore = writable<ReadonlyMap<number, DebugVariable[]>>(new Map());
	const threadIdStore = writable<number | null>(null);
	const frameIdStore = writable<number | null>(null);
	const stoppedReasonStore = writable<string | null>(null);
	const resolvedBreakpointsStore = writable<DebugResolvedBreakpoint[]>([]);
	const sourcePathStore = writable(options.sourcePath ?? '');
	const pausedSourcePathStore = writable<string | null>(null);
	const sourceRevisionStaleStore = writable(false);
	const staleSourcePathsStore = writable<ReadonlySet<string>>(new Set());
	const breakpointsBySourceStore = writable<ReadonlyMap<string, number[]>>(
		new Map(
			(options.sourceBreakpoints || []).map(({ sourcePath, lines }) => [
				sourcePath,
				[...lines]
			])
		)
	);
	const resolvedBreakpointsBySourceStore = writable<
		ReadonlyMap<string, DebugResolvedBreakpoint[]>
	>(new Map());
	const runToCursorLineStore = writable<number | null>(null);
	const watchInputStore = writable('');
	const watchExpressionsStore = writable<string[]>([]);
	const watchValuesStore = writable<DebugWatchValue[]>([]);
	const initialSourceBreakpoints =
		(options.sourcePath &&
			options.sourceBreakpoints?.find(
				(breakpoints) => breakpoints.sourcePath === options.sourcePath
			)?.lines) ||
		options.breakpoints ||
		[];
	const breakpointsStore = writable<number[]>([...initialSourceBreakpoints]);
	if (options.sourcePath && !get(breakpointsBySourceStore).has(options.sourcePath)) {
		breakpointsBySourceStore.update((current) => {
			const next = new Map(current);
			next.set(options.sourcePath!, [...initialSourceBreakpoints]);
			return next;
		});
	}
	const cursorLineStore = writable<number | null>(options.cursorLine ?? null);
	const terminalStore = writable<DebugTerminalControl | undefined>(options.terminal);
	const adapterStore = writable<DebugLanguageAdapter | null>(options.adapter ?? null);

	const activeState = fromStore(activeStore);
	const pausedState = fromStore(pausedStore);
	const pausedLineState = fromStore(pausedLineStore);
	const localsState = fromStore(localsStore);
	const callStackState = fromStore(callStackStore);
	const scopesState = fromStore(scopesStore);
	const variablesByReferenceState = fromStore(variablesByReferenceStore);
	const threadIdState = fromStore(threadIdStore);
	const frameIdState = fromStore(frameIdStore);
	const stoppedReasonState = fromStore(stoppedReasonStore);
	const resolvedBreakpointsState = fromStore(resolvedBreakpointsStore);
	const sourcePathState = fromStore(sourcePathStore);
	const pausedSourcePathState = fromStore(pausedSourcePathStore);
	const sourceRevisionStaleState = fromStore(sourceRevisionStaleStore);
	const breakpointsBySourceState = fromStore(breakpointsBySourceStore);
	const runToCursorLineState = fromStore(runToCursorLineStore);
	const watchInputState = fromStore(watchInputStore);
	const watchExpressionsState = fromStore(watchExpressionsStore);
	const watchValuesState = fromStore(watchValuesStore);
	const breakpointsState = fromStore(breakpointsStore);
	const cursorLineState = fromStore(cursorLineStore);
	const terminalState = fromStore(terminalStore);
	const adapterState = fromStore(adapterStore);

	let watchRequestVersion = 0;
	let frameRequestVersion = 0;
	let commandInFlight = false;
	let commandRequestVersion = 0;

	function beginCommandRequest() {
		commandInFlight = true;
		return ++commandRequestVersion;
	}

	function finishCommandRequest(version: number) {
		if (version === commandRequestVersion) commandInFlight = false;
	}

	function releaseCommandRequest() {
		commandRequestVersion += 1;
		commandInFlight = false;
	}

	function shouldSyncBreakpoints() {
		if (typeof options.syncBreakpointsWhile === 'function') {
			return options.syncBreakpointsWhile();
		}
		if (typeof options.syncBreakpointsWhile === 'boolean') {
			return options.syncBreakpointsWhile;
		}
		return get(activeStore);
	}

	function getEffectiveBreakpoints(sourcePath = get(sourcePathStore)) {
		const lines =
			sourcePath === get(sourcePathStore)
				? [...get(breakpointsStore)]
				: [...(get(breakpointsBySourceStore).get(sourcePath) || [])];
		const runToCursorLine = get(runToCursorLineStore);
		if (
			sourcePath === get(sourcePathStore) &&
			runToCursorLine !== null &&
			!lines.includes(runToCursorLine)
		)
			lines.push(runToCursorLine);
		return lines.sort((left, right) => left - right);
	}

	function refreshWatchValues() {
		const expressions = [...get(watchExpressionsStore)];
		const adapter = get(adapterStore);
		const localVariables = [...get(localsStore)];
		const paused = get(pausedStore);
		const terminal = get(terminalStore);
		const version = ++watchRequestVersion;

		if (!expressions.length) {
			watchValuesStore.set([]);
			return;
		}

		if (paused && terminal?.debugEvaluate) {
			watchValuesStore.set(expressions.map((expression) => ({ expression, value: '...' })));
			(async () => {
				const resolved: DebugWatchValue[] = [];
				for (const expression of expressions) {
					const runtimeValue = await terminal.debugEvaluate!(expression);
					const exactVariable = localVariables.find(
						(variable) => variable.name === expression
					);
					resolved.push({
						expression,
						value:
							runtimeValue === '?' && exactVariable
								? exactVariable.value
								: runtimeValue
					});
				}
				if (version === watchRequestVersion) watchValuesStore.set(resolved);
			})().catch(() => {
				if (version === watchRequestVersion) {
					watchValuesStore.set(
						expressions.map((expression) => ({ expression, value: 'error' }))
					);
				}
			});
			return;
		}

		watchValuesStore.set(
			expressions.map((expression) => {
				try {
					return {
						expression,
						value: adapter
							? adapter.evaluateExpression(expression, localVariables)
							: 'error'
					};
				} catch (error) {
					return {
						expression,
						value:
							error instanceof Error && error.message === 'unavailable'
								? '?'
								: 'error'
					};
				}
			})
		);
	}

	function dispatchBreakpoints(
		terminal: DebugTerminalControl,
		lines: number[],
		sourcePath = get(sourcePathStore)
	) {
		if (!terminal.setBreakpoints) return Promise.resolve();
		return sourcePath
			? terminal.setBreakpoints(lines, sourcePath)
			: terminal.setBreakpoints(lines);
	}

	function syncBreakpoints() {
		const terminal = get(terminalStore);
		if (!shouldSyncBreakpoints() || !terminal?.setBreakpoints) return;
		void dispatchBreakpoints(terminal, getEffectiveBreakpoints());
	}

	function clearPauseState() {
		releaseCommandRequest();
		frameRequestVersion += 1;
		runToCursorLineStore.set(null);
		pausedLineStore.set(null);
		localsStore.set([]);
		callStackStore.set([]);
		scopesStore.set([]);
		variablesByReferenceStore.set(new Map());
		threadIdStore.set(null);
		frameIdStore.set(null);
		stoppedReasonStore.set(null);
		pausedSourcePathStore.set(null);
		sourceRevisionStaleStore.set(false);
		staleSourcePathsStore.set(new Set());
		pausedStore.set(false);
	}

	function reset() {
		activeStore.set(false);
		resolvedBreakpointsStore.set([]);
		resolvedBreakpointsBySourceStore.set(new Map());
		clearPauseState();
		refreshWatchValues();
	}

	function begin() {
		activeStore.set(true);
		resolvedBreakpointsStore.set([]);
		resolvedBreakpointsBySourceStore.set(new Map());
		clearPauseState();
		refreshWatchValues();
		syncBreakpoints();
	}

	function handleEvent(event: DebugSessionEvent) {
		if (event.type === 'breakpoints') {
			resolvedBreakpointsBySourceStore.update((current) => {
				const next = new Map(current);
				next.set(event.sourcePath, [...event.breakpoints]);
				return next;
			});
			if (!get(sourcePathStore) || event.sourcePath === get(sourcePathStore)) {
				resolvedBreakpointsStore.set([...event.breakpoints]);
			}
			return;
		}
		if (event.type === 'pause') {
			releaseCommandRequest();
			frameRequestVersion += 1;
			activeStore.set(true);
			const restoreBreakpoints = get(runToCursorLineStore) !== null;
			runToCursorLineStore.set(null);
			if (restoreBreakpoints) {
				const terminal = get(terminalStore);
				if (terminal?.setBreakpoints) {
					void dispatchBreakpoints(terminal, [...get(breakpointsStore)]);
				}
			}
			const pausedSourcePath =
				event.sourcePath || event.callStack[0]?.sourcePath || get(sourcePathStore);
			if (event.sourceRevisionStale && pausedSourcePath) {
				staleSourcePathsStore.update((current) => {
					const next = new Set(current);
					next.add(pausedSourcePath);
					return next;
				});
			}
			const sourceRevisionStale =
				event.sourceRevisionStale === true ||
				(!!pausedSourcePath && get(staleSourcePathsStore).has(pausedSourcePath));
			pausedSourcePathStore.set(pausedSourcePath);
			sourceRevisionStaleStore.set(sourceRevisionStale);
			pausedLineStore.set(
				!sourceRevisionStale && pausedSourcePath === get(sourcePathStore)
					? event.line
					: null
			);
			localsStore.set(event.locals);
			callStackStore.set(event.callStack);
			scopesStore.set(event.scopes || []);
			variablesByReferenceStore.set(
				new Map(
					(event.scopes || [])
						.filter(
							(scope) => scope.variablesReference > 0 && scope.variables.length > 0
						)
						.map((scope) => [scope.variablesReference, [...scope.variables]])
				)
			);
			threadIdStore.set(event.threadId ?? null);
			frameIdStore.set(event.frameId ?? null);
			stoppedReasonStore.set(event.stoppedReason ?? event.reason);
			pausedStore.set(true);
			refreshWatchValues();
			return;
		}
		if (event.type === 'resume') {
			pausedStore.set(false);
			pausedLineStore.set(null);
			localsStore.set([]);
			callStackStore.set([]);
			scopesStore.set([]);
			variablesByReferenceStore.set(new Map());
			stoppedReasonStore.set(null);
			pausedSourcePathStore.set(null);
			sourceRevisionStaleStore.set(false);
			refreshWatchValues();
			return;
		}
		reset();
	}

	function setTerminal(terminal?: DebugTerminalControl) {
		terminalStore.set(terminal);
		refreshWatchValues();
		syncBreakpoints();
	}

	function setAdapter(adapter: DebugLanguageAdapter | null) {
		adapterStore.set(adapter);
		refreshWatchValues();
	}

	function setSourcePath(sourcePath: string) {
		if (sourcePath === get(sourcePathStore)) return;
		sourcePathStore.set(sourcePath);
		runToCursorLineStore.set(null);
		breakpointsStore.set([...(get(breakpointsBySourceStore).get(sourcePath) || [])]);
		resolvedBreakpointsStore.set([
			...(get(resolvedBreakpointsBySourceStore).get(sourcePath) || [])
		]);
		const isPausedSource = get(pausedSourcePathStore) === sourcePath;
		const sourceRevisionStale = isPausedSource && get(staleSourcePathsStore).has(sourcePath);
		sourceRevisionStaleStore.set(sourceRevisionStale);
		pausedLineStore.set(
			isPausedSource && !sourceRevisionStale ? (get(callStackStore)[0]?.line ?? null) : null
		);
		syncBreakpoints();
	}

	function markSourceRevisionStale(sourcePath = get(sourcePathStore)) {
		if (!get(activeStore) || !sourcePath) return;
		staleSourcePathsStore.update((current) => {
			const next = new Set(current);
			next.add(sourcePath);
			return next;
		});
		if (get(pausedSourcePathStore) === sourcePath) {
			sourceRevisionStaleStore.set(true);
			pausedLineStore.set(null);
		}
	}

	function setBreakpoints(lines: number[]) {
		const sourcePath = get(sourcePathStore);
		breakpointsStore.set([...lines]);
		breakpointsBySourceStore.update((current) => {
			const next = new Map(current);
			next.set(sourcePath, [...lines]);
			return next;
		});
		syncBreakpoints();
	}

	function setCursorLine(line: number | null) {
		cursorLineStore.set(line);
	}

	function addWatchExpression(expression?: string) {
		const watchInput = get(watchInputStore);
		const watchExpressions = get(watchExpressionsStore);
		const nextExpression = (expression || watchInput).trim();
		if (!nextExpression || watchExpressions.includes(nextExpression)) return false;
		watchExpressionsStore.set([...watchExpressions, nextExpression]);
		watchInputStore.set('');
		refreshWatchValues();
		return true;
	}

	function removeWatchExpression(expression: string) {
		watchExpressionsStore.set(
			get(watchExpressionsStore).filter((entry) => entry !== expression)
		);
		refreshWatchValues();
	}

	function clearWatches() {
		watchInputStore.set('');
		watchExpressionsStore.set([]);
		refreshWatchValues();
	}

	async function sendCommand(command: DebugCommand) {
		const terminal = get(terminalStore);
		if (commandInFlight || !terminal?.debugCommand || !get(pausedStore)) return false;
		const version = beginCommandRequest();
		try {
			await terminal.debugCommand(command);
			return true;
		} finally {
			finishCommandRequest(version);
		}
	}

	async function pause() {
		const terminal = get(terminalStore);
		if (commandInFlight || !terminal?.debugPause || !get(activeStore) || get(pausedStore)) {
			return false;
		}
		const version = beginCommandRequest();
		try {
			await terminal.debugPause();
			return true;
		} finally {
			finishCommandRequest(version);
		}
	}

	async function runToCursor(targetLine = get(cursorLineStore)) {
		const terminal = get(terminalStore);
		const breakpoints = get(breakpointsStore);
		if (
			commandInFlight ||
			!terminal?.debugCommand ||
			!get(pausedStore) ||
			!targetLine ||
			targetLine === get(pausedLineStore) ||
			!terminal.setBreakpoints
		) {
			return false;
		}
		const nextBreakpoints = breakpoints.includes(targetLine)
			? [...breakpoints]
			: [...breakpoints, targetLine].sort((left, right) => left - right);
		runToCursorLineStore.set(breakpoints.includes(targetLine) ? null : targetLine);
		const version = beginCommandRequest();
		try {
			await dispatchBreakpoints(terminal, nextBreakpoints);
			await terminal.debugCommand('continue');
			return true;
		} finally {
			finishCommandRequest(version);
		}
	}

	async function stop() {
		const terminal = get(terminalStore);
		if (!terminal) return false;
		reset();
		await terminal.stop?.();
		return true;
	}

	async function loadVariableChildren(
		variablesReference: number,
		start?: number,
		count?: number
	) {
		if (!Number.isInteger(variablesReference) || variablesReference <= 0) return [];
		const terminal = get(terminalStore);
		if (!terminal?.debugVariables) return [];
		const version = frameRequestVersion;
		let variables: DebugVariable[];
		try {
			variables = await terminal.debugVariables(variablesReference, start, count);
		} catch (error) {
			if (version !== frameRequestVersion || !get(pausedStore)) return [];
			throw error;
		}
		if (version !== frameRequestVersion || !get(pausedStore)) return [];
		variablesByReferenceStore.update((current) => {
			const next = new Map(current);
			if (start === undefined) {
				next.set(variablesReference, [...variables]);
				return next;
			}
			const merged = [...(current.get(variablesReference) || [])];
			const insertionIndex = Math.min(start, merged.length);
			merged.splice(insertionIndex, variables.length, ...variables);
			next.set(variablesReference, merged);
			return next;
		});
		if (get(scopesStore).some((scope) => scope.variablesReference === variablesReference)) {
			const variablesByReference = get(variablesByReferenceStore);
			localsStore.set(
				get(scopesStore).flatMap(
					(scope) => variablesByReference.get(scope.variablesReference) ?? scope.variables
				)
			);
			refreshWatchValues();
		}
		return variables;
	}

	async function selectFrame(frameId: number) {
		const frame = get(callStackStore).find((entry) => entry.id === frameId);
		const terminal = get(terminalStore);
		if (!get(pausedStore) || !frame || !terminal?.debugScopes) return false;
		const version = ++frameRequestVersion;
		let scopes: DebugScope[];
		try {
			scopes = await terminal.debugScopes(frameId);
		} catch {
			return false;
		}
		if (
			version !== frameRequestVersion ||
			!get(pausedStore) ||
			!get(callStackStore).some((entry) => entry.id === frameId)
		) {
			return false;
		}
		const selectedSourcePath = frame.sourcePath || get(sourcePathStore);
		const sourceRevisionStale =
			!!selectedSourcePath && get(staleSourcePathsStore).has(selectedSourcePath);
		frameIdStore.set(frameId);
		scopesStore.set(scopes);
		localsStore.set([]);
		variablesByReferenceStore.set(
			new Map(
				scopes
					.filter((scope) => scope.variablesReference > 0 && scope.variables.length > 0)
					.map((scope) => [scope.variablesReference, [...scope.variables]])
			)
		);
		pausedSourcePathStore.set(selectedSourcePath);
		sourceRevisionStaleStore.set(sourceRevisionStale);
		pausedLineStore.set(
			!sourceRevisionStale && selectedSourcePath === get(sourcePathStore) ? frame.line : null
		);
		refreshWatchValues();
		return true;
	}

	async function readMemory(
		memoryReference: string,
		offset: number,
		count: number
	): Promise<DebugMemory | null> {
		if (
			!get(pausedStore) ||
			!memoryReference ||
			!Number.isInteger(offset) ||
			!Number.isInteger(count) ||
			count < 0
		) {
			return null;
		}
		const terminal = get(terminalStore);
		return (await terminal?.debugReadMemory?.(memoryReference, offset, count)) ?? null;
	}

	async function writeMemory(
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial?: boolean
	): Promise<DebugWriteMemoryResult | null> {
		if (
			!get(pausedStore) ||
			!memoryReference ||
			!Number.isSafeInteger(offset) ||
			!(data instanceof Uint8Array)
		) {
			return null;
		}
		const terminal = get(terminalStore);
		return (
			(await terminal?.debugWriteMemory?.(memoryReference, offset, data, allowPartial)) ??
			null
		);
	}

	return {
		get active() {
			return activeState.current;
		},
		get paused() {
			return pausedState.current;
		},
		get pausedLine() {
			return pausedLineState.current;
		},
		get locals() {
			return localsState.current;
		},
		get callStack() {
			return callStackState.current;
		},
		get scopes() {
			return scopesState.current;
		},
		get variablesByReference() {
			return variablesByReferenceState.current;
		},
		get threadId() {
			return threadIdState.current;
		},
		get frameId() {
			return frameIdState.current;
		},
		get stoppedReason() {
			return stoppedReasonState.current;
		},
		get sourcePath() {
			return sourcePathState.current;
		},
		get pausedSourcePath() {
			return pausedSourcePathState.current;
		},
		get sourceRevisionStale() {
			return sourceRevisionStaleState.current;
		},
		get resolvedBreakpoints() {
			return resolvedBreakpointsState.current;
		},
		get runToCursorLine() {
			return runToCursorLineState.current;
		},
		get breakpoints() {
			return breakpointsState.current;
		},
		get sourceBreakpoints() {
			return Array.from(breakpointsBySourceState.current, ([sourcePath, lines]) => ({
				sourcePath,
				lines: [...lines]
			}));
		},
		get effectiveBreakpoints() {
			return getEffectiveBreakpoints();
		},
		get cursorLine() {
			return cursorLineState.current;
		},
		get canRunToCursor() {
			const cursorLine = cursorLineState.current;
			const terminal = terminalState.current;
			return (
				pausedState.current &&
				cursorLine !== null &&
				cursorLine > 0 &&
				cursorLine !== pausedLineState.current &&
				!!terminal?.setBreakpoints
			);
		},
		get watchInput() {
			return watchInputState.current;
		},
		set watchInput(value: string) {
			watchInputStore.set(value);
		},
		get watchExpressions() {
			return watchExpressionsState.current;
		},
		get watchValues() {
			return watchValuesState.current;
		},
		begin,
		reset,
		handleEvent,
		setTerminal,
		setAdapter,
		setSourcePath,
		markSourceRevisionStale,
		setBreakpoints,
		setCursorLine,
		sendCommand,
		pause,
		runToCursor,
		stop,
		addWatchExpression,
		removeWatchExpression,
		clearWatches,
		loadVariableChildren,
		selectFrame,
		readMemory,
		writeMemory
	};
}

export type DebugSessionController = ReturnType<typeof createDebugSessionController>;
