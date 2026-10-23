import type {
	DebugCommand,
	DebugDataBreakpoint,
	DebugDataBreakpointAccessType,
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
	DebugSourceBreakpoint,
	DebugSteppingOptions,
	DebugVariable,
	DebugWriteMemoryResult,
	TerminalControl
} from '@wasm-idle/core';
import {
	normalizeDebugSourceBreakpoints,
	normalizeDebugSteppingOptions,
	assertDebugBreakpointSupport
} from '@wasm-idle/core';
import { fromStore, get, writable } from 'svelte/store';

import type { DebugLanguageAdapter } from './language/index.js';
import {
	createDebugVariableState,
	createDebugStopSnapshot,
	debugFramePathKey,
	isLocalScope,
	type DebugVariableNode,
	type DebugStopSnapshot
} from './variable-state.js';
export type {
	DebugVariableNode,
	DebugStopSnapshot,
	DebugSnapshotVariable
} from './variable-state.js';

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
	/** Present for expandable runtime or variable-path results. */
	variable?: DebugVariable;
	node?: DebugVariableNode;
};

export type DebugWatchVariableOptions = {
	/** Replace the session watchpoint set for UIs with one active watchpoint. */
	replaceExisting?: boolean;
};

export type DebugTerminalControl = Pick<
	TerminalControl,
	| 'debugCommand'
	| 'debugPause'
	| 'setBreakpoints'
	| 'debugEvaluate'
	| 'debugEvaluateValue'
	| 'setSourceBreakpoints'
	| 'debugSetSteppingOptions'
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
	/** Bounded read-only stop history (default 20, maximum 100; zero disables it). */
	historyLimit?: number;
	/** Maximum copied variable nodes per stop (default 500, maximum 5,000). */
	snapshotVariableLimit?: number;
	steppingOptions?: DebugSteppingOptions;
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
			(options.sourceBreakpoints || []).map(({ sourcePath, lines, breakpoints }) => [
				sourcePath,
				breakpoints
					? breakpoints.filter((spec) => spec.enabled !== false).map((spec) => spec.line)
					: [...lines]
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
			options.sourceBreakpoints
				?.find((breakpoints) => breakpoints.sourcePath === options.sourcePath)
				?.breakpoints?.filter((spec) => spec.enabled !== false)
				.map((spec) => spec.line)) ||
		(options.sourcePath &&
			options.sourceBreakpoints?.find((source) => source.sourcePath === options.sourcePath)
				?.lines) ||
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
	const variableState = createDebugVariableState();
	const variableNodesStore = writable<DebugVariableNode[]>([]);
	const scopeNodesStore = writable<ReadonlyMap<number, DebugVariableNode[]>>(new Map());
	const watchNodesStore = writable<ReadonlyMap<string, DebugVariableNode>>(new Map());
	const historyStore = writable<readonly DebugStopSnapshot[]>(Object.freeze([]));
	const selectedHistoryIdStore = writable<number | null>(null);
	const steppingOptionsStore = writable(
		normalizeDebugSteppingOptions(options.steppingOptions ?? { skipLibraryCode: false })
	);
	const structuredBreakpointsStore = writable<ReadonlyMap<string, DebugSourceBreakpoint[]>>(
		new Map(
			(options.sourceBreakpoints ?? []).map((source) => [
				source.sourcePath,
				normalizeDebugSourceBreakpoints(
					source.breakpoints ?? source.lines.map((line) => ({ line }))
				)
			])
		)
	);
	const breakpointErrorStore = writable<string | null>(null);
	const historyLimit = Math.max(
		0,
		Math.min(100, Number.isSafeInteger(options.historyLimit) ? options.historyLimit! : 20)
	);
	const snapshotVariableLimit = Math.max(
		1,
		Math.min(
			5_000,
			Number.isSafeInteger(options.snapshotVariableLimit)
				? options.snapshotVariableLimit!
				: 500
		)
	);

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
	const variableNodesState = fromStore(variableNodesStore);
	const scopeNodesState = fromStore(scopeNodesStore);
	const watchNodesState = fromStore(watchNodesStore);
	const historyState = fromStore(historyStore);
	const selectedHistoryIdState = fromStore(selectedHistoryIdStore);
	const steppingOptionsState = fromStore(steppingOptionsStore);
	const structuredBreakpointsState = fromStore(structuredBreakpointsStore);
	const breakpointErrorState = fromStore(breakpointErrorStore);

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
	let currentStopId = 0;
	let currentStopTimestamp = 0;
	let pendingTransition: DebugCommand | null = null;
	let observedSessionId: string | undefined;
	let terminalChangedSinceStop = false;
	let variableViewSuspended = false;
	const restoredPaths = new Set<string>();
	let hoverRequestVersion = 0;
	let watchpointGeneration = 0;
	let dataBreakpointSpecs: DebugDataBreakpoint[] = [];
	let breakpointRequestSequence = 0;
	const breakpointRequests = new Map<string, number>();
	let steppingRequestVersion = 0;

	function invalidateVariableRequests() {
		frameRequestVersion += 1;
		watchRequestVersion += 1;
		hoverRequestVersion += 1;
		restoredPaths.clear();
		variableRequests.clear();
		argumentRequests.clear();
		argumentQueue = Promise.resolve();
		loadingVariableReferencesStore.set(new Set());
	}

	function watchValuesWithNodes() {
		const nodes = get(watchNodesStore);
		return get(watchValuesStore).map((watch) => {
			const node = nodes.get(watch.expression);
			return node ? { ...watch, node } : watch;
		});
	}

	function recordStopSnapshot() {
		if (!historyLimit || !currentStopId || !get(pausedStore)) return;
		const snapshot = createDebugStopSnapshot(
			{
				id: currentStopId,
				timestamp: currentStopTimestamp,
				reason: get(stoppedReasonStore),
				line:
					get(callStackStore).find((frame) => frame.id === get(frameIdStore))?.line ??
					get(pausedLineStore),
				sourcePath: get(pausedSourcePathStore),
				frameKey:
					debugFramePathKey(
						get(callStackStore),
						get(frameIdStore),
						get(sourcePathStore)
					) ?? ''
			},
			get(callStackStore),
			get(variableNodesStore),
			watchValuesWithNodes(),
			snapshotVariableLimit
		);
		historyStore.update((history) =>
			Object.freeze(
				[...history.filter((entry) => entry.id !== snapshot.id), snapshot].slice(
					-historyLimit
				)
			)
		);
		const selected = get(selectedHistoryIdStore);
		if (selected !== null && !get(historyStore).some((entry) => entry.id === selected))
			selectedHistoryIdStore.set(null);
	}

	function updateVariableView() {
		if (variableViewSuspended) return;
		if (!get(pausedStore) || terminalChangedSinceStop) {
			variableState.clearLive();
			variableNodesStore.set([]);
			scopeNodesStore.set(new Map());
			watchNodesStore.set(new Map());
			return;
		}
		const frameKey =
			debugFramePathKey(get(callStackStore), get(frameIdStore), get(sourcePathStore)) ??
			JSON.stringify(['unknown', get(pausedSourcePathStore)]);
		const nodes = variableState.build({
			frameKey,
			scopes: get(scopesStore),
			locals: get(localsStore),
			variablesByReference: get(variablesByReferenceStore),
			loadingReferences: get(loadingVariableReferencesStore),
			watches: get(watchValuesStore)
		});
		variableNodesStore.set(nodes.locals);
		scopeNodesStore.set(nodes.scopes);
		watchNodesStore.set(nodes.watches);
		recordStopSnapshot();
		if (get(selectedHistoryIdStore) !== null) return;
		const version = frameRequestVersion;
		const restore = (entries: DebugVariableNode[]) => {
			for (const node of entries) {
				if (!node.expanded) continue;
				if (
					(node.variable.variablesReference ?? 0) > 0 &&
					node.hasMore &&
					!node.children.length &&
					!restoredPaths.has(node.path)
				) {
					restoredPaths.add(node.path);
					// A failed restore remains explicitly retryable; it must not create a request loop.
					void Promise.resolve()
						.then(() =>
							version === frameRequestVersion ? loadMoreVariablePath(node.path) : []
						)
						.catch(() => undefined);
				}
				restore(node.children);
			}
		};
		restore([...nodes.scopes.values()].flat());
		if (!nodes.scopes.size) restore(nodes.locals);
		restore([...nodes.watches.values()]);
	}

	async function expandVariable(path: string, expanded = true) {
		if (
			!get(pausedStore) ||
			get(selectedHistoryIdStore) !== null ||
			!variableState.setExpanded(path, expanded)
		)
			return false;
		updateVariableView();
		if (expanded) await loadMoreVariablePath(path, true);
		return true;
	}

	async function loadMoreVariablePath(path: string, initialOnly = false) {
		if (!get(pausedStore) || get(selectedHistoryIdStore) !== null) return [];
		const entry = variableState.entry(path);
		if (!entry || (initialOnly && entry.node.children.length)) return [];
		const variable = entry.node.variable;
		const total = (variable.namedVariables ?? 0) + (variable.indexedVariables ?? 0);
		if (total > VARIABLE_PAGE_SIZE && (variable.variablesReference ?? 0) > 0) {
			const start =
				get(variablesByReferenceStore).get(variable.variablesReference!)?.length ?? 0;
			return start < total
				? loadVariableChildren(
						variable.variablesReference!,
						start,
						Math.min(VARIABLE_PAGE_SIZE, total - start)
					)
				: [];
		}
		return loadMoreVariableChildren(entry.node.variable);
	}

	function addWatchFromVariable(path: string) {
		if (get(selectedHistoryIdStore) !== null) return false;
		const expression = variableState.entry(path)?.node.expression;
		return expression ? addWatchExpression(expression) : false;
	}

	async function resolveHover(expression: string): Promise<DebugWatchValue | null> {
		if (!get(pausedStore) || get(selectedHistoryIdStore) !== null) return null;
		const version = frameRequestVersion;
		const request = ++hoverRequestVersion;
		const isCurrent = () =>
			version === frameRequestVersion &&
			request === hoverRequestVersion &&
			get(pausedStore) &&
			get(selectedHistoryIdStore) === null;
		try {
			const result = await resolveValue(expression.trim(), 'hover', isCurrent);
			return isCurrent() && result && result.value !== '?' ? result : null;
		} catch {
			return null;
		}
	}

	async function watchVariable(
		path: string,
		accessType: DebugDataBreakpointAccessType = 'write',
		options: DebugWatchVariableOptions = {}
	) {
		if (
			commandInFlight ||
			!get(pausedStore) ||
			get(selectedHistoryIdStore) !== null ||
			!get(capabilitiesStore).dataBreakpoints
		)
			return [];
		const entry = variableState.entry(path);
		if (
			!entry ||
			!entry.parentReference ||
			!['read', 'write', 'readWrite'].includes(accessType)
		)
			return [];
		const version = frameRequestVersion;
		const generation = ++watchpointGeneration;
		const replaceExisting = options.replaceExisting === true;
		const info = await dataBreakpointInfo({
			name: entry.node.variable.name,
			variablesReference: entry.parentReference,
			...(get(frameIdStore) === null ? {} : { frameId: get(frameIdStore)! })
		});
		if (
			version !== frameRequestVersion ||
			generation !== watchpointGeneration ||
			!get(pausedStore) ||
			!info?.dataId ||
			(info.accessTypes && !info.accessTypes.includes(accessType))
		)
			return [];
		const next = [
			...(replaceExisting
				? []
				: dataBreakpointSpecs.filter((spec) => spec.dataId !== info.dataId)),
			{ dataId: info.dataId, accessType }
		];
		const resolved = await setDataBreakpoints(next);
		const requested = resolved[next.length - 1];
		return requested ? [requested] : [];
	}

	function selectHistory(id: number | null) {
		if (id !== null && !get(historyStore).some((snapshot) => snapshot.id === id)) return false;
		hoverRequestVersion += 1;
		selectedHistoryIdStore.set(id);
		if (id === null) updateVariableView();
		return true;
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

	function watchWithVariable(expression: string, variable: DebugVariable): DebugWatchValue {
		return {
			expression,
			value: variable.value,
			...((variable.variablesReference ?? 0) > 0 || get(terminalStore)?.debugEvaluateValue
				? { variable }
				: {})
		};
	}

	async function resolveValue(
		expression: string,
		context: 'watch' | 'hover',
		isCurrent: () => boolean
	): Promise<DebugWatchValue | null> {
		if (expression.length > MAX_WATCH_EXPRESSION_CODE_UNITS) return null;
		const variablePath = parseWatchVariablePath(expression);
		if (variablePath.kind === 'too-deep') return null;
		const terminal = get(terminalStore);
		if (terminalChangedSinceStop && terminal?.debugEvaluateValue)
			return { expression, value: '?' };
		const capabilities = get(capabilitiesStore);
		const structuredEvaluation =
			context === 'hover' ? capabilities.evaluateForHovers : capabilities.evaluateValues;
		if (terminal?.debugEvaluateValue && structuredEvaluation) {
			const result = await terminal.debugEvaluateValue(expression, {
				context,
				...(get(frameIdStore) === null ? {} : { frameId: get(frameIdStore)! })
			});
			if (!isCurrent()) return null;
			if (result.result !== '?') {
				const { result: value, ...metadata } = result;
				return watchWithVariable(expression, { name: expression, value, ...metadata });
			}
		} else if (context === 'watch' && terminal?.debugEvaluate) {
			// Trace watches retain their evaluator even when the Terminal exposes the new optional API.
			// An LLDB runtime gates its legacy evaluator before the same safe-path fallback below.
			const value = await terminal.debugEvaluate(expression);
			if (!isCurrent()) return null;
			if (value !== '?') return { expression, value };
		}
		if (variablePath.kind !== 'path') return { expression, value: '?' };
		const { root, segments } = variablePath;
		let resolvedVariables = [...get(localsStore)];
		const resolvedReferences = new Map(get(variablesByReferenceStore));
		if (resolvedVariables.filter((candidate) => candidate.name === root).length > 1)
			return { expression, value: '?' };
		let variable = resolvedVariables.find((candidate) => candidate.name === root);
		if (!variable && terminal?.debugVariables) {
			for (const scope of get(scopesStore)) {
				if (scope.variablesReference <= 0) continue;
				let scopeVariables = resolvedReferences.get(scope.variablesReference);
				if (!scopeVariables) {
					scopeVariables = await requestVariableChildren(scope.variablesReference);
					if (!isCurrent()) return null;
					resolvedReferences.set(scope.variablesReference, scopeVariables);
					variablesByReferenceStore.update((current) =>
						new Map(current).set(scope.variablesReference, [...scopeVariables!])
					);
				}
				resolvedVariables = [
					...resolvedVariables,
					...scopeVariables.filter((value) => !resolvedVariables.includes(value))
				];
				if (resolvedVariables.filter((candidate) => candidate.name === root).length > 1)
					return { expression, value: '?' };
				variable = resolvedVariables.find((candidate) => candidate.name === root);
				if (variable) break;
			}
			localsStore.set(resolvedVariables);
		}
		for (const segment of segments) {
			const reference = variable?.variablesReference ?? 0;
			if (!variable || reference <= 0 || !terminal?.debugVariables) {
				variable = undefined;
				break;
			}
			if ('index' in segment) {
				const indexedCount = variable.indexedVariables;
				const offset =
					segment.index + ((indexedCount ?? 0) > 0 ? (variable.namedVariables ?? 0) : 0);
				if (
					!Number.isSafeInteger(offset) ||
					(indexedCount !== undefined && segment.index >= indexedCount)
				) {
					variable = undefined;
					break;
				}
				const children = await requestVariableChildren(reference, offset, 1);
				if (!isCurrent()) return null;
				variable = children.find(
					(child) =>
						child.name === `[${segment.index}]` || child.name === String(segment.index)
				);
				continue;
			}
			let children = resolvedReferences.get(reference);
			const indexedChildren = (variable.indexedVariables ?? 0) > 0;
			if (
				!children ||
				(indexedChildren && !children.some((child) => child.name === segment.name))
			) {
				children = await requestVariableChildren(reference);
				if (!isCurrent()) return null;
				resolvedReferences.set(reference, children);
				// A watch of items[999] or a mixed named field must not expand the displayed prefix.
				if (!indexedChildren)
					variablesByReferenceStore.update((current) =>
						new Map(current).set(reference, [...children!])
					);
			}
			const matches = children.filter((candidate) => candidate.name === segment.name);
			variable = matches.length === 1 ? matches[0] : undefined;
		}
		return variable ? watchWithVariable(expression, variable) : { expression, value: '?' };
	}

	function refreshWatchValues() {
		const expressions = [...get(watchExpressionsStore)];
		const adapter = get(adapterStore);
		const localVariables = [...get(localsStore)];
		const terminal = get(terminalStore);
		const version = ++watchRequestVersion;
		if (!expressions.length) {
			watchValuesStore.set([]);
			return;
		}
		if (
			get(pausedStore) &&
			(terminal?.debugEvaluate || terminal?.debugEvaluateValue || terminal?.debugVariables)
		) {
			watchValuesStore.set(expressions.map((expression) => ({ expression, value: '...' })));
			const isCurrent = () => version === watchRequestVersion && get(pausedStore);
			void (async () => {
				const resolved: DebugWatchValue[] = [];
				for (const expression of expressions) {
					const value = await resolveValue(expression, 'watch', isCurrent);
					if (!isCurrent()) return;
					resolved.push(value ?? { expression, value: '?' });
				}
				if (isCurrent()) watchValuesStore.set(resolved);
			})().catch(() => {
				if (isCurrent())
					watchValuesStore.set(
						expressions.map((expression) => ({ expression, value: 'error' }))
					);
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
		if (terminal.setSourceBreakpoints) {
			const specs = get(structuredBreakpointsStore).get(sourcePath) ?? [];
			const temporaryLine =
				sourcePath === get(sourcePathStore) ? get(runToCursorLineStore) : null;
			const structured = lines.map((line) =>
				line === temporaryLine
					? { line }
					: { ...(specs.find((spec) => spec.line === line) ?? { line }) }
			);
			return sourcePath
				? terminal.setSourceBreakpoints(structured, sourcePath)
				: terminal.setSourceBreakpoints(structured);
		}
		const specs = get(structuredBreakpointsStore).get(sourcePath) ?? [];
		if (
			specs.some(
				(spec) =>
					spec.enabled !== false &&
					(spec.condition || spec.hitCondition || spec.logMessage)
			)
		) {
			return Promise.reject(
				new Error('Structured breakpoints are unsupported by this runtime')
			);
		}
		if (!terminal.setBreakpoints) return Promise.resolve();
		return sourcePath
			? terminal.setBreakpoints(lines, sourcePath)
			: terminal.setBreakpoints(lines);
	}

	function syncBreakpoints() {
		const terminal = get(terminalStore);
		if (
			!shouldSyncBreakpoints() ||
			(!terminal?.setBreakpoints && !terminal?.setSourceBreakpoints)
		)
			return;
		void dispatchTrackedBreakpoints(terminal, getEffectiveBreakpoints());
	}

	async function dispatchTrackedBreakpoints(
		terminal: DebugTerminalControl,
		lines: number[],
		sourcePath = get(sourcePathStore)
	) {
		const request = ++breakpointRequestSequence;
		breakpointRequests.set(sourcePath, request);
		try {
			await dispatchBreakpoints(terminal, lines, sourcePath);
			if (breakpointRequests.get(sourcePath) !== request) return false;
			if (sourcePath === get(sourcePathStore)) breakpointErrorStore.set(null);
			return true;
		} catch (error) {
			if (
				breakpointRequests.get(sourcePath) === request &&
				sourcePath === get(sourcePathStore)
			)
				breakpointErrorStore.set(error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	async function setStructuredBreakpoints(
		breakpoints: DebugSourceBreakpoint[],
		sourcePath = get(sourcePathStore)
	) {
		const normalized = normalizeDebugSourceBreakpoints(breakpoints);
		if (get(pausedStore)) {
			try {
				assertDebugBreakpointSupport(normalized, get(capabilitiesStore));
			} catch (error) {
				breakpointErrorStore.set(error instanceof Error ? error.message : String(error));
				return false;
			}
		}
		structuredBreakpointsStore.update((current) =>
			new Map(current).set(sourcePath, normalized)
		);
		const lines = normalized.filter((spec) => spec.enabled !== false).map((spec) => spec.line);
		breakpointsBySourceStore.update((current) => new Map(current).set(sourcePath, lines));
		if (sourcePath === get(sourcePathStore)) breakpointsStore.set(lines);
		const terminal = get(terminalStore);
		if (shouldSyncBreakpoints() && terminal) {
			if (!terminal.setBreakpoints && !terminal.setSourceBreakpoints) return false;
			return dispatchTrackedBreakpoints(
				terminal,
				getEffectiveBreakpoints(sourcePath),
				sourcePath
			);
		}
		return true;
	}

	async function setSteppingOptions(stepping: DebugSteppingOptions) {
		const normalized = normalizeDebugSteppingOptions(stepping);
		const terminal = get(terminalStore);
		const version = ++steppingRequestVersion;
		if (get(activeStore)) {
			if (
				!terminal?.debugSetSteppingOptions ||
				(normalized.skipLibraryCode && !get(capabilitiesStore).skipLibraryCode)
			)
				return false;
			try {
				await terminal.debugSetSteppingOptions({ ...normalized });
			} catch (error) {
				if (version !== steppingRequestVersion || terminal !== get(terminalStore))
					return false;
				throw error;
			}
		}
		if (version !== steppingRequestVersion || terminal !== get(terminalStore)) return false;
		steppingOptionsStore.set(normalized);
		return true;
	}

	function clearPauseState() {
		steppingRequestVersion += 1;
		variableViewSuspended = true;
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
		variableState.reset();
		pendingTransition = null;
		dataBreakpointSpecs = [];
		watchpointGeneration += 1;
		variableViewSuspended = false;
		updateVariableView();
	}

	function reset() {
		breakpointRequests.clear();
		activeStore.set(false);
		resolvedBreakpointsStore.set([]);
		resolvedBreakpointsBySourceStore.set(new Map());
		clearPauseState();
		refreshWatchValues();
	}

	function begin() {
		breakpointRequests.clear();
		historyStore.set(Object.freeze([]));
		selectedHistoryIdStore.set(null);
		observedSessionId = undefined;
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
			variableViewSuspended = true;
			releaseCommandRequest();
			invalidateVariableRequests();
			const sameSession = observedSessionId === event.sessionId;
			if (!sameSession) dataBreakpointSpecs = [];
			observedSessionId = event.sessionId;
			const frameKeys = event.callStack
				.map((frame) =>
					debugFramePathKey(
						event.callStack,
						frame.id ?? null,
						event.sourcePath || get(sourcePathStore)
					)
				)
				.filter((key): key is string => key !== null);
			const sameThread = (event.threadId ?? null) === get(threadIdStore);
			const staleSource =
				event.sourceRevisionStale ||
				get(staleSourcePathsStore).has(event.sourcePath || get(sourcePathStore));
			variableState.beginStop(
				frameKeys,
				sameSession &&
					sameThread &&
					!terminalChangedSinceStop &&
					pendingTransition !== null &&
					pendingTransition !== 'continue' &&
					!staleSource
			);
			terminalChangedSinceStop = false;
			pendingTransition = null;
			currentStopId += 1;
			currentStopTimestamp = Date.now();
			activeStore.set(true);
			capabilitiesStore.set({ ...(event.capabilities ?? disabledCapabilities) });
			const restoreBreakpoints = get(runToCursorLineStore) !== null;
			runToCursorLineStore.set(null);
			if (restoreBreakpoints) {
				const terminal = get(terminalStore);
				if (terminal?.setBreakpoints || terminal?.setSourceBreakpoints) {
					void dispatchTrackedBreakpoints(terminal, [...get(breakpointsStore)]);
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
			variableViewSuspended = false;
			updateVariableView();
			loadTopLevelVariables();
			refreshWatchValues();
			return;
		}
		if (event.type === 'resume') {
			variableViewSuspended = true;
			pendingTransition = pendingTransition ?? event.command;
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
			variableViewSuspended = false;
			updateVariableView();
			refreshWatchValues();
			return;
		}
		reset();
	}

	function setTerminal(terminal?: DebugTerminalControl) {
		if (get(terminalStore) !== terminal) {
			steppingRequestVersion += 1;
			terminalChangedSinceStop = true;
			pendingTransition = null;
			dataBreakpointSpecs = [];
			invalidateVariableRequests();
			variableViewSuspended = false;
		}
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
		const previous = get(structuredBreakpointsStore).get(sourcePath);
		const nextSpecifications = lines.map((line) => {
			const spec = previous?.find((entry) => entry.line === line);
			return { ...(spec ?? { line }), ...(spec?.enabled === false ? { enabled: true } : {}) };
		});
		if (get(pausedStore))
			assertDebugBreakpointSupport(nextSpecifications, get(capabilitiesStore));
		structuredBreakpointsStore.update((current) =>
			new Map(current).set(sourcePath, nextSpecifications)
		);
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
		pendingTransition = command;
		try {
			await terminal.debugCommand(command);
			return true;
		} catch (error) {
			if (version === commandRequestVersion) pendingTransition = null;
			throw error;
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
			(!terminal.setBreakpoints && !terminal.setSourceBreakpoints)
		) {
			return false;
		}
		const nextBreakpoints = breakpoints.includes(targetLine)
			? [...breakpoints]
			: [...breakpoints, targetLine].sort((left, right) => left - right);
		const targetSpec = get(structuredBreakpointsStore)
			.get(get(sourcePathStore))
			?.find((spec) => spec.line === targetLine);
		const needsUnconditionalTarget = !!(
			targetSpec?.condition ||
			targetSpec?.hitCondition ||
			targetSpec?.logMessage
		);
		runToCursorLineStore.set(
			breakpoints.includes(targetLine) && !needsUnconditionalTarget ? null : targetLine
		);
		const version = beginCommandRequest();
		pendingTransition = 'continue';
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
		variableViewSuspended = true;
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
				variableViewSuspended = false;
				updateVariableView();
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
		variableViewSuspended = false;
		updateVariableView();
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
		const frameVersion = frameRequestVersion;
		watchpointGeneration += 1;
		const requested = breakpoints.map((spec) => ({ ...spec }));
		try {
			const resolved = await terminal.debugSetDataBreakpoints(requested);
			if (frameVersion !== frameRequestVersion || !get(pausedStore)) return [];
			dataBreakpointSpecs = requested
				.filter((_spec, index) => resolved[index]?.verified)
				.map((spec) => ({ ...spec }));
			return resolved;
		} finally {
			finishCommandRequest(version);
		}
	}

	// Store subscriptions keep all consumers (locals, Watch, hover and inline adapters) on one cache.
	for (const store of [
		localsStore,
		callStackStore,
		scopesStore,
		variablesByReferenceStore,
		loadingVariableReferencesStore,
		pausedStore,
		frameIdStore,
		watchValuesStore
	])
		store.subscribe(updateVariableView);

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
		get variableNodes() {
			return variableNodesState.current;
		},
		scopeNodes(scope: DebugScope) {
			return scopeNodesState.current.get(scope.variablesReference) ?? [];
		},
		get history() {
			return historyState.current;
		},
		get selectedHistoryId() {
			return selectedHistoryIdState.current;
		},
		get selectedHistory() {
			return (
				historyState.current.find(
					(snapshot) => snapshot.id === selectedHistoryIdState.current
				) ?? null
			);
		},
		get steppingOptions() {
			return { ...steppingOptionsState.current };
		},
		get structuredBreakpoints(): DebugSourceBreakpoint[] {
			return (
				structuredBreakpointsState.current.get(sourcePathState.current) ??
				breakpointsState.current.map((line) => ({ line }))
			).map((spec) => ({ ...spec }));
		},
		get breakpointError() {
			return breakpointErrorState.current;
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
			return Array.from(breakpointsBySourceState.current, ([sourcePath, lines]) => {
				const specs = structuredBreakpointsState.current.get(sourcePath);
				return {
					sourcePath,
					lines: [...lines],
					...(specs?.some(
						(spec) =>
							spec.enabled !== undefined ||
							spec.condition !== undefined ||
							spec.hitCondition !== undefined ||
							spec.logMessage !== undefined
					)
						? { breakpoints: specs.map((spec) => ({ ...spec })) }
						: {})
				};
			});
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
				!!(terminal?.setBreakpoints || terminal?.setSourceBreakpoints)
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
			const nodes = watchNodesState.current;
			return watchValuesState.current.map((watch) => {
				const node = nodes.get(watch.expression);
				return node ? { ...watch, node } : watch;
			});
		},
		begin,
		reset,
		handleEvent,
		setTerminal,
		setAdapter,
		setSourcePath,
		markSourceRevisionStale,
		setBreakpoints,
		setStructuredBreakpoints,
		setSteppingOptions,
		setCursorLine,
		sendCommand,
		pause,
		runToCursor,
		stop,
		addWatchExpression,
		addWatchFromVariable,
		resolveHover,
		watchVariable,
		expandVariable,
		loadMoreVariablePath,
		selectHistory,
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
