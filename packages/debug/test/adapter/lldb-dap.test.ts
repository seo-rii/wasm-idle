import { describe, expect, expectTypeOf, it } from 'vitest';

import {
	DebugAdapterProtocolError,
	DebugAdapterStateError,
	UnsupportedDebugOperationError,
	createLldbDapAdapter,
	type DapEvent,
	type DapSession,
	type DebugAdapterEvent,
	type LldbDapAdapterOptions
} from '../../src/adapter/index.js';

class FakeDapSession implements DapSession {
	readonly requests: Array<{ command: string; requestArguments?: unknown }> = [];
	readonly #responses = new Map<string, unknown>();
	readonly #queuedResponses = new Map<string, unknown[]>();
	readonly #listeners = new Set<(event: DapEvent) => void>();

	setResponse(command: string, response: unknown) {
		this.#responses.set(command, response);
	}

	queueResponse(command: string, response: unknown) {
		const responses = this.#queuedResponses.get(command) ?? [];
		responses.push(response);
		this.#queuedResponses.set(command, responses);
	}

	async request<TBody = unknown>(command: string, requestArguments?: unknown): Promise<TBody> {
		this.requests.push({ command, requestArguments });
		const queued = this.#queuedResponses.get(command);
		return (await (queued?.length ? queued.shift() : this.#responses.get(command))) as TBody;
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
	it('does not expose opt-ins for operations absent from the adapter contract', () => {
		type FeatureSupport = NonNullable<LldbDapAdapterOptions['featureSupport']>;

		expectTypeOf<Exclude<keyof FeatureSupport, 'evaluate'>>().toEqualTypeOf<never>();
	});

	it('initializes once and conservatively maps optional DAP capabilities', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {
			supportsConfigurationDoneRequest: true,
			supportsConditionalBreakpoints: true,
			supportsLogPoints: true,
			supportsEvaluateForHovers: true,
			supportsReadMemoryRequest: true,
			supportsDataBreakpoints: true,
			supportsSetVariable: true,
			supportsRestartRequest: true,
			supportsTerminateRequest: true
		});
		const adapter = createLldbDapAdapter(session);

		expect(adapter.capabilities).toBeNull();
		const first = adapter.initialize();
		const second = adapter.initialize();

		await expect(first).resolves.toMatchObject({
			supportsConfigurationDone: true,
			supportsBreakpoints: true,
			supportsConditionalBreakpoints: false,
			supportsPause: true,
			supportsEvaluate: false,
			supportsEvaluateForHovers: false,
			supportsReadMemory: true,
			supportsLogPoints: false,
			supportsDataBreakpoints: false,
			supportsSetVariable: false,
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

	it('snapshots expression-evaluation opt-ins when initialization starts', async () => {
		const session = new FakeDapSession();
		let resolveInitialize!: (capabilities: unknown) => void;
		session.queueResponse(
			'initialize',
			new Promise((resolve) => {
				resolveInitialize = resolve;
			})
		);
		const options: LldbDapAdapterOptions = {
			featureSupport: { evaluate: false }
		};
		const adapter = createLldbDapAdapter(session, options);
		const initialization = adapter.initialize();
		options.featureSupport!.evaluate = true;
		resolveInitialize({ supportsEvaluateForHovers: true });

		await expect(initialization).resolves.toMatchObject({
			supportsEvaluate: false,
			supportsEvaluateForHovers: false
		});
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

	it('isolates tracked breakpoint metadata from mutations to returned snapshots', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {});
		session.setResponse('setBreakpoints', {
			breakpoints: [{ id: 61, verified: true, line: 6 }]
		});
		const adapter = createLldbDapAdapter(session);
		const events: DebugAdapterEvent[] = [];
		adapter.onEvent((event) => events.push(event));
		await adapter.initialize();

		const breakpoints = await adapter.setBreakpoints({ path: '/workspace/main.cpp' }, [5]);
		breakpoints[0]!.source.path = '/workspace/caller-mutated.cpp';
		breakpoints[0]!.requestedLine = 50;
		session.emit({
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: { id: 61, verified: true, line: 7 }
			}
		});

		expect(events.at(-1)).toEqual({
			type: 'breakpoint',
			reason: 'changed',
			breakpoint: {
				id: 61,
				verified: true,
				source: { path: '/workspace/main.cpp' },
				requestedLine: 5,
				line: 7
			}
		});
	});

	it('keeps the newest source metadata when breakpoint responses arrive out of order', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {});
		let resolveOlder!: (response: unknown) => void;
		let resolveNewer!: (response: unknown) => void;
		session.queueResponse(
			'setBreakpoints',
			new Promise((resolve) => {
				resolveOlder = resolve;
			})
		);
		session.queueResponse(
			'setBreakpoints',
			new Promise((resolve) => {
				resolveNewer = resolve;
			})
		);
		const adapter = createLldbDapAdapter(session);
		const events: DebugAdapterEvent[] = [];
		adapter.onEvent((event) => events.push(event));
		await adapter.initialize();

		const older = adapter.setBreakpoints({ path: '/workspace/main.cpp' }, [3]);
		const newer = adapter.setBreakpoints({ path: '/workspace/main.cpp' }, [7]);
		resolveNewer({ breakpoints: [{ id: 72, verified: true, line: 7 }] });
		const currentBreakpoints = [
			{
				id: 72,
				verified: true,
				source: { path: '/workspace/main.cpp' },
				requestedLine: 7,
				line: 7
			}
		];
		await expect(newer).resolves.toEqual(currentBreakpoints);
		resolveOlder({ breakpoints: [{ id: 31, verified: true, line: 3 }] });
		await expect(older).resolves.toEqual(currentBreakpoints);
		session.emit({
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					id: 31,
					verified: true,
					source: { path: '/workspace/main.cpp' },
					line: 4
				}
			}
		});
		expect(events).toEqual([]);
		session.emit({
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: { id: 72, verified: true, line: 8 }
			}
		});

		expect(events.at(-1)).toEqual({
			type: 'breakpoint',
			reason: 'changed',
			breakpoint: {
				id: 72,
				verified: true,
				source: { path: '/workspace/main.cpp' },
				requestedLine: 7,
				line: 8
			}
		});

		session.emit({
			event: 'breakpoint',
			body: {
				reason: 'new',
				breakpoint: {
					id: 99,
					verified: true,
					source: { path: '/workspace/helper.cpp' },
					line: 2
				}
			}
		});
		expect(events.at(-1)).toEqual({
			type: 'breakpoint',
			reason: 'new',
			breakpoint: {
				id: 99,
				verified: true,
				source: { path: '/workspace/helper.cpp' },
				requestedLine: 2,
				line: 2
			}
		});

		session.setResponse('setBreakpoints', {
			breakpoints: [{ id: 100, verified: true, line: 5 }]
		});
		await adapter.setBreakpoints({ path: '/workspace/helper.cpp' }, [5]);
		const eventCountAfterReplacement = events.length;
		session.emit({
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					id: 99,
					verified: true,
					source: { path: '/workspace/helper.cpp' },
					line: 3
				}
			}
		});
		expect(events).toHaveLength(eventCountAfterReplacement);
	});

	it('ignores a superseded breakpoint failure after the newest source update succeeds', async () => {
		const session = new FakeDapSession();
		session.setResponse('initialize', {});
		let rejectOlder!: (error: Error) => void;
		let resolveNewer!: (response: unknown) => void;
		session.queueResponse(
			'setBreakpoints',
			new Promise((_resolve, reject) => {
				rejectOlder = reject;
			})
		);
		session.queueResponse(
			'setBreakpoints',
			new Promise((resolve) => {
				resolveNewer = resolve;
			})
		);
		const adapter = createLldbDapAdapter(session);
		await adapter.initialize();

		const older = adapter.setBreakpoints({ path: '/workspace/main.cpp' }, [3]);
		const newer = adapter.setBreakpoints({ path: '/workspace/main.cpp' }, [9]);
		const currentBreakpoints = [
			{
				id: 79,
				verified: true,
				source: { path: '/workspace/main.cpp' },
				requestedLine: 9,
				line: 9
			}
		];
		resolveNewer({ breakpoints: [{ id: 79, verified: true, line: 9 }] });
		await expect(newer).resolves.toEqual(currentBreakpoints);
		const supersededResult = expect(older).resolves.toEqual(currentBreakpoints);
		rejectOlder(new Error('obsolete breakpoint failure'));
		await supersededResult;
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
				},
				{ id: 71, name: 'runtime frame', line: 0, column: 0 }
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
			},
			{ id: 71, name: 'runtime frame', line: 0, column: 0 }
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

	it.each([
		{
			command: 'threads',
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.threads(),
			path: 'threads'
		},
		{
			command: 'stackTrace',
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.stackTrace(1),
			path: 'stackFrames'
		},
		{
			command: 'scopes',
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.scopes(1),
			path: 'scopes'
		},
		{
			command: 'variables',
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.variables(1),
			path: 'variables'
		}
	])(
		'rejects a $command response without its required collection',
		async ({ command, invoke, path }) => {
			const session = new FakeDapSession();
			session.setResponse('initialize', {});
			session.setResponse(command, {});
			const adapter = createLldbDapAdapter(session);
			await adapter.initialize();

			const response = invoke(adapter);
			await expect(response).rejects.toBeInstanceOf(DebugAdapterProtocolError);
			await expect(response).rejects.toMatchObject({
				name: 'DebugAdapterProtocolError',
				command,
				path
			});
		}
	);

	it.each([
		{
			command: 'threads',
			response: { threads: [{ id: 0, name: 'Wasm main thread' }] },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.threads(),
			path: 'threads[0].id'
		},
		{
			command: 'threads',
			response: { threads: [{ id: 1, name: 7 }] },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.threads(),
			path: 'threads[0].name'
		},
		{
			command: 'stackTrace',
			response: {
				stackFrames: [{ id: 7, name: 'main', line: -1, column: 1 }]
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.stackTrace(1),
			path: 'stackFrames[0].line'
		},
		{
			command: 'stackTrace',
			response: {
				stackFrames: [{ id: 7, name: 'main', source: 'main.cpp', line: 1, column: 1 }]
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.stackTrace(1),
			path: 'stackFrames[0].source'
		},
		{
			command: 'stackTrace',
			response: {
				stackFrames: [
					{ id: 7, name: 'main', line: 1, column: 1, presentationHint: 'invalid' }
				]
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.stackTrace(1),
			path: 'stackFrames[0].presentationHint'
		},
		{
			command: 'scopes',
			response: {
				scopes: [{ name: 'Locals', variablesReference: -1, expensive: false }]
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.scopes(1),
			path: 'scopes[0].variablesReference'
		},
		{
			command: 'scopes',
			response: {
				scopes: [{ name: 'Locals', variablesReference: 1, expensive: 'false' }]
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.scopes(1),
			path: 'scopes[0].expensive'
		},
		{
			command: 'variables',
			response: {
				variables: [{ name: 7, value: '42', variablesReference: 0 }]
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.variables(1),
			path: 'variables[0].name'
		},
		{
			command: 'variables',
			response: {
				variables: [
					{
						name: 'answer',
						value: '42',
						variablesReference: 0,
						presentationHint: { attributes: [7] }
					}
				]
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) => adapter.variables(1),
			path: 'variables[0].presentationHint.attributes[0]'
		}
	])(
		'rejects malformed $command collection entries',
		async ({ command, response, invoke, path }) => {
			const session = new FakeDapSession();
			session.setResponse('initialize', {});
			session.setResponse(command, response);
			const adapter = createLldbDapAdapter(session);
			await adapter.initialize();

			const result = invoke(adapter);
			await expect(result).rejects.toBeInstanceOf(DebugAdapterProtocolError);
			await expect(result).rejects.toMatchObject({
				name: 'DebugAdapterProtocolError',
				command,
				path
			});
		}
	);

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

	it.each([
		{
			command: 'readMemory',
			response: { data: '' },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.readMemory('memory', 0, 1),
			path: 'address'
		},
		{
			command: 'readMemory',
			response: { address: '0x1000', data: '***' },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.readMemory('memory', 0, 1),
			path: 'data'
		},
		{
			command: 'readMemory',
			response: { address: '0x1000', unreadableBytes: -1 },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.readMemory('memory', 0, 1),
			path: 'unreadableBytes'
		},
		{
			command: 'readMemory',
			response: { address: '0x1000', data: 'AQI=' },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.readMemory('memory', 0, 1),
			path: 'data'
		},
		{
			command: 'evaluate',
			response: { result: 42, variablesReference: 0 },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.evaluate('answer'),
			path: 'result'
		},
		{
			command: 'evaluate',
			response: { result: '42' },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.evaluate('answer'),
			path: 'variablesReference'
		},
		{
			command: 'evaluate',
			response: { result: '42', variablesReference: 0, namedVariables: -1 },
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.evaluate('answer'),
			path: 'namedVariables'
		},
		{
			command: 'evaluate',
			response: {
				result: '42',
				variablesReference: 0,
				presentationHint: { attributes: [7] }
			},
			invoke: (adapter: ReturnType<typeof createLldbDapAdapter>) =>
				adapter.evaluate('answer'),
			path: 'presentationHint.attributes[0]'
		}
	])(
		'rejects malformed $command value responses',
		async ({ command, response, invoke, path }) => {
			const session = new FakeDapSession();
			session.setResponse('initialize', { supportsReadMemoryRequest: true });
			session.setResponse(command, response);
			const adapter = createLldbDapAdapter(session, { featureSupport: { evaluate: true } });
			await adapter.initialize();

			const result = invoke(adapter);
			await expect(result).rejects.toBeInstanceOf(DebugAdapterProtocolError);
			await expect(result).rejects.toMatchObject({
				command,
				path
			});
		}
	);

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
