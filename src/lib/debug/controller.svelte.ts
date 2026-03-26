import type { DebugLanguageAdapter } from '$lib/debug/language';
	import type {
		DebugCommand,
		DebugFrame,
		DebugSessionEvent,
		DebugVariable
	} from '$lib/playground/options';
	import type { TerminalControl } from '$lib/terminal';
	import { fromStore, get, writable } from 'svelte/store';

export type DebugWatchValue = {
	expression: string;
	value: string;
};

export type DebugSessionControllerOptions = {
	terminal?: TerminalControl;
	adapter?: DebugLanguageAdapter | null;
	breakpoints?: number[];
	cursorLine?: number | null;
	syncBreakpointsWhile?: boolean | (() => boolean);
};

export function createDebugSessionController(options: DebugSessionControllerOptions = {}) {
	const activeStore = writable(false);
	const pausedStore = writable(false);
	const pausedLineStore = writable<number | null>(null);
	const localsStore = writable<DebugVariable[]>([]);
	const callStackStore = writable<DebugFrame[]>([]);
	const runToCursorLineStore = writable<number | null>(null);
	const watchInputStore = writable('');
	const watchExpressionsStore = writable<string[]>([]);
	const watchValuesStore = writable<DebugWatchValue[]>([]);
	const breakpointsStore = writable<number[]>([...(options.breakpoints || [])]);
	const cursorLineStore = writable<number | null>(options.cursorLine ?? null);
	const terminalStore = writable<TerminalControl | undefined>(options.terminal);
	const adapterStore = writable<DebugLanguageAdapter | null>(options.adapter ?? null);

	const activeState = fromStore(activeStore);
	const pausedState = fromStore(pausedStore);
	const pausedLineState = fromStore(pausedLineStore);
	const localsState = fromStore(localsStore);
	const callStackState = fromStore(callStackStore);
	const runToCursorLineState = fromStore(runToCursorLineStore);
	const watchInputState = fromStore(watchInputStore);
	const watchExpressionsState = fromStore(watchExpressionsStore);
	const watchValuesState = fromStore(watchValuesStore);
	const breakpointsState = fromStore(breakpointsStore);
	const cursorLineState = fromStore(cursorLineStore);
	const terminalState = fromStore(terminalStore);
	const adapterState = fromStore(adapterStore);

	let watchRequestVersion = 0;

	function shouldSyncBreakpoints() {
		if (typeof options.syncBreakpointsWhile === 'function') {
			return options.syncBreakpointsWhile();
		}
		if (typeof options.syncBreakpointsWhile === 'boolean') {
			return options.syncBreakpointsWhile;
		}
		return get(activeStore);
	}

	function getEffectiveBreakpoints() {
		const lines = [...get(breakpointsStore)];
		const runToCursorLine = get(runToCursorLineStore);
		if (runToCursorLine !== null && !lines.includes(runToCursorLine)) lines.push(runToCursorLine);
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
					resolved.push({
						expression,
						value: await terminal.debugEvaluate!(expression)
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
						value: adapter ? adapter.evaluateExpression(expression, localVariables) : 'error'
					};
				} catch (error) {
					return {
						expression,
						value: error instanceof Error && error.message === 'unavailable' ? '?' : 'error'
					};
				}
			})
		);
	}

	function syncBreakpoints() {
		const terminal = get(terminalStore);
		if (!shouldSyncBreakpoints() || !terminal?.setBreakpoints) return;
		void terminal.setBreakpoints(getEffectiveBreakpoints());
	}

	function clearPauseState() {
		runToCursorLineStore.set(null);
		pausedLineStore.set(null);
		localsStore.set([]);
		callStackStore.set([]);
		pausedStore.set(false);
	}

	function reset() {
		activeStore.set(false);
		clearPauseState();
		refreshWatchValues();
	}

	function begin() {
		activeStore.set(true);
		clearPauseState();
		refreshWatchValues();
		syncBreakpoints();
	}

	function handleEvent(event: DebugSessionEvent) {
		if (event.type === 'pause') {
			activeStore.set(true);
			runToCursorLineStore.set(null);
			pausedLineStore.set(event.line);
			localsStore.set(event.locals);
			callStackStore.set(event.callStack);
			pausedStore.set(true);
			refreshWatchValues();
			return;
		}
		if (event.type === 'resume') {
			pausedStore.set(false);
			pausedLineStore.set(null);
			localsStore.set([]);
			callStackStore.set([]);
			refreshWatchValues();
			return;
		}
		reset();
	}

	function setTerminal(terminal?: TerminalControl) {
		terminalStore.set(terminal);
		refreshWatchValues();
		syncBreakpoints();
	}

	function setAdapter(adapter: DebugLanguageAdapter | null) {
		adapterStore.set(adapter);
		refreshWatchValues();
	}

	function setBreakpoints(lines: number[]) {
		breakpointsStore.set([...lines]);
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
		if (!terminal || !get(pausedStore)) return false;
		await terminal.debugCommand(command);
		return true;
	}

	async function runToCursor(targetLine = get(cursorLineStore)) {
		const terminal = get(terminalStore);
		const breakpoints = get(breakpointsStore);
		if (
			!terminal ||
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
		await terminal.setBreakpoints(nextBreakpoints);
		await terminal.debugCommand('continue');
		return true;
	}

	async function stop() {
		const terminal = get(terminalStore);
		if (!terminal) return false;
		reset();
		await terminal.stop?.();
		return true;
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
		get runToCursorLine() {
			return runToCursorLineState.current;
		},
		get breakpoints() {
			return breakpointsState.current;
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
		setBreakpoints,
		setCursorLine,
		sendCommand,
		runToCursor,
		stop,
		addWatchExpression,
		removeWatchExpression,
		clearWatches
	};
}

export type DebugSessionController = ReturnType<typeof createDebugSessionController>;
