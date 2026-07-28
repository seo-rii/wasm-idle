import { describe, expect, it } from 'vitest';

import {
	DebugAdapterStateError,
	UnsupportedDebugOperationError,
	createLldbDapAdapter,
	type DapEvent,
	type DapSession,
	type DebugAdapterEvent
} from '../../src/adapter/index.js';

class FakeDapSession implements DapSession {
	readonly requests: Array<{ command: string; requestArguments?: unknown }> = [];
	readonly #responses = new Map<string, unknown>();
	readonly #listeners = new Set<(event: DapEvent) => void>();

	setResponse(command: string, response: unknown) {
		this.#responses.set(command, response);
	}

	async request<TBody = unknown>(command: string, requestArguments?: unknown): Promise<TBody> {
		this.requests.push({ command, requestArguments });
		return this.#responses.get(command) as TBody;
	}

	onEvent(listener: (event: DapEvent) => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	emit(event: DapEvent) {
		for (const listener of this.#listeners) listener(event);
	}
}

describe('LldbDapAdapter', () => {
	it('initializes once and conservatively maps optional DAP capabilities', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {
			supportsConfigurationDoneRequest: true,
			supportsConditionalBreakpoints: true,
			supportsEvaluateForHovers: true,
			supportsReadMemoryRequest: true,
			supportsSetVariable: false
		});
		const adapter = createLldbDapAdapter(session);

		expect(adapter.capabilities).toBeNull();
		const first = adapter.initialize();
		const second = adapter.initialize();

		await expect(first).resolves.toMatchObject({
			supportsConfigurationDone: true,
			supportsBreakpoints: true,
			supportsConditionalBreakpoints: true,
			supportsPause: true,
			supportsEvaluate: false,
			supportsEvaluateForHovers: false,
			supportsReadMemory: true,
			supportsLogPoints: false,
			supportsDataBreakpoints: false,
			supportsRestart: false,
			supportsTerminate: false
		});
		await expect(second).resolves.toBe(adapter.capabilities);
		expect(session.requests).toEqual([
			{
				command: 'initialize',
				requestArguments: expect.objectContaining({
					clientID: 'wasm-idle',
					adapterID: 'lldb-web-dap',
					linesStartAt1: true,
					columnsStartAt1: true,
					pathFormat: 'path',
					supportsVariablePaging: true,
					supportsMemoryReferences: true,
					supportsRunInTerminalRequest: false
				})
			}
		]);
	});

	it('requires initialization and maps launch, execution control, and disconnect requests', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {});
		const adapter = createLldbDapAdapter(session);

		await expect(adapter.launch({ program: '/workspace/program.wasm' })).rejects.toBeInstanceOf(
			DebugAdapterStateError
		);

		await adapter.initialize();
		await adapter.launch({
			program: '/workspace/program.wasm',
			stopOnEntry: true,
			customTarget: 'wamr'
		});
		await adapter.continue(4);
		await adapter.pause(4);
		await adapter.next(4);
		await adapter.stepIn(4);
		await adapter.stepOut(4);
		await adapter.disconnect({ terminateTarget: true });

		expect(session.requests.slice(1)).toEqual([
			{
				command: 'launch',
				requestArguments: {
					program: '/workspace/program.wasm',
					stopOnEntry: true,
					customTarget: 'wamr'
				}
			},
			{ command: 'continue', requestArguments: { threadId: 4 } },
			{ command: 'pause', requestArguments: { threadId: 4 } },
			{ command: 'next', requestArguments: { threadId: 4 } },
			{ command: 'stepIn', requestArguments: { threadId: 4 } },
			{ command: 'stepOut', requestArguments: { threadId: 4 } },
			{
				command: 'disconnect',
				requestArguments: { terminateDebuggee: true }
			}
		]);
	});

	it('returns source-aware verified and unverified breakpoints', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {});
		session.setResponse('setBreakpoints', {
			breakpoints: [
				{ id: 31, verified: true, line: 6, column: 2 },
				{ id: 32, verified: false, message: 'No executable code' }
			]
		});
		const adapter = createLldbDapAdapter(session);
		await adapter.initialize();

		await expect(
			adapter.setBreakpoints({ name: 'main.cpp', path: '/workspace/main.cpp' }, [5, 12])
		).resolves.toEqual([
			{
				id: 31,
				verified: true,
				source: { name: 'main.cpp', path: '/workspace/main.cpp' },
				requestedLine: 5,
				line: 6,
				column: 2
			},
			{
				id: 32,
				verified: false,
				source: { name: 'main.cpp', path: '/workspace/main.cpp' },
				requestedLine: 12,
				line: 12,
				message: 'No executable code'
			}
		]);
		expect(session.requests.at(-1)).toEqual({
			command: 'setBreakpoints',
			requestArguments: {
				source: { name: 'main.cpp', path: '/workspace/main.cpp' },
				breakpoints: [{ line: 5 }, { line: 12 }],
				lines: [5, 12]
			}
		});
	});

	it('keeps variable children lazy and forwards paging to DAP', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {});
		session.setResponse('threads', {
			threads: [{ id: 7, name: 'Wasm main thread' }]
		});
		session.setResponse('stackTrace', {
			stackFrames: [
				{
					id: 70,
					name: 'main',
					source: { path: '/workspace/main.cpp' },
					line: 9,
					column: 3
				}
			]
		});
		session.setResponse('scopes', {
			scopes: [
				{
					name: 'Locals',
					presentationHint: 'locals',
					variablesReference: 80,
					namedVariables: 1,
					expensive: false
				}
			]
		});
		session.setResponse('variables', {
			variables: [
				{
					name: 'point',
					value: '{x = 1, y = 2}',
					type: 'Point',
					variablesReference: 99,
					namedVariables: 2,
					memoryReference: '0x1000'
				}
			]
		});
		const adapter = createLldbDapAdapter(session);
		await adapter.initialize();

		await expect(adapter.threads()).resolves.toEqual([{ id: 7, name: 'Wasm main thread' }]);
		await expect(adapter.stackTrace(7, 0, 20)).resolves.toEqual([
			{
				id: 70,
				name: 'main',
				source: { path: '/workspace/main.cpp' },
				line: 9,
				column: 3
			}
		]);
		await expect(adapter.scopes(70)).resolves.toEqual([
			{
				name: 'Locals',
				presentationHint: 'locals',
				variablesReference: 80,
				namedVariables: 1,
				expensive: false
			}
		]);
		await expect(adapter.variables(80, 10, 25)).resolves.toEqual([
			{
				name: 'point',
				value: '{x = 1, y = 2}',
				type: 'Point',
				variablesReference: 99,
				namedVariables: 2,
				memoryReference: '0x1000'
			}
		]);

		expect(session.requests.filter(({ command }) => command === 'variables')).toEqual([
			{
				command: 'variables',
				requestArguments: {
					variablesReference: 80,
					start: 10,
					count: 25
				}
			}
		]);
		expect(session.requests).not.toContainEqual({
			command: 'variables',
			requestArguments: expect.objectContaining({ variablesReference: 99 })
		});
	});

	it('gates memory and evaluation requests on explicit capabilities', async () => {
		const unsupportedSession = new FakeDapSession();
		unsupportedSession.setResponse('initialize', {
			supportsEvaluateForHovers: false,
			supportsReadMemoryRequest: false
		});
		const unsupported = createLldbDapAdapter(unsupportedSession);
		await unsupported.initialize();

		await expect(unsupported.readMemory('memory', 0, 4)).rejects.toBeInstanceOf(
			UnsupportedDebugOperationError
		);
		await expect(unsupported.evaluate('counter')).rejects.toBeInstanceOf(
			UnsupportedDebugOperationError
		);
		expect(unsupportedSession.requests).toHaveLength(1);

		const session = new FakeDapSession();
		session.setResponse('initialize', {
			supportsReadMemoryRequest: true,
			supportsEvaluateForHovers: false
		});
		session.setResponse('readMemory', {
			address: '0x1004',
			data: 'AQIDBA==',
			unreadableBytes: 2
		});
		session.setResponse('evaluate', {
			result: '42',
			type: 'int',
			variablesReference: 17,
			namedVariables: 1
		});
		const adapter = createLldbDapAdapter(session, {
			featureSupport: { evaluate: true }
		});
		await adapter.initialize();

		const memory = await adapter.readMemory('memory', 4, 6);
		expect(memory).toEqual({
			address: '0x1004',
			data: new Uint8Array([1, 2, 3, 4]),
			unreadableBytes: 2
		});
		await expect(adapter.evaluate('counter', 70)).resolves.toEqual({
			result: '42',
			type: 'int',
			variablesReference: 17,
			namedVariables: 1
		});
		expect(session.requests.slice(-2)).toEqual([
			{
				command: 'readMemory',
				requestArguments: { memoryReference: 'memory', offset: 4, count: 6 }
			},
			{
				command: 'evaluate',
				requestArguments: { expression: 'counter', context: 'watch', frameId: 70 }
			}
		]);
	});

	it('normalizes DAP events and preserves tracked breakpoint source information', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {});
		session.setResponse('setBreakpoints', {
			breakpoints: [{ id: 8, verified: true, line: 4 }]
		});
		const adapter = createLldbDapAdapter(session);
		const events: DebugAdapterEvent[] = [];
		const unsubscribe = adapter.onEvent((event) => events.push(event));
		await adapter.initialize();
		await adapter.setBreakpoints({ path: '/workspace/main.cpp' }, [3]);

		session.emit({ event: 'initialized' });
		session.emit({
			event: 'stopped',
			body: {
				reason: 'breakpoint',
				threadId: 2,
				allThreadsStopped: true,
				hitBreakpointIds: [8]
			}
		});
		session.emit({
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: { id: 8, verified: true, line: 5 }
			}
		});
		session.emit({
			event: 'output',
			body: {
				category: 'stdout',
				output: 'hello\n',
				source: { path: '/workspace/main.cpp' },
				line: 5
			}
		});
		session.emit({ event: 'continued', body: { threadId: 2 } });
		session.emit({ event: 'customRuntimeEvent', body: { generation: 9 } });

		expect(events).toEqual([
			{ type: 'initialized' },
			{
				type: 'stopped',
				reason: 'breakpoint',
				threadId: 2,
				allThreadsStopped: true,
				hitBreakpointIds: [8]
			},
			{
				type: 'breakpoint',
				reason: 'changed',
				breakpoint: {
					id: 8,
					verified: true,
					source: { path: '/workspace/main.cpp' },
					requestedLine: 3,
					line: 5
				}
			},
			{
				type: 'output',
				category: 'stdout',
				output: 'hello\n',
				source: { path: '/workspace/main.cpp' },
				line: 5
			},
			{ type: 'continued', threadId: 2 },
			{
				type: 'dap',
				event: 'customRuntimeEvent',
				body: { generation: 9 }
			}
		]);

		unsubscribe();
		session.emit({ event: 'terminated' });
		expect(events).toHaveLength(6);
	});
});
