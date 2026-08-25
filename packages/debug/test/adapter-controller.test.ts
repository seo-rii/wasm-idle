import { describe, expect, it, vi } from 'vitest';

import {
	createAdapterDebugSessionController,
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
} from '../src/index.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const capabilities: DebugCapabilities = {
	supportsConfigurationDone: true,
	supportsBreakpoints: true,
	supportsConditionalBreakpoints: false,
	supportsLogPoints: false,
	supportsContinue: true,
	supportsPause: true,
	supportsStepIn: true,
	supportsStepOver: true,
	supportsStepOut: true,
	supportsThreads: true,
	supportsStackTrace: true,
	supportsScopes: true,
	supportsVariables: true,
	supportsEvaluate: true,
	supportsEvaluateForHovers: false,
	supportsReadMemory: true,
	supportsWriteMemory: true,
	supportsDataBreakpoints: false,
	supportsSetVariable: false,
	supportsRestart: false,
	supportsTerminate: true
};

class FakeDebugAdapter implements DebugAdapter {
	readonly kind = 'lldb' as const;
	capabilities: DebugCapabilities | null = null;
	readonly transcript: string[] = [];
	readonly #listeners = new Set<(event: DebugAdapterEvent) => void>();

	initializeHandler = async () => capabilities;
	launchHandler = async (_config: DebugLaunchConfig) => undefined;
	disconnectHandler = async (_options?: DebugDisconnectOptions) => undefined;
	setBreakpointsHandler = async (
		source: DebugSource,
		lines: number[]
	): Promise<ResolvedBreakpoint[]> =>
		lines.map((line) => ({
			verified: true,
			source,
			requestedLine: line,
			line
		}));
	continueHandler: (threadId: number) => Promise<void> = async (_threadId) => undefined;
	pauseHandler = async (_threadId: number) => undefined;
	nextHandler = async (_threadId: number) => undefined;
	stepInHandler = async (_threadId: number) => undefined;
	stepOutHandler = async (_threadId: number) => undefined;
	threadsHandler = async (): Promise<DebugThread[]> => [];
	stackTraceHandler = async (
		_threadId: number,
		_startFrame?: number,
		_levels?: number
	): Promise<DebugStackFrame[]> => [];
	scopesHandler = async (_frameId: number): Promise<DebugScope[]> => [];
	variablesHandler = async (
		_variablesReference: number,
		_start?: number,
		_count?: number
	): Promise<DebugVariable[]> => [];
	readMemoryHandler = async (
		_memoryReference: string,
		_offset: number,
		_count: number
	): Promise<DebugMemory> => ({ data: new Uint8Array(), unreadableBytes: 0 });
	writeMemoryHandler = async (
		_memoryReference: string,
		_offset: number,
		_data: Uint8Array,
		_allowPartial?: boolean
	): Promise<DebugWriteMemoryResult> => ({ bytesWritten: 0 });
	dataBreakpointInfoHandler = async (
		_arguments: DebugDataBreakpointInfoArguments
	): Promise<DebugDataBreakpointInfo> => ({ description: 'unavailable' });
	setDataBreakpointsHandler = async (
		_breakpoints: DebugDataBreakpoint[]
	): Promise<ResolvedDataBreakpoint[]> => [];
	evaluateHandler = async (
		expression: string,
		_frameId?: number
	): Promise<DebugEvaluateResult> => ({ result: expression, variablesReference: 0 });

	async initialize() {
		this.transcript.push('initialize');
		const result = await this.initializeHandler();
		this.capabilities = result;
		return result;
	}

	async launch(config: DebugLaunchConfig) {
		this.transcript.push(`launch:${String(config.program || '')}`);
		await this.launchHandler(config);
	}

	async disconnect(options?: DebugDisconnectOptions) {
		this.transcript.push(`disconnect:${options?.terminateTarget === true}`);
		await this.disconnectHandler(options);
	}

	async setBreakpoints(source: DebugSource, lines: number[]) {
		this.transcript.push(
			`setBreakpoints:${String(source.path || source.name)}:${lines.join(',')}`
		);
		return this.setBreakpointsHandler(source, lines);
	}

	async continue(threadId: number) {
		this.transcript.push(`continue:${threadId}`);
		await this.continueHandler(threadId);
	}

	async pause(threadId: number) {
		this.transcript.push(`pause:${threadId}`);
		await this.pauseHandler(threadId);
	}

	async next(threadId: number) {
		this.transcript.push(`next:${threadId}`);
		await this.nextHandler(threadId);
	}

	async stepIn(threadId: number) {
		this.transcript.push(`stepIn:${threadId}`);
		await this.stepInHandler(threadId);
	}

	async stepOut(threadId: number) {
		this.transcript.push(`stepOut:${threadId}`);
		await this.stepOutHandler(threadId);
	}

	async threads() {
		this.transcript.push('threads');
		return this.threadsHandler();
	}

	async stackTrace(threadId: number, startFrame?: number, levels?: number) {
		this.transcript.push(`stackTrace:${threadId}`);
		return this.stackTraceHandler(threadId, startFrame, levels);
	}

	async scopes(frameId: number) {
		this.transcript.push(`scopes:${frameId}`);
		return this.scopesHandler(frameId);
	}

	async variables(variablesReference: number, start?: number, count?: number) {
		this.transcript.push(
			`variables:${variablesReference}:${String(start ?? '')}:${String(count ?? '')}`
		);
		return this.variablesHandler(variablesReference, start, count);
	}

	async readMemory(memoryReference: string, offset: number, count: number) {
		this.transcript.push(`readMemory:${memoryReference}:${offset}:${count}`);
		return this.readMemoryHandler(memoryReference, offset, count);
	}

	async writeMemory(
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial?: boolean
	) {
		this.transcript.push(
			`writeMemory:${memoryReference}:${offset}:${Array.from(data).join(',')}:${allowPartial === true}`
		);
		return this.writeMemoryHandler(memoryReference, offset, data, allowPartial);
	}

	async dataBreakpointInfo(arguments_: DebugDataBreakpointInfoArguments) {
		this.transcript.push(`dataBreakpointInfo:${arguments_.name}`);
		return this.dataBreakpointInfoHandler(arguments_);
	}

	async setDataBreakpoints(breakpoints: DebugDataBreakpoint[]) {
		this.transcript.push(
			`setDataBreakpoints:${breakpoints.map(({ dataId, accessType }) => `${dataId}:${accessType ?? ''}`).join(',')}`
		);
		return this.setDataBreakpointsHandler(breakpoints);
	}

	async evaluate(expression: string, frameId?: number) {
		this.transcript.push(`evaluate:${expression}:${String(frameId ?? '')}`);
		return this.evaluateHandler(expression, frameId);
	}

	onEvent(listener: (event: DebugAdapterEvent) => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	emit(event: DebugAdapterEvent) {
		for (const listener of this.#listeners) listener(event);
	}
}

describe('createAdapterDebugSessionController', () => {
	it('loads stopped state in transcript order without recursively loading variable children', async () => {
		const adapter = new FakeDebugAdapter();
		adapter.threadsHandler = async () => [{ id: 2, name: 'Wasm main thread' }];
		adapter.stackTraceHandler = async () => [
			{
				id: 20,
				name: 'main',
				source: { path: '/workspace/main.cpp' },
				line: 8,
				column: 1
			}
		];
		adapter.scopesHandler = async () => [
			{
				name: 'Locals',
				presentationHint: 'locals',
				variablesReference: 30,
				expensive: false
			},
			{
				name: 'Globals',
				variablesReference: 31,
				expensive: true
			}
		];
		adapter.variablesHandler = async (variablesReference) => {
			if (variablesReference === 30) {
				return [
					{
						name: 'point',
						value: '{x = 1, y = 2}',
						variablesReference: 100
					}
				];
			}
			if (variablesReference === 31) {
				return [{ name: 'total', value: '3', variablesReference: 0 }];
			}
			return [
				{ name: 'x', value: '1', variablesReference: 0 },
				{ name: 'y', value: '2', variablesReference: 0 }
			];
		};
		const controller = createAdapterDebugSessionController(adapter);
		await controller.launch({ program: '/workspace/program.wasm' });
		adapter.transcript.length = 0;

		adapter.emit({
			type: 'stopped',
			reason: 'breakpoint',
			threadId: 2,
			allThreadsStopped: true
		});

		await vi.waitFor(() => expect(controller.scopes).toHaveLength(2));
		expect(adapter.transcript).toEqual(['threads', 'stackTrace:2', 'scopes:20']);
		expect(controller.active).toBe(true);
		expect(controller.stoppedReason).toBe('breakpoint');
		expect(controller.threads).toEqual([{ id: 2, name: 'Wasm main thread' }]);
		expect(controller.selectedThreadId).toBe(2);
		expect(controller.frames).toEqual([
			{
				id: 20,
				name: 'main',
				source: { path: '/workspace/main.cpp' },
				line: 8,
				column: 1
			}
		]);
		expect(controller.selectedFrameId).toBe(20);
		expect(controller.scopes.map((scope) => scope.variablesReference)).toEqual([30, 31]);
		expect(controller.variablesByReference.has(30)).toBe(false);
		expect(controller.variablesByReference.has(31)).toBe(false);
		expect(controller.variablesByReference.has(100)).toBe(false);

		await expect(controller.loadVariableChildren(30)).resolves.toEqual([
			{
				name: 'point',
				value: '{x = 1, y = 2}',
				variablesReference: 100
			}
		]);
		expect(controller.variablesByReference.get(30)).toEqual([
			{
				name: 'point',
				value: '{x = 1, y = 2}',
				variablesReference: 100
			}
		]);
		expect(controller.variablesByReference.has(100)).toBe(false);

		await expect(controller.loadVariableChildren(100, 0, 2)).resolves.toEqual([
			{ name: 'x', value: '1', variablesReference: 0 },
			{ name: 'y', value: '2', variablesReference: 0 }
		]);
		expect(adapter.transcript.at(-1)).toBe('variables:100:0:2');
		expect(controller.variablesByReference.get(100)).toEqual([
			{ name: 'x', value: '1', variablesReference: 0 },
			{ name: 'y', value: '2', variablesReference: 0 }
		]);
	});

	it('keeps resolved breakpoints source-aware and applies breakpoint events', async () => {
		const adapter = new FakeDebugAdapter();
		let nextId = 1;
		adapter.setBreakpointsHandler = async (source, lines) =>
			lines.map((line) => ({
				id: nextId++,
				verified: !source.path?.includes('helper'),
				source,
				requestedLine: line,
				line: line + 1
			}));
		const controller = createAdapterDebugSessionController(adapter);

		await controller.setBreakpoints({ path: '/workspace/main.cpp' }, [3]);
		await controller.setBreakpoints({ path: '/workspace/helper.cpp' }, [7]);

		expect(controller.breakpoints).toEqual([
			{
				id: 1,
				verified: true,
				source: { path: '/workspace/main.cpp' },
				requestedLine: 3,
				line: 4
			},
			{
				id: 2,
				verified: false,
				source: { path: '/workspace/helper.cpp' },
				requestedLine: 7,
				line: 8
			}
		]);
		expect(controller.verifiedBreakpoints.map((breakpoint) => breakpoint.id)).toEqual([1]);

		adapter.emit({
			type: 'breakpoint',
			reason: 'changed',
			breakpoint: {
				id: 2,
				verified: true,
				source: { path: '/workspace/helper.cpp' },
				requestedLine: 7,
				line: 9
			}
		});
		expect(controller.verifiedBreakpoints.map((breakpoint) => breakpoint.id)).toEqual([1, 2]);

		adapter.emit({
			type: 'breakpoint',
			reason: 'removed',
			breakpoint: {
				id: 1,
				verified: false,
				source: { path: '/workspace/main.cpp' },
				requestedLine: 3,
				line: 4
			}
		});
		expect(controller.breakpoints.map((breakpoint) => breakpoint.id)).toEqual([2]);
	});

	it('returns the current breakpoint snapshot from a superseded successful request', async () => {
		const adapter = new FakeDebugAdapter();
		const older = deferred<ResolvedBreakpoint[]>();
		const newer = deferred<ResolvedBreakpoint[]>();
		adapter.setBreakpointsHandler = async (_source, lines) =>
			lines[0] === 3 ? older.promise : newer.promise;
		const controller = createAdapterDebugSessionController(adapter);
		const source = { path: '/workspace/main.cpp' };
		const olderRequest = controller.setBreakpoints(source, [3]);
		const newerRequest = controller.setBreakpoints(source, [7]);
		const currentBreakpoints = [
			{
				id: 7,
				verified: true,
				source,
				requestedLine: 7,
				line: 7
			}
		];

		newer.resolve(currentBreakpoints);
		await newerRequest;
		older.resolve([
			{
				id: 3,
				verified: true,
				source,
				requestedLine: 3,
				line: 3
			}
		]);

		await expect(olderRequest).resolves.toEqual(currentBreakpoints);
		expect(controller.breakpoints).toEqual(currentBreakpoints);
	});

	it('ignores superseded breakpoint failures while preserving current failures', async () => {
		const adapter = new FakeDebugAdapter();
		const older = deferred<ResolvedBreakpoint[]>();
		const newer = deferred<ResolvedBreakpoint[]>();
		adapter.setBreakpointsHandler = async (_source, lines) =>
			lines[0] === 3 ? older.promise : newer.promise;
		const controller = createAdapterDebugSessionController(adapter);
		const source = { path: '/workspace/main.cpp' };

		const olderRequest = controller.setBreakpoints(source, [3]);
		const newerRequest = controller.setBreakpoints(source, [7]);
		const currentBreakpoints = [
			{
				id: 7,
				verified: true,
				source,
				requestedLine: 7,
				line: 7
			}
		];
		newer.resolve(currentBreakpoints);
		await expect(newerRequest).resolves.toEqual(currentBreakpoints);
		older.reject(new Error('obsolete breakpoint failure'));

		await expect(olderRequest).resolves.toEqual(currentBreakpoints);
		expect(controller.breakpoints).toEqual(currentBreakpoints);
		expect(controller.error).toBeNull();

		const currentFailure = new Error('current breakpoint failure');
		adapter.setBreakpointsHandler = async () => {
			throw currentFailure;
		};
		await expect(controller.setBreakpoints(source, [11])).rejects.toBe(currentFailure);
		expect(controller.error).toBe(currentFailure);
	});

	it('loads newly selected threads and frames and delegates execution and inspection methods', async () => {
		const adapter = new FakeDebugAdapter();
		adapter.threadsHandler = async () => [
			{ id: 1, name: 'one' },
			{ id: 2, name: 'two' }
		];
		adapter.stackTraceHandler = async (threadId) =>
			threadId === 1
				? [
						{ id: 10, name: 'first', line: 1, column: 1 },
						{ id: 11, name: 'caller', line: 2, column: 1 }
					]
				: [{ id: 20, name: 'second', line: 3, column: 1 }];
		adapter.scopesHandler = async (frameId) => [
			{
				name: `Locals ${frameId}`,
				variablesReference: frameId + 100,
				expensive: false
			}
		];
		adapter.variablesHandler = async (variablesReference) => [
			{ name: 'frame', value: String(variablesReference), variablesReference: 0 }
		];
		adapter.evaluateHandler = async (expression, frameId) => ({
			result: `${expression}@${frameId}`,
			variablesReference: 0
		});
		adapter.readMemoryHandler = async () => ({
			address: '0x10',
			data: new Uint8Array([1, 2]),
			unreadableBytes: 0
		});
		adapter.writeMemoryHandler = async () => ({ offset: 4, bytesWritten: 2 });
		adapter.dataBreakpointInfoHandler = async () => ({
			dataId: '10/2',
			description: '2 bytes at 10',
			accessTypes: ['read', 'write', 'readWrite']
		});
		adapter.setDataBreakpointsHandler = async () => [{ id: 3, verified: true }];
		const controller = createAdapterDebugSessionController(adapter);

		adapter.emit({ type: 'stopped', reason: 'entry', threadId: 2 });
		await vi.waitFor(() => expect(controller.selectedFrameId).toBe(20));
		await controller.selectThread(1);
		expect(controller.selectedThreadId).toBe(1);
		expect(controller.frames.map((frame) => frame.id)).toEqual([10, 11]);
		expect(controller.selectedFrameId).toBe(10);

		await controller.selectFrame(11);
		expect(controller.selectedFrameId).toBe(11);
		expect(controller.scopes[0]?.name).toBe('Locals 11');
		await expect(controller.evaluate('counter')).resolves.toEqual({
			result: 'counter@11',
			variablesReference: 0
		});
		await expect(controller.readMemory('memory', 4, 2)).resolves.toEqual({
			address: '0x10',
			data: new Uint8Array([1, 2]),
			unreadableBytes: 0
		});
		await expect(
			controller.writeMemory('memory', 4, Uint8Array.of(9, 10), true)
		).resolves.toEqual({ offset: 4, bytesWritten: 2 });
		await expect(
			controller.dataBreakpointInfo({ name: '0x10', asAddress: true, bytes: 2 })
		).resolves.toEqual({
			dataId: '10/2',
			description: '2 bytes at 10',
			accessTypes: ['read', 'write', 'readWrite']
		});
		await expect(
			controller.setDataBreakpoints([{ dataId: '10/2', accessType: 'write' }])
		).resolves.toEqual([{ id: 3, verified: true }]);

		await controller.pause();
		await controller.next();
		await controller.stepIn();
		await controller.stepOut();
		await controller.continue();
		expect(adapter.transcript.slice(-10)).toEqual([
			'evaluate:counter:11',
			'readMemory:memory:4:2',
			'writeMemory:memory:4:9,10:true',
			'dataBreakpointInfo:0x10',
			'setDataBreakpoints:10/2:write',
			'pause:1',
			'next:1',
			'stepIn:1',
			'stepOut:1',
			'continue:1'
		]);
		expect(controller.stoppedReason).toBeNull();
		expect(controller.frames).toEqual([]);
	});

	it('ignores a previous stopped response that resolves after a newer stop', async () => {
		const adapter = new FakeDebugAdapter();
		const firstThreads = deferred<DebugThread[]>();
		const secondThreads = deferred<DebugThread[]>();
		let threadRequest = 0;
		adapter.threadsHandler = () =>
			++threadRequest === 1 ? firstThreads.promise : secondThreads.promise;
		adapter.stackTraceHandler = async (threadId) => [
			{ id: threadId * 10, name: `frame ${threadId}`, line: threadId, column: 1 }
		];
		adapter.scopesHandler = async () => [];
		const controller = createAdapterDebugSessionController(adapter);

		adapter.emit({ type: 'stopped', reason: 'breakpoint', threadId: 1 });
		adapter.emit({ type: 'stopped', reason: 'step', threadId: 2 });
		secondThreads.resolve([{ id: 2, name: 'new thread' }]);

		await vi.waitFor(() => expect(controller.selectedThreadId).toBe(2));
		expect(controller.stoppedReason).toBe('step');
		expect(controller.frames[0]?.id).toBe(20);

		firstThreads.resolve([{ id: 1, name: 'old thread' }]);
		await Promise.resolve();
		await Promise.resolve();

		expect(controller.stoppedReason).toBe('step');
		expect(controller.threads).toEqual([{ id: 2, name: 'new thread' }]);
		expect(controller.selectedThreadId).toBe(2);
		expect(controller.frames[0]?.id).toBe(20);
		expect(adapter.transcript).toEqual(['threads', 'threads', 'stackTrace:2', 'scopes:20']);
	});

	it('does not store child variables that resolve after continue invalidates the stop', async () => {
		const adapter = new FakeDebugAdapter();
		adapter.threadsHandler = async () => [{ id: 1, name: 'main' }];
		adapter.stackTraceHandler = async () => [{ id: 10, name: 'main', line: 1, column: 1 }];
		adapter.scopesHandler = async () => [];
		const childVariables = deferred<DebugVariable[]>();
		adapter.variablesHandler = (variablesReference) =>
			variablesReference === 50 ? childVariables.promise : Promise.resolve([]);
		const controller = createAdapterDebugSessionController(adapter);

		adapter.emit({ type: 'stopped', reason: 'breakpoint', threadId: 1 });
		await vi.waitFor(() => expect(controller.selectedFrameId).toBe(10));
		const loading = controller.loadVariableChildren(50);
		adapter.emit({ type: 'continued', threadId: 1 });
		childVariables.resolve([{ name: 'late', value: '1', variablesReference: 0 }]);

		await expect(loading).resolves.toEqual([]);
		expect(controller.variablesByReference.has(50)).toBe(false);
		expect(controller.stoppedReason).toBeNull();
		expect(controller.selectedThreadId).toBe(1);
	});

	it('does not surface a child-variable failure after continue invalidates the stop', async () => {
		const adapter = new FakeDebugAdapter();
		adapter.threadsHandler = async () => [{ id: 1, name: 'main' }];
		adapter.stackTraceHandler = async () => [{ id: 10, name: 'main', line: 1, column: 1 }];
		adapter.scopesHandler = async () => [];
		const childVariables = deferred<DebugVariable[]>();
		adapter.variablesHandler = (variablesReference) =>
			variablesReference === 50 ? childVariables.promise : Promise.resolve([]);
		const controller = createAdapterDebugSessionController(adapter);

		adapter.emit({ type: 'stopped', reason: 'breakpoint', threadId: 1 });
		await vi.waitFor(() => expect(controller.selectedFrameId).toBe(10));
		const loading = controller.loadVariableChildren(50);
		adapter.emit({ type: 'continued', threadId: 1 });
		childVariables.reject(new Error('obsolete variable failure'));

		await expect(loading).resolves.toEqual([]);
		expect(controller.variablesByReference.has(50)).toBe(false);
		expect(controller.error).toBeNull();
	});

	it('does not clear a newer stop when an older resume request resolves late', async () => {
		const adapter = new FakeDebugAdapter();
		adapter.threadsHandler = async () => [{ id: 1, name: 'main' }];
		adapter.stackTraceHandler = async () => [{ id: 10, name: 'main', line: 5, column: 1 }];
		adapter.scopesHandler = async () => [];
		const resumed = deferred<void>();
		adapter.continueHandler = () => resumed.promise;
		const controller = createAdapterDebugSessionController(adapter);

		adapter.emit({ type: 'stopped', reason: 'breakpoint', threadId: 1 });
		await vi.waitFor(() => expect(controller.selectedFrameId).toBe(10));
		const continuing = controller.continue();
		adapter.emit({ type: 'continued', threadId: 1 });
		adapter.emit({ type: 'stopped', reason: 'step', threadId: 1 });
		await vi.waitFor(() => expect(controller.selectedFrameId).toBe(10));
		expect(controller.stoppedReason).toBe('step');

		resumed.resolve();
		await continuing;

		expect(controller.stoppedReason).toBe('step');
		expect(controller.selectedFrameId).toBe(10);
	});

	it('ignores an execution failure after the target has already continued', async () => {
		const adapter = new FakeDebugAdapter();
		adapter.threadsHandler = async () => [{ id: 1, name: 'main' }];
		adapter.stackTraceHandler = async () => [{ id: 10, name: 'main', line: 5, column: 1 }];
		adapter.scopesHandler = async () => [];
		const continued = deferred<void>();
		adapter.continueHandler = () => continued.promise;
		const controller = createAdapterDebugSessionController(adapter);

		adapter.emit({ type: 'stopped', reason: 'breakpoint', threadId: 1 });
		await vi.waitFor(() => expect(controller.selectedFrameId).toBe(10));
		const continuing = controller.continue();
		adapter.emit({ type: 'continued', threadId: 1 });
		continued.reject(new Error('obsolete continue failure'));

		await expect(continuing).resolves.toBeUndefined();
		expect(controller.error).toBeNull();

		const currentFailure = new Error('current continue failure');
		adapter.continueHandler = async () => {
			throw currentFailure;
		};
		await expect(controller.continue()).rejects.toBe(currentFailure);
		expect(controller.error).toBe(currentFailure);
	});

	it('ignores a pause failure after the target has already stopped', async () => {
		const adapter = new FakeDebugAdapter();
		adapter.threadsHandler = async () => [{ id: 1, name: 'main' }];
		adapter.stackTraceHandler = async () => [{ id: 10, name: 'main', line: 5, column: 1 }];
		adapter.scopesHandler = async () => [];
		const paused = deferred<void>();
		adapter.pauseHandler = () => paused.promise;
		const controller = createAdapterDebugSessionController(adapter);

		adapter.emit({ type: 'stopped', reason: 'breakpoint', threadId: 1 });
		await vi.waitFor(() => expect(controller.selectedFrameId).toBe(10));
		adapter.emit({ type: 'continued', threadId: 1 });
		const pausing = controller.pause();
		adapter.emit({ type: 'stopped', reason: 'pause', threadId: 1 });
		paused.reject(new Error('obsolete pause failure'));

		await expect(pausing).resolves.toBeUndefined();
		expect(controller.error).toBeNull();

		const currentFailure = new Error('current pause failure');
		adapter.pauseHandler = async () => {
			throw currentFailure;
		};
		await expect(controller.pause()).rejects.toBe(currentFailure);
		expect(controller.error).toBe(currentFailure);
	});

	it('tracks output, exit, errors, and disconnect lifecycle state', async () => {
		const adapter = new FakeDebugAdapter();
		const controller = createAdapterDebugSessionController(adapter);
		await controller.launch({ program: '/workspace/program.wasm' });

		adapter.emit({ type: 'output', category: 'stdout', output: 'hello\n' });
		adapter.emit({ type: 'output', category: 'stderr', output: 'warning\n' });
		expect(controller.output).toEqual([
			{ type: 'output', category: 'stdout', output: 'hello\n' },
			{ type: 'output', category: 'stderr', output: 'warning\n' }
		]);
		controller.clearOutput();
		expect(controller.output).toEqual([]);

		const loadError = new Error('stack unavailable');
		adapter.threadsHandler = async () => {
			throw loadError;
		};
		adapter.emit({ type: 'stopped', reason: 'exception' });
		await vi.waitFor(() => expect(controller.error).toBe(loadError));

		adapter.emit({ type: 'exited', exitCode: 17 });
		expect(controller.active).toBe(false);
		expect(controller.exitCode).toBe(17);
		adapter.emit({ type: 'terminated' });
		expect(controller.exitCode).toBe(17);

		await controller.disconnect({ terminateTarget: true });
		expect(adapter.transcript.at(-1)).toBe('disconnect:true');
		expect(controller.active).toBe(false);
		controller.dispose();
		adapter.emit({ type: 'output', output: 'ignored' });
		expect(controller.output).toEqual([]);
	});
});
