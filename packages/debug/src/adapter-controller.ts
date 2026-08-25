import { fromStore, get, writable } from 'svelte/store';

import {
	DebugAdapterStateError,
	type DebugAdapter,
	type DebugAdapterEvent,
	type DebugCapabilities,
	type DebugDataBreakpoint,
	type DebugDataBreakpointInfo,
	type DebugDataBreakpointInfoArguments,
	type DebugDisconnectOptions,
	type DebugEvaluateResult,
	type DebugLaunchConfig,
	type DebugMemory,
	type DebugScope,
	type DebugSource,
	type DebugStackFrame,
	type DebugThread,
	type DebugVariable,
	type DebugWriteMemoryResult,
	type ResolvedDataBreakpoint,
	type ResolvedBreakpoint
} from './adapter/index.js';

export type AdapterDebugOutput = Extract<DebugAdapterEvent, { type: 'output' }>;

function debugSourceKey(source: DebugSource) {
	if (source.path) return `path:${source.path}`;
	if (source.sourceReference !== undefined) return `reference:${source.sourceReference}`;
	if (source.name) return `name:${source.name}`;
	return 'anonymous';
}

function normalizeError(error: unknown) {
	return error instanceof Error ? error : new Error(String(error));
}

export function createAdapterDebugSessionController(adapter: DebugAdapter) {
	const activeStore = writable(false);
	const stoppedReasonStore = writable<string | null>(null);
	const outputStore = writable<AdapterDebugOutput[]>([]);
	const exitCodeStore = writable<number | null>(null);
	const errorStore = writable<Error | null>(null);
	const capabilitiesStore = writable<DebugCapabilities | null>(adapter.capabilities);
	const breakpointsStore = writable<ResolvedBreakpoint[]>([]);
	const threadsStore = writable<DebugThread[]>([]);
	const selectedThreadIdStore = writable<number | null>(null);
	const framesStore = writable<DebugStackFrame[]>([]);
	const selectedFrameIdStore = writable<number | null>(null);
	const scopesStore = writable<DebugScope[]>([]);
	const variablesByReferenceStore = writable<ReadonlyMap<number, DebugVariable[]>>(new Map());

	const activeState = fromStore(activeStore);
	const stoppedReasonState = fromStore(stoppedReasonStore);
	const outputState = fromStore(outputStore);
	const exitCodeState = fromStore(exitCodeStore);
	const errorState = fromStore(errorStore);
	const capabilitiesState = fromStore(capabilitiesStore);
	const breakpointsState = fromStore(breakpointsStore);
	const threadsState = fromStore(threadsStore);
	const selectedThreadIdState = fromStore(selectedThreadIdStore);
	const framesState = fromStore(framesStore);
	const selectedFrameIdState = fromStore(selectedFrameIdStore);
	const scopesState = fromStore(scopesStore);
	const variablesByReferenceState = fromStore(variablesByReferenceStore);

	let sessionGeneration = 0;
	let stoppedGeneration = 0;
	let requestSequence = 0;
	const breakpointRequestTokens = new Map<string, number>();
	const variableRequestTokens = new Map<number, number>();

	function isCurrentSession(token: number) {
		return token === sessionGeneration;
	}

	function isCurrentStop(sessionToken: number, stopToken: number) {
		return isCurrentSession(sessionToken) && stopToken === stoppedGeneration;
	}

	function clearStoppedDetails(options: { preserveThreads?: boolean } = {}) {
		stoppedReasonStore.set(null);
		if (!options.preserveThreads) {
			threadsStore.set([]);
			selectedThreadIdStore.set(null);
		}
		framesStore.set([]);
		selectedFrameIdStore.set(null);
		scopesStore.set([]);
		variablesByReferenceStore.set(new Map());
		variableRequestTokens.clear();
	}

	function resetForLaunch() {
		activeStore.set(true);
		outputStore.set([]);
		exitCodeStore.set(null);
		errorStore.set(null);
		breakpointsStore.set([]);
		clearStoppedDetails();
	}

	function recordError(error: unknown) {
		const normalized = normalizeError(error);
		errorStore.set(normalized);
		return normalized;
	}

	async function initialize() {
		const sessionToken = sessionGeneration;
		try {
			const capabilities = await adapter.initialize();
			if (isCurrentSession(sessionToken)) capabilitiesStore.set(capabilities);
			return capabilities;
		} catch (error) {
			if (isCurrentSession(sessionToken)) recordError(error);
			throw error;
		}
	}

	async function launch(config: DebugLaunchConfig) {
		const sessionToken = ++sessionGeneration;
		stoppedGeneration += 1;
		breakpointRequestTokens.clear();
		resetForLaunch();
		try {
			const capabilities = await adapter.initialize();
			if (!isCurrentSession(sessionToken)) return;
			capabilitiesStore.set(capabilities);
			await adapter.launch(config);
		} catch (error) {
			if (isCurrentSession(sessionToken)) {
				activeStore.set(false);
				recordError(error);
			}
			throw error;
		}
	}

	function replaceBreakpointsForSource(source: DebugSource, breakpoints: ResolvedBreakpoint[]) {
		const sourceKey = debugSourceKey(source);
		breakpointsStore.update((current) => [
			...current.filter((breakpoint) => debugSourceKey(breakpoint.source) !== sourceKey),
			...breakpoints
		]);
	}

	async function setBreakpoints(source: DebugSource, lines: number[]) {
		const sessionToken = sessionGeneration;
		const sourceKey = debugSourceKey(source);
		const requestToken = ++requestSequence;
		breakpointRequestTokens.set(sourceKey, requestToken);
		try {
			const breakpoints = await adapter.setBreakpoints(source, lines);
			if (
				!isCurrentSession(sessionToken) ||
				breakpointRequestTokens.get(sourceKey) !== requestToken
			) {
				return breakpointsState.current.filter(
					(breakpoint) => debugSourceKey(breakpoint.source) === sourceKey
				);
			}
			replaceBreakpointsForSource(source, breakpoints);
			return breakpoints;
		} catch (error) {
			const isCurrentRequest =
				isCurrentSession(sessionToken) &&
				breakpointRequestTokens.get(sourceKey) === requestToken;
			if (isCurrentRequest) {
				recordError(error);
				throw error;
			}
			return breakpointsState.current.filter(
				(breakpoint) => debugSourceKey(breakpoint.source) === sourceKey
			);
		}
	}

	function applyBreakpointEvent(event: Extract<DebugAdapterEvent, { type: 'breakpoint' }>) {
		breakpointsStore.update((current) => {
			const matchIndex = current.findIndex((breakpoint) => {
				if (event.breakpoint.id !== undefined && breakpoint.id !== undefined) {
					return event.breakpoint.id === breakpoint.id;
				}
				return (
					debugSourceKey(event.breakpoint.source) === debugSourceKey(breakpoint.source) &&
					event.breakpoint.requestedLine === breakpoint.requestedLine
				);
			});
			if (event.reason === 'removed') {
				return matchIndex < 0
					? current
					: current.filter((_breakpoint, index) => index !== matchIndex);
			}
			if (matchIndex < 0) return [...current, event.breakpoint];
			return current.map((breakpoint, index) =>
				index === matchIndex ? event.breakpoint : breakpoint
			);
		});
	}

	function mergeVariables(
		variablesReference: number,
		variables: DebugVariable[],
		start?: number
	) {
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
	}

	async function loadVariables(
		variablesReference: number,
		start: number | undefined,
		count: number | undefined,
		sessionToken: number,
		stopToken: number
	) {
		const requestToken = ++requestSequence;
		variableRequestTokens.set(variablesReference, requestToken);
		const variables = await adapter.variables(variablesReference, start, count);
		if (
			!isCurrentStop(sessionToken, stopToken) ||
			variableRequestTokens.get(variablesReference) !== requestToken
		) {
			return [];
		}
		mergeVariables(variablesReference, variables, start);
		return variables;
	}

	async function loadScopesForFrame(frameId: number, sessionToken: number, stopToken: number) {
		const scopes = await adapter.scopes(frameId);
		if (!isCurrentStop(sessionToken, stopToken)) return;
		scopesStore.set(scopes);
		variablesByReferenceStore.set(new Map());
		variableRequestTokens.clear();
	}

	async function loadFramesForThread(threadId: number, sessionToken: number, stopToken: number) {
		const frames = await adapter.stackTrace(threadId);
		if (!isCurrentStop(sessionToken, stopToken)) return;
		framesStore.set(frames);
		const selectedFrameId = frames[0]?.id ?? null;
		selectedFrameIdStore.set(selectedFrameId);
		scopesStore.set([]);
		variablesByReferenceStore.set(new Map());
		variableRequestTokens.clear();
		if (selectedFrameId !== null) {
			await loadScopesForFrame(selectedFrameId, sessionToken, stopToken);
		}
	}

	async function loadStoppedState(
		event: Extract<DebugAdapterEvent, { type: 'stopped' }>,
		sessionToken: number,
		stopToken: number
	) {
		const threads = await adapter.threads();
		if (!isCurrentStop(sessionToken, stopToken)) return;
		threadsStore.set(threads);
		const selectedThreadId =
			event.threadId !== undefined &&
			(threads.length === 0 || threads.some((thread) => thread.id === event.threadId))
				? event.threadId
				: (threads[0]?.id ?? null);
		selectedThreadIdStore.set(selectedThreadId);
		if (selectedThreadId !== null) {
			await loadFramesForThread(selectedThreadId, sessionToken, stopToken);
		}
	}

	function handleStopped(event: Extract<DebugAdapterEvent, { type: 'stopped' }>) {
		const sessionToken = sessionGeneration;
		const stopToken = ++stoppedGeneration;
		activeStore.set(true);
		stoppedReasonStore.set(event.reason);
		errorStore.set(null);
		threadsStore.set([]);
		selectedThreadIdStore.set(null);
		framesStore.set([]);
		selectedFrameIdStore.set(null);
		scopesStore.set([]);
		variablesByReferenceStore.set(new Map());
		variableRequestTokens.clear();
		void loadStoppedState(event, sessionToken, stopToken).catch((error: unknown) => {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
		});
	}

	function handleAdapterEvent(event: DebugAdapterEvent) {
		if (event.type === 'stopped') {
			handleStopped(event);
			return;
		}
		if (event.type === 'continued') {
			stoppedGeneration += 1;
			activeStore.set(true);
			if (event.threadId > 0) selectedThreadIdStore.set(event.threadId);
			clearStoppedDetails({ preserveThreads: true });
			return;
		}
		if (event.type === 'output') {
			outputStore.update((output) => [...output, event]);
			return;
		}
		if (event.type === 'exited') {
			stoppedGeneration += 1;
			activeStore.set(false);
			exitCodeStore.set(event.exitCode);
			clearStoppedDetails({ preserveThreads: true });
			return;
		}
		if (event.type === 'terminated') {
			sessionGeneration += 1;
			stoppedGeneration += 1;
			activeStore.set(false);
			clearStoppedDetails();
			return;
		}
		if (event.type === 'breakpoint') {
			applyBreakpointEvent(event);
			return;
		}
		if (event.type === 'thread' && event.reason === 'exited') {
			threadsStore.update((threads) =>
				threads.filter((thread) => thread.id !== event.threadId)
			);
			if (get(selectedThreadIdStore) === event.threadId) {
				stoppedGeneration += 1;
				selectedThreadIdStore.set(null);
				framesStore.set([]);
				selectedFrameIdStore.set(null);
				scopesStore.set([]);
				variablesByReferenceStore.set(new Map());
				variableRequestTokens.clear();
			}
			return;
		}
		if (event.type === 'process') activeStore.set(true);
	}

	const unsubscribe = adapter.onEvent(handleAdapterEvent);

	async function selectThread(threadId: number) {
		if (!get(threadsStore).some((thread) => thread.id === threadId)) {
			throw new RangeError(`Unknown debug thread ${threadId}.`);
		}
		const sessionToken = sessionGeneration;
		const stopToken = ++stoppedGeneration;
		selectedThreadIdStore.set(threadId);
		framesStore.set([]);
		selectedFrameIdStore.set(null);
		scopesStore.set([]);
		variablesByReferenceStore.set(new Map());
		variableRequestTokens.clear();
		try {
			await loadFramesForThread(threadId, sessionToken, stopToken);
		} catch (error) {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
			throw error;
		}
	}

	async function selectFrame(frameId: number) {
		if (!get(framesStore).some((frame) => frame.id === frameId)) {
			throw new RangeError(`Unknown debug frame ${frameId}.`);
		}
		const sessionToken = sessionGeneration;
		const stopToken = ++stoppedGeneration;
		selectedFrameIdStore.set(frameId);
		scopesStore.set([]);
		variablesByReferenceStore.set(new Map());
		variableRequestTokens.clear();
		try {
			await loadScopesForFrame(frameId, sessionToken, stopToken);
		} catch (error) {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
			throw error;
		}
	}

	async function loadVariableChildren(
		variablesReference: number,
		start?: number,
		count?: number
	) {
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			return await loadVariables(variablesReference, start, count, sessionToken, stopToken);
		} catch (error) {
			if (!isCurrentStop(sessionToken, stopToken)) return [];
			recordError(error);
			throw error;
		}
	}

	function resolveThreadId(threadId?: number) {
		const resolved = threadId ?? get(selectedThreadIdStore) ?? get(threadsStore)[0]?.id ?? null;
		if (resolved === null) {
			throw new DebugAdapterStateError('No debug thread is selected.');
		}
		return resolved;
	}

	async function resume(command: 'continue' | 'next' | 'stepIn' | 'stepOut', threadId?: number) {
		const resolvedThreadId = resolveThreadId(threadId);
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			await adapter[command](resolvedThreadId);
			if (isCurrentStop(sessionToken, stopToken)) {
				stoppedGeneration += 1;
				clearStoppedDetails({ preserveThreads: true });
			}
		} catch (error) {
			if (!isCurrentStop(sessionToken, stopToken)) return;
			recordError(error);
			throw error;
		}
	}

	async function continueExecution(threadId?: number) {
		await resume('continue', threadId);
	}

	async function next(threadId?: number) {
		await resume('next', threadId);
	}

	async function stepIn(threadId?: number) {
		await resume('stepIn', threadId);
	}

	async function stepOut(threadId?: number) {
		await resume('stepOut', threadId);
	}

	async function pause(threadId?: number) {
		const resolvedThreadId = resolveThreadId(threadId);
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			await adapter.pause(resolvedThreadId);
		} catch (error) {
			if (!isCurrentStop(sessionToken, stopToken)) return;
			recordError(error);
			throw error;
		}
	}

	async function evaluate(
		expression: string,
		frameId = get(selectedFrameIdStore) ?? undefined
	): Promise<DebugEvaluateResult> {
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			return await adapter.evaluate(expression, frameId);
		} catch (error) {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
			throw error;
		}
	}

	async function readMemory(
		memoryReference: string,
		offset: number,
		count: number
	): Promise<DebugMemory> {
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			return await adapter.readMemory(memoryReference, offset, count);
		} catch (error) {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
			throw error;
		}
	}

	async function writeMemory(
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial?: boolean
	): Promise<DebugWriteMemoryResult> {
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			return await adapter.writeMemory(memoryReference, offset, data, allowPartial);
		} catch (error) {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
			throw error;
		}
	}

	async function dataBreakpointInfo(
		arguments_: DebugDataBreakpointInfoArguments
	): Promise<DebugDataBreakpointInfo> {
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			return await adapter.dataBreakpointInfo(arguments_);
		} catch (error) {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
			throw error;
		}
	}

	async function setDataBreakpoints(
		breakpoints: DebugDataBreakpoint[]
	): Promise<ResolvedDataBreakpoint[]> {
		const sessionToken = sessionGeneration;
		const stopToken = stoppedGeneration;
		try {
			return await adapter.setDataBreakpoints(breakpoints);
		} catch (error) {
			if (isCurrentStop(sessionToken, stopToken)) recordError(error);
			throw error;
		}
	}

	async function disconnect(options?: DebugDisconnectOptions) {
		const sessionToken = ++sessionGeneration;
		stoppedGeneration += 1;
		activeStore.set(false);
		clearStoppedDetails();
		try {
			await adapter.disconnect(options);
		} catch (error) {
			if (isCurrentSession(sessionToken)) recordError(error);
			throw error;
		}
	}

	function clearOutput() {
		outputStore.set([]);
	}

	function dispose() {
		sessionGeneration += 1;
		stoppedGeneration += 1;
		unsubscribe();
	}

	return {
		get active() {
			return activeState.current;
		},
		get stoppedReason() {
			return stoppedReasonState.current;
		},
		get output() {
			return outputState.current;
		},
		get exitCode() {
			return exitCodeState.current;
		},
		get error() {
			return errorState.current;
		},
		get capabilities() {
			return capabilitiesState.current;
		},
		get breakpoints() {
			return breakpointsState.current;
		},
		get verifiedBreakpoints() {
			return breakpointsState.current.filter((breakpoint) => breakpoint.verified);
		},
		get threads() {
			return threadsState.current;
		},
		get selectedThreadId() {
			return selectedThreadIdState.current;
		},
		get frames() {
			return framesState.current;
		},
		get selectedFrameId() {
			return selectedFrameIdState.current;
		},
		get scopes() {
			return scopesState.current;
		},
		get variablesByReference() {
			return variablesByReferenceState.current;
		},
		initialize,
		launch,
		setBreakpoints,
		selectThread,
		selectFrame,
		loadVariableChildren,
		continue: continueExecution,
		pause,
		next,
		stepIn,
		stepOut,
		evaluate,
		readMemory,
		writeMemory,
		dataBreakpointInfo,
		setDataBreakpoints,
		disconnect,
		clearOutput,
		dispose
	};
}

export type AdapterDebugSessionController = ReturnType<typeof createAdapterDebugSessionController>;
