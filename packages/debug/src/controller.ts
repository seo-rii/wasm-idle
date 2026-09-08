import type {
	DebugCommand,
	DebugDataBreakpoint,
	DebugDataBreakpointInfo,
	DebugDataBreakpointInfoArguments,
	DebugFrame,
	DebugMemory,
	DebugResolvedBreakpoint,
	DebugResolvedDataBreakpoint,
	DebugScope,
	DebugSessionCapabilities,
	DebugSessionEvent,
	DebugSourceBreakpoints,
	DebugVariable,
	DebugWriteMemoryResult,
	TerminalControl
} from '@wasm-idle/core';
import { fromStore, get, writable } from 'svelte/store';

import type { DebugLanguageAdapter } from './language/index.js';

const MAX_MEMORY_TRANSFER_BYTES = 256;
const MAX_DEBUG_PROTOCOL_STRING_CODE_UNITS = 4096;
const MAX_DATA_BREAKPOINTS = 256;
const MAX_WATCH_EXPRESSION_CODE_UNITS = 4096;
const MAX_WATCH_EXPRESSIONS = 64;
const MAX_WATCH_VARIABLE_PATH_SEGMENTS = 64;
const VARIABLE_PAGE_SIZE = 50;
const MAX_AUTO_LOADED_SCOPES = 2;
const MAX_AUTO_ARGUMENT_FRAMES = 8;
const MAX_FRAME_ARGUMENTS = 6;

function isLocalScope(scope: DebugScope) {
	return scope.presentationHint
		? scope.presentationHint === 'locals' || scope.presentationHint === 'arguments'
		: /^(locals|arguments)$/iu.test(scope.name);
}

function isArgumentScope(scope: DebugScope) {
	return scope.presentationHint
		? scope.presentationHint === 'arguments'
		: /^arguments$/iu.test(scope.name);
}

type WatchVariablePathSegment = { name: string } | { index: number };
type WatchVariablePathParseResult =
	| { kind: 'path'; root: string; segments: WatchVariablePathSegment[] }
	| { kind: 'other' }
	| { kind: 'too-deep' };

function parseWatchVariablePath(expression: string): WatchVariablePathParseResult {
	const root = expression.match(/^[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
	if (!root) return { kind: 'other' };

	const segments: WatchVariablePathSegment[] = [];
	let cursor = root.length;
	let segmentCount = 1;
	let tooDeep = false;
	while (cursor < expression.length) {
		let segment: WatchVariablePathSegment;
		let consumed: number;
		if (expression[cursor] === '.') {
			const field = expression.slice(cursor + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
			if (!field) return { kind: 'other' };
			segment = { name: field };
			consumed = field.length + 1;
		} else if (expression[cursor] === '[') {
			const indexMatch = expression.slice(cursor).match(/^\[(0|[1-9][0-9]*)\]/u);
			const index = indexMatch ? Number(indexMatch[1]) : -1;
			if (!indexMatch || !Number.isSafeInteger(index)) return { kind: 'other' };
			segment = { index };
			consumed = indexMatch[0].length;
		} else {
			return { kind: 'other' };
		}

		segmentCount += 1;
		if (segmentCount > MAX_WATCH_VARIABLE_PATH_SEGMENTS) {
			tooDeep = true;
		} else {
			segments.push(segment);
		}
		cursor += consumed;
	}

	return tooDeep ? { kind: 'too-deep' } : { kind: 'path', root, segments };
}

function isBoundedNonEmptyString(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_DEBUG_PROTOCOL_STRING_CODE_UNITS
	);
}

function isBoundedMemoryByteCount(value: unknown, allowZero: boolean): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= (allowZero ? 0 : 1) &&
		value <= MAX_MEMORY_TRANSFER_BYTES
	);
}

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
	| 'debugFrameScopes'
	| 'debugFrameName'
	| 'debugReadMemory'
	| 'debugWriteMemory'
	| 'debugDataBreakpointInfo'
	| 'debugSetDataBreakpoints'
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
	const disabledCapabilities: DebugSessionCapabilities = {
		readMemory: false,
		writeMemory: false,
		dataBreakpoints: false
	};
	const activeStore = writable(false);
	const pausedStore = writable(false);
	const pausedLineStore = writable<number | null>(null);
	const localsStore = writable<DebugVariable[]>([]);
	const callStackStore = writable<DebugFrame[]>([]);
	const scopesStore = writable<DebugScope[]>([]);
	const variablesByReferenceStore = writable<ReadonlyMap<number, DebugVariable[]>>(new Map());
	const loadingVariableReferencesStore = writable<ReadonlySet<number>>(new Set());
	const capabilitiesStore = writable<DebugSessionCapabilities>({ ...disabledCapabilities });
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
	const loadingVariableReferencesState = fromStore(loadingVariableReferencesStore);
	const capabilitiesState = fromStore(capabilitiesStore);
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
	const variableRequests = new Map<
		string,
		{ variablesReference: number; promise: Promise<DebugVariable[]> }
	>();
	let argumentQueue: Promise<void> = Promise.resolve();
	const argumentRequests = new Map<number, Promise<void>>();

	function invalidateVariableRequests() {
		frameRequestVersion += 1;
		watchRequestVersion += 1;
		variableRequests.clear();
		argumentRequests.clear();
		argumentQueue = Promise.resolve();
		loadingVariableReferencesStore.set(new Set());
	}

	function requestVariableChildren(
		variablesReference: number,
		...paging: [start?: number, count?: number]
	): Promise<DebugVariable[]> {
		const terminal = get(terminalStore);
		if (
			!get(pausedStore) ||
			!Number.isInteger(variablesReference) ||
			variablesReference <= 0 ||
			!terminal?.debugVariables
		)
			return Promise.resolve([]);
		// Auto-loading, watches, and the panel must share the same bounded scope request.
		if (
			paging[0] === undefined &&
			paging[1] === undefined &&
			get(scopesStore).some(
				(scope) => scope.variablesReference === variablesReference && isLocalScope(scope)
			)
		) {
			const cached = get(variablesByReferenceStore).get(variablesReference);
			if (cached) return Promise.resolve(cached);
			paging = [0, VARIABLE_PAGE_SIZE];
		}
		const key = `${variablesReference}:${paging[0] ?? 0}:${paging[1] ?? 0}`;
		const pending = variableRequests.get(key);
		if (pending) return pending.promise;
		const version = frameRequestVersion;
		const request = { variablesReference, promise: Promise.resolve<DebugVariable[]>([]) };
		variableRequests.set(key, request);
		loadingVariableReferencesStore.update((current) =>
			new Set(current).add(variablesReference)
		);
		request.promise = (async () => {
			try {
				const variables = await terminal.debugVariables!(variablesReference, ...paging);
				return version === frameRequestVersion && get(pausedStore)
					? paging[1] === undefined
						? variables
						: variables.slice(0, paging[1])
					: [];
			} catch (error) {
				if (version !== frameRequestVersion || !get(pausedStore)) return [];
				throw error;
			} finally {
				if (variableRequests.get(key) === request) {
					variableRequests.delete(key);
					loadingVariableReferencesStore.set(
						new Set(
							Array.from(
								variableRequests.values(),
								(entry) => entry.variablesReference
							)
						)
					);
				}
			}
		})();
		return request.promise;
	}

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
				let resolvedVariables = [...localVariables];
				const resolvedReferences = new Map(get(variablesByReferenceStore));
				for (const expression of expressions) {
					if (expression.length > MAX_WATCH_EXPRESSION_CODE_UNITS) {
						resolved.push({ expression, value: '?' });
						continue;
					}
					const variablePath = parseWatchVariablePath(expression);
					if (variablePath.kind === 'too-deep') {
						resolved.push({ expression, value: '?' });
						continue;
					}
					const runtimeValue = await terminal.debugEvaluate!(expression);
					if (version !== watchRequestVersion || !get(pausedStore)) return;
					if (runtimeValue !== '?') {
						resolved.push({ expression, value: runtimeValue });
						continue;
					}

					if (variablePath.kind !== 'path') {
						resolved.push({ expression, value: '?' });
						continue;
					}
					const { root, segments } = variablePath;

					let variable = resolvedVariables.find((candidate) => candidate.name === root);
					if (!variable && terminal.debugVariables) {
						for (const scope of get(scopesStore)) {
							if (scope.variablesReference <= 0) continue;
							let scopeVariables = resolvedReferences.get(scope.variablesReference);
							if (!scopeVariables) {
								scopeVariables = await requestVariableChildren(
									scope.variablesReference
								);
								if (version !== watchRequestVersion || !get(pausedStore)) return;
								resolvedReferences.set(scope.variablesReference, scopeVariables);
								variablesByReferenceStore.update((current) => {
									const next = new Map(current);
									next.set(scope.variablesReference, [...scopeVariables!]);
									return next;
								});
							}
							resolvedVariables = [...resolvedVariables, ...scopeVariables];
							variable = resolvedVariables.find(
								(candidate) => candidate.name === root
							);
							if (variable) break;
						}
						localsStore.set([...resolvedVariables]);
					}

					for (const segment of segments) {
						const variablesReference = variable?.variablesReference ?? 0;
						if (!variable || variablesReference <= 0 || !terminal.debugVariables) {
							variable = undefined;
							break;
						}
						if ('index' in segment) {
							const children = await requestVariableChildren(
								variablesReference,
								segment.index,
								1
							);
							if (version !== watchRequestVersion || !get(pausedStore)) return;
							variable = children[0];
							continue;
						}
						let children = resolvedReferences.get(variablesReference);
						const indexedChildren = (variable.indexedVariables ?? 0) > 0;
						if (
							!children ||
							(indexedChildren &&
								!children.some((child) => child.name === segment.name))
						) {
							children = await requestVariableChildren(variablesReference);
							if (version !== watchRequestVersion || !get(pausedStore)) return;
							resolvedReferences.set(variablesReference, children);
							// A watch lookup must not turn a partially expanded array into an unbounded UI list.
							if (!indexedChildren)
								variablesByReferenceStore.update((current) => {
									const next = new Map(current);
									next.set(variablesReference, [...children!]);
									return next;
								});
						}
						variable = children.find((candidate) => candidate.name === segment.name);
					}
					resolved.push({
						expression,
						value: variable?.value ?? '?'
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
		invalidateVariableRequests();
		runToCursorLineStore.set(null);
		pausedLineStore.set(null);
		localsStore.set([]);
		callStackStore.set([]);
		scopesStore.set([]);
		variablesByReferenceStore.set(new Map());
		capabilitiesStore.set({ ...disabledCapabilities });
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
			invalidateVariableRequests();
			activeStore.set(true);
			capabilitiesStore.set({ ...(event.capabilities ?? disabledCapabilities) });
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
			loadTopLevelVariables();
			refreshWatchValues();
			return;
		}
		if (event.type === 'resume') {
			invalidateVariableRequests();
			capabilitiesStore.set({ ...disabledCapabilities });
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
		if (get(terminalStore) !== terminal) invalidateVariableRequests();
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
		const candidate = expression || watchInput;
		if (candidate.length > MAX_WATCH_EXPRESSION_CODE_UNITS) return false;
		const nextExpression = candidate.trim();
		if (
			!nextExpression ||
			watchExpressions.includes(nextExpression) ||
			watchExpressions.length >= MAX_WATCH_EXPRESSIONS ||
			parseWatchVariablePath(nextExpression).kind === 'too-deep'
		)
			return false;
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
		if (
			!get(pausedStore) ||
			!Number.isInteger(variablesReference) ||
			variablesReference <= 0 ||
			!get(terminalStore)?.debugVariables
		)
			return [];
		const version = frameRequestVersion;
		const variables = await requestVariableChildren(variablesReference, start, count);
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

	function loadTopLevelVariables() {
		const version = frameRequestVersion;
		const scopes = get(scopesStore).filter((scope) => !scope.expensive && isLocalScope(scope));
		const requests: Promise<DebugVariable[]>[] = [];
		for (const scope of scopes.slice(0, MAX_AUTO_LOADED_SCOPES)) {
			if (
				scope.variablesReference <= 0 ||
				get(variablesByReferenceStore).has(scope.variablesReference)
			)
				continue;
			// Failure leaves this scope unloaded so the panel can explicitly retry it.
			requests.push(loadVariableChildren(scope.variablesReference));
		}
		void Promise.allSettled(requests).then(() => {
			if (version !== frameRequestVersion || !get(pausedStore)) return;
			void loadFrameArguments(
				[
					get(frameIdStore),
					...get(callStackStore)
						.slice(0, MAX_AUTO_ARGUMENT_FRAMES)
						.map((frame) => frame.id)
				].filter((id): id is number => id != null)
			);
		});
	}

	/** Populate visible frames serially without changing the selected evaluation frame. */
	async function loadFrameArguments(frameIds: number[]) {
		const terminal = get(terminalStore);
		// A mixed Locals scope does not identify arguments. Never label all locals as parameters.
		if (
			!get(pausedStore) ||
			!terminal ||
			(!terminal.debugFrameName &&
				(!terminal.debugFrameScopes || !get(scopesStore).some(isArgumentScope)))
		)
			return;
		const version = frameRequestVersion;
		const pending: Promise<void>[] = [];
		for (const frameId of [...new Set(frameIds)].slice(0, MAX_AUTO_ARGUMENT_FRAMES)) {
			const frame = get(callStackStore).find((entry) => entry.id === frameId);
			if (!frame || frame.argumentsSummary !== undefined || frame.displayName !== undefined)
				continue;
			const existing = argumentRequests.get(frameId);
			if (existing) {
				pending.push(existing);
				continue;
			}
			const request = argumentQueue
				.then(async () => {
					if (version !== frameRequestVersion || !get(pausedStore)) return;
					if (terminal.debugFrameName) {
						const displayName = await terminal.debugFrameName(frameId);
						if (version !== frameRequestVersion || !get(pausedStore)) return;
						if (displayName !== null) {
							callStackStore.update((frames) =>
								frames.map((entry) =>
									entry.id === frameId
										? { ...entry, displayName: displayName.slice(0, 512) }
										: entry
								)
							);
							return;
						}
					}
					if (!terminal.debugFrameScopes || !get(scopesStore).some(isArgumentScope))
						return;
					const scopes =
						frameId === get(frameIdStore)
							? get(scopesStore)
							: await terminal.debugFrameScopes!(frameId);
					if (version !== frameRequestVersion || !get(pausedStore)) return;
					const arguments_: DebugVariable[] = [];
					let hasArguments = false;
					for (const scope of scopes
						.filter((scope) => !scope.expensive && isArgumentScope(scope))
						.slice(0, MAX_AUTO_LOADED_SCOPES)) {
						hasArguments = true;
						const values =
							get(variablesByReferenceStore).get(scope.variablesReference) ??
							(scope.variables.length
								? scope.variables
								: await requestVariableChildren(
										scope.variablesReference,
										0,
										MAX_FRAME_ARGUMENTS + 1
									));
						if (version !== frameRequestVersion || !get(pausedStore)) return;
						arguments_.push(
							...values.slice(0, MAX_FRAME_ARGUMENTS + 1 - arguments_.length)
						);
						if (arguments_.length > MAX_FRAME_ARGUMENTS) break;
					}
					if (!hasArguments) return;
					const summary =
						arguments_
							.slice(0, MAX_FRAME_ARGUMENTS)
							.map(
								({ name, value }) =>
									`${name.slice(0, 40)} = ${value.length > 80 ? value.slice(0, 79) + '…' : value}`
							)
							.join(', ') + (arguments_.length > MAX_FRAME_ARGUMENTS ? ', …' : '');
					callStackStore.update((frames) =>
						frames.map((entry) =>
							entry.id === frameId ? { ...entry, argumentsSummary: summary } : entry
						)
					);
				})
				.catch(() => undefined)
				.finally(() => {
					if (argumentRequests.get(frameId) === request) argumentRequests.delete(frameId);
				});
			argumentQueue = request;
			argumentRequests.set(frameId, request);
			pending.push(request);
		}
		await Promise.all(pending);
	}

	function loadMoreVariableChildren(variable: DebugVariable) {
		const reference = variable.variablesReference ?? 0;
		const children = get(variablesByReferenceStore).get(reference);
		if ((variable.indexedVariables ?? 0) > 0) {
			const total = (variable.namedVariables ?? 0) + variable.indexedVariables!;
			const start = children?.length ?? 0;
			if (start >= total) return Promise.resolve([]);
			return loadVariableChildren(
				reference,
				start,
				Math.min(VARIABLE_PAGE_SIZE, total - start)
			);
		}
		return children === undefined ? loadVariableChildren(reference) : Promise.resolve([]);
	}

	async function selectFrame(frameId: number) {
		const frame = get(callStackStore).find((entry) => entry.id === frameId);
		const terminal = get(terminalStore);
		if (!get(pausedStore) || !frame || !terminal?.debugScopes) return false;
		invalidateVariableRequests();
		const version = frameRequestVersion;
		const previousLocals = get(localsStore);
		// Values from the previous frame stop describing the editor as soon as selection begins.
		localsStore.set([]);
		let scopes: DebugScope[];
		try {
			scopes = await terminal.debugScopes(frameId);
		} catch {
			if (version === frameRequestVersion && get(pausedStore)) {
				localsStore.set(previousLocals);
				refreshWatchValues();
			}
			return false;
		}
		if (
			version !== frameRequestVersion ||
			!get(pausedStore) ||
			!get(callStackStore).some((entry) => entry.id === frameId)
		) {
			return false;
		}
		// Reads started while the scope request was pending still belong to the old frame.
		invalidateVariableRequests();
		const selectedSourcePath = frame.sourcePath || get(sourcePathStore);
		const sourceRevisionStale =
			!!selectedSourcePath && get(staleSourcePathsStore).has(selectedSourcePath);
		frameIdStore.set(frameId);
		scopesStore.set(scopes);
		localsStore.set(scopes.flatMap((scope) => scope.variables));
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
		loadTopLevelVariables();
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
			!get(capabilitiesStore).readMemory ||
			!isBoundedNonEmptyString(memoryReference) ||
			!Number.isSafeInteger(offset) ||
			!isBoundedMemoryByteCount(count, true)
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
			!get(capabilitiesStore).writeMemory ||
			!isBoundedNonEmptyString(memoryReference) ||
			!Number.isSafeInteger(offset) ||
			!(data instanceof Uint8Array) ||
			data.byteLength > MAX_MEMORY_TRANSFER_BYTES ||
			(allowPartial !== undefined && typeof allowPartial !== 'boolean')
		) {
			return null;
		}
		const terminal = get(terminalStore);
		return (
			(await terminal?.debugWriteMemory?.(memoryReference, offset, data, allowPartial)) ??
			null
		);
	}

	async function dataBreakpointInfo(
		arguments_: DebugDataBreakpointInfoArguments
	): Promise<DebugDataBreakpointInfo | null> {
		if (
			!get(pausedStore) ||
			!get(capabilitiesStore).dataBreakpoints ||
			!arguments_ ||
			typeof arguments_ !== 'object' ||
			!isBoundedNonEmptyString(arguments_.name) ||
			(arguments_.bytes !== undefined &&
				!isBoundedMemoryByteCount(arguments_.bytes, false)) ||
			(arguments_.asAddress !== undefined && typeof arguments_.asAddress !== 'boolean')
		) {
			return null;
		}
		const terminal = get(terminalStore);
		return (await terminal?.debugDataBreakpointInfo?.(arguments_)) ?? null;
	}

	async function setDataBreakpoints(
		breakpoints: DebugDataBreakpoint[]
	): Promise<DebugResolvedDataBreakpoint[]> {
		if (
			commandInFlight ||
			!get(pausedStore) ||
			!get(capabilitiesStore).dataBreakpoints ||
			!Array.isArray(breakpoints) ||
			breakpoints.length > MAX_DATA_BREAKPOINTS ||
			!breakpoints.every(
				(breakpoint) =>
					breakpoint !== null &&
					typeof breakpoint === 'object' &&
					!Array.isArray(breakpoint) &&
					isBoundedNonEmptyString(breakpoint.dataId) &&
					(breakpoint.accessType === undefined ||
						breakpoint.accessType === 'read' ||
						breakpoint.accessType === 'write' ||
						breakpoint.accessType === 'readWrite')
			)
		) {
			return [];
		}
		const terminal = get(terminalStore);
		if (!terminal?.debugSetDataBreakpoints) return [];
		const version = beginCommandRequest();
		try {
			return await terminal.debugSetDataBreakpoints(breakpoints);
		} finally {
			finishCommandRequest(version);
		}
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
		get loadingVariableReferences() {
			return loadingVariableReferencesState.current;
		},
		get capabilities() {
			return capabilitiesState.current;
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
			if (value.length <= MAX_WATCH_EXPRESSION_CODE_UNITS) watchInputStore.set(value);
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
		loadMoreVariableChildren,
		loadFrameArguments,
		selectFrame,
		readMemory,
		writeMemory,
		dataBreakpointInfo,
		setDataBreakpoints
	};
}

export type DebugSessionController = ReturnType<typeof createDebugSessionController>;
