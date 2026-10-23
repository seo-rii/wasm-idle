import { describe, expect, it, vi } from 'vitest';
import type {
	DebugFrame,
	DebugScope,
	DebugSessionCapabilities,
	DebugVariable
} from '@wasm-idle/core';
import {
	createDebugSessionController,
	type DebugSessionController,
	type DebugTerminalControl
} from '../src/controller.js';
import { createDebugVariableState } from '../src/variable-state.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

const capabilities: DebugSessionCapabilities = {
	readMemory: false,
	writeMemory: false,
	dataBreakpoints: false
};

function pause(
	controller: DebugSessionController,
	options: {
		id?: number;
		value?: string;
		reference?: number;
		frames?: DebugFrame[];
		variables?: DebugVariable[];
		scopes?: DebugScope[];
		capabilities?: DebugSessionCapabilities;
		sessionId?: string;
		stopId?: number;
		callStackComplete?: boolean;
	} = {}
) {
	const id = options.id ?? 1;
	const variables = options.variables ?? [
		{
			name: 'items',
			value: options.value ?? 'size=100',
			variablesReference: options.reference ?? 50,
			indexedVariables: 100
		}
	];
	controller.handleEvent({
		type: 'pause',
		reason: 'step',
		line: 7,
		sourcePath: '/workspace/main.cpp',
		frameId: id,
		sessionId: options.sessionId,
		stopId: options.stopId,
		callStackComplete: options.callStackComplete,
		locals: variables,
		callStack: options.frames ?? [
			{ id, functionName: 'solve', sourcePath: '/workspace/main.cpp', line: 7 }
		],
		scopes: options.scopes ?? [
			{ name: 'Locals', variablesReference: 10, expensive: false, variables }
		],
		capabilities: options.capabilities ?? capabilities
	});
}

function controllerWith(
	terminal: Partial<DebugTerminalControl> = {},
	options: Parameters<typeof createDebugSessionController>[0] = {}
) {
	return createDebugSessionController({
		sourcePath: '/workspace/main.cpp',
		terminal: { debugCommand: async () => {}, ...terminal } as DebugTerminalControl,
		...options
	});
}

describe('shared debugger variable state', () => {
	it('resolves numeric Watch and hover paths after named children without polluting displayed pages', async () => {
		const children = [
			{ name: 'length', value: '2' },
			{ name: 'capacity', value: '8' },
			{ name: '[0]', value: '42' },
			{ name: '[1]', value: '43' }
		];
		const debugVariables = vi.fn(async (_reference: number, start = 0, count = 50) =>
			children.slice(start, start + count)
		);
		const controller = controllerWith({ debugEvaluateValue: vi.fn(), debugVariables });
		pause(controller, {
			variables: [
				{
					name: 'items',
					value: 'size=2',
					namedVariables: 2,
					indexedVariables: 2,
					variablesReference: 50
				}
			]
		});
		controller.addWatchExpression('items[0]');
		await vi.waitFor(() =>
			expect(controller.watchValues[0]).toMatchObject({ expression: 'items[0]', value: '42' })
		);
		expect(debugVariables).toHaveBeenCalledWith(50, 2, 1);
		await expect(controller.resolveHover('items[1]')).resolves.toMatchObject({ value: '43' });
		expect(debugVariables).toHaveBeenCalledWith(50, 3, 1);
		expect(controller.variablesByReference.has(50)).toBe(false);
		debugVariables.mockClear();
		await expect(controller.resolveHover('items[2]')).resolves.toBeNull();
		expect(debugVariables).not.toHaveBeenCalled();
	});

	it('returns unknown for ambiguous names or a protocol child that is not the requested array index', async () => {
		const controller = controllerWith({
			debugEvaluateValue: vi.fn(),
			debugVariables: async () => [{ name: 'length', value: '999' }]
		});
		pause(controller, {
			variables: [
				{ name: 'n', value: 'inner' },
				{ name: 'n', value: 'outer' },
				{ name: 'items', value: 'size=2', variablesReference: 50 }
			]
		});
		controller.addWatchExpression('n');
		controller.addWatchExpression('items[0]');
		await vi.waitFor(() =>
			expect(
				controller.watchValues.map(({ expression, value }) => ({ expression, value }))
			).toEqual([
				{ expression: 'n', value: '?' },
				{ expression: 'items[0]', value: '?' }
			])
		);
		await expect(controller.resolveHover('n')).resolves.toBeNull();
		await expect(controller.resolveHover('items[0]')).resolves.toBeNull();
	});

	it('keeps local and argument Watch and hover values when a shadowed global scope is expanded', async () => {
		const local = { name: 'value', value: '1' };
		const argument = { name: 'argument', value: '2' };
		const debugVariables = vi.fn(async (reference: number) =>
			reference === 10
				? [local]
				: reference === 11
					? [argument]
					: [
							{ name: 'value', value: '99' },
							{ name: 'argument', value: '100' }
						]
		);
		const controller = controllerWith({ debugEvaluate: async () => '?', debugVariables });
		pause(controller, {
			variables: [],
			scopes: [
				{ name: 'Locals', variablesReference: 10, expensive: false, variables: [] },
				{ name: 'Arguments', variablesReference: 11, expensive: false, variables: [] },
				{ name: 'Globals', variablesReference: 20, expensive: true, variables: [] }
			]
		});
		controller.addWatchExpression('value');
		controller.addWatchExpression('argument');
		const expected = [
			{ expression: 'value', value: '1' },
			{ expression: 'argument', value: '2' }
		];
		await vi.waitFor(() => expect(controller.watchValues).toEqual(expected));
		expect(debugVariables).not.toHaveBeenCalledWith(20);
		await controller.loadVariableChildren(20);
		await vi.waitFor(() => expect(controller.watchValues).toEqual(expected));
		await expect(controller.resolveHover('value')).resolves.toMatchObject({ value: '1' });
		await expect(controller.resolveHover('argument')).resolves.toMatchObject({ value: '2' });
	});

	it('uses the first local scope before arguments and outer scopes for safe variable paths', async () => {
		const debugVariables = vi.fn(async (reference: number) => [
			{ name: 'answer', value: reference === 50 ? '42' : '99' }
		]);
		const controller = controllerWith({ debugEvaluate: async () => '?', debugVariables });
		const scopes: DebugScope[] = [
			{
				name: 'Globals',
				variablesReference: 20,
				expensive: true,
				variables: [{ name: 'item', value: 'global', variablesReference: 60 }]
			},
			{
				name: 'Arguments',
				variablesReference: 11,
				expensive: false,
				variables: [{ name: 'item', value: 'argument', variablesReference: 60 }]
			},
			{
				name: 'Block',
				presentationHint: 'locals',
				variablesReference: 10,
				expensive: false,
				variables: [{ name: 'item', value: 'inner', variablesReference: 50 }]
			},
			{
				name: 'Function',
				presentationHint: 'locals',
				variablesReference: 12,
				expensive: false,
				variables: [{ name: 'item', value: 'outer', variablesReference: 60 }]
			}
		];
		pause(controller, { variables: scopes.flatMap((scope) => scope.variables), scopes });
		controller.addWatchExpression('item.answer');
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'item.answer', value: '42' }])
		);
		await expect(controller.resolveHover('item.answer')).resolves.toMatchObject({
			value: '42'
		});
		expect(debugVariables).toHaveBeenCalledWith(50);
		expect(debugVariables).not.toHaveBeenCalledWith(60);
	});

	it('does not resolve an ambiguous local name from an unambiguous outer scope', async () => {
		const controller = controllerWith({ debugEvaluate: async () => '?' });
		const scopes: DebugScope[] = [
			{
				name: 'Locals',
				variablesReference: 10,
				expensive: false,
				variables: [
					{ name: 'value', value: '1' },
					{ name: 'value', value: '2' }
				]
			},
			{
				name: 'Globals',
				variablesReference: 20,
				expensive: true,
				variables: [{ name: 'value', value: '99' }]
			}
		];
		pause(controller, { variables: scopes.flatMap((scope) => scope.variables), scopes });
		controller.addWatchExpression('value');
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'value', value: '?' }])
		);
		await expect(controller.resolveHover('value')).resolves.toBeNull();
	});

	it.each(['Globals', 'Outer block'])(
		'suppresses shadowed %s Watch shortcuts while retaining inspection and scoped watchpoints',
		async (scopeName) => {
			const debugVariables = vi.fn(async (reference: number) => [
				{
					name: 'answer',
					value: reference === 50 ? '42' : '99',
					evaluateName: 'item.answer'
				}
			]);
			const debugDataBreakpointInfo = vi.fn(async () => ({
				dataId: 'outer-answer',
				description: 'outer answer'
			}));
			const debugSetDataBreakpoints = vi.fn(async () => [{ verified: true }]);
			const controller = controllerWith({
				debugEvaluate: async () => '?',
				debugVariables,
				debugDataBreakpointInfo,
				debugSetDataBreakpoints
			});
			const scopes: DebugScope[] = [
				{
					name: 'Locals',
					variablesReference: 10,
					expensive: false,
					variables: [{ name: 'item', value: 'inner', variablesReference: 50 }]
				},
				{
					name: scopeName,
					...(scopeName === 'Outer block' ? { presentationHint: 'locals' } : {}),
					variablesReference: 20,
					expensive: scopeName === 'Globals',
					variables: [
						{
							name: 'item',
							value: 'outer',
							variablesReference: 60,
							evaluateName: 'item'
						}
					]
				}
			];
			pause(controller, {
				variables: scopes.flatMap((scope) => scope.variables),
				scopes,
				capabilities: { ...capabilities, dataBreakpoints: true }
			});
			const outerPath = controller.scopeNodes(scopes[1])[0].path;
			expect(controller.scopeNodes(scopes[1])[0].expression).toBeUndefined();
			expect(controller.addWatchFromVariable(outerPath)).toBe(false);
			await controller.expandVariable(outerPath);
			const outer = controller.scopeNodes(scopes[1])[0];
			expect(outer.children[0].variable.value).toBe('99');
			expect(outer.children[0].expression).toBeUndefined();
			expect(controller.addWatchFromVariable(outer.children[0].path)).toBe(false);
			await expect(controller.watchVariable(outer.children[0].path)).resolves.toEqual([
				{ verified: true }
			]);
			expect(debugDataBreakpointInfo).toHaveBeenCalledWith({
				name: 'answer',
				variablesReference: 60,
				frameId: 1
			});
			await controller.expandVariable(controller.scopeNodes(scopes[0])[0].path);
			const inner = controller.scopeNodes(scopes[0])[0];
			expect(inner.children[0].expression).toBe('item.answer');
			expect(controller.addWatchFromVariable(inner.children[0].path)).toBe(true);
			await vi.waitFor(() =>
				expect(controller.watchValues[0]).toMatchObject({
					expression: 'item.answer',
					value: '42'
				})
			);
		}
	);

	it('waits for unresolved higher scopes before offering an outer Watch shortcut and recovers after hydration', () => {
		const state = createDebugVariableState();
		const outer = {
			name: 'item',
			value: 'outer',
			variablesReference: 60,
			evaluateName: 'item'
		};
		const inner = { name: 'item', value: 'inner' };
		const scopes: DebugScope[] = [
			{ name: 'Globals', variablesReference: 20, expensive: true, variables: [outer] },
			{ name: 'Locals', variablesReference: 10, expensive: false, variables: [] }
		];
		const variablesByReference = new Map<number, DebugVariable[]>([
			[20, [outer]],
			[60, [{ name: 'answer', value: '99', evaluateName: 'item.answer' }]]
		]);
		const options = {
			frameKey: 'frame',
			scopes,
			locals: [],
			variablesByReference,
			loadingReferences: new Set<number>()
		};
		let node = state.build(options).scopes.get(20)![0];
		expect(node.expression).toBeUndefined();
		expect(node.children[0].expression).toBeUndefined();
		expect(node.children[0].variable.value).toBe('99');
		expect(state.entry(node.path)?.parentReference).toBe(20);
		expect(state.entry(node.children[0].path)?.parentReference).toBe(60);

		variablesByReference.set(10, []);
		node = state.build(options).scopes.get(20)![0];
		expect(node.expression).toBe('item');
		expect(node.children[0].expression).toBe('item.answer');

		variablesByReference.set(10, [inner]);
		node = state.build(options).scopes.get(20)![0];
		expect(node.expression).toBeUndefined();
		expect(node.children[0].expression).toBeUndefined();

		variablesByReference.delete(10);
		scopes[1].variables = [inner];
		node = state.build(options).scopes.get(20)![0];
		expect(node.expression).toBeUndefined();

		variablesByReference.set(10, []);
		const hydrated = state.build(options);
		expect(hydrated.scopes.get(10)).toEqual([]);
		expect(hydrated.scopes.get(20)![0].expression).toBe('item');
	});
	it('bounds expansion preferences across sessions while allowing new paths after eviction', () => {
		const state = createDebugVariableState();
		const options = {
			frameKey: 'frame',
			scopes: [],
			locals: Array.from({ length: 513 }, (_, index) => ({
				name: `n${index}`,
				value: '{...}'
			})),
			variablesByReference: new Map(),
			loadingReferences: new Set<number>()
		};
		const nodes = state.build(options).locals;
		for (const node of nodes) expect(state.setExpanded(node.path, true)).toBe(true);
		const current = state.build(options).locals;
		expect(current.filter((node) => node.expanded)).toHaveLength(512);
		expect(current[0].expanded).toBe(false);
		state.reset();
		expect(state.build(options).locals.at(-1)?.expanded).toBe(true);
	});

	it('preserves history context and reports bounded text truncation for large values', () => {
		const controller = controllerWith({}, { snapshotVariableLimit: 500 });
		pause(controller, {
			variables: Array.from({ length: 500 }, (_, index) => ({
				name: `n${index}`,
				value: 'x'.repeat(10_000)
			}))
		});
		const snapshot = controller.history[0];
		expect(snapshot.callStack[0].functionName).toBe('solve');
		expect(snapshot.sourcePath).toBe('/workspace/main.cpp');
		expect(snapshot.truncated).toBe(true);
		expect(
			snapshot.variables.reduce((total, node) => total + node.value.length, 0)
		).toBeLessThan(65_536);
	});
	it('keeps legacy trace arithmetic watches when the Terminal also exposes structured evaluation', async () => {
		const debugEvaluate = vi.fn(async () => '42');
		const debugEvaluateValue = vi.fn();
		const controller = controllerWith({ debugEvaluate, debugEvaluateValue });
		pause(controller, { variables: [{ name: 'n', value: '41' }] });
		controller.addWatchExpression('n + 1');
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'n + 1', value: '42' }])
		);
		expect(debugEvaluate).toHaveBeenCalledWith('n + 1');
		expect(debugEvaluateValue).not.toHaveBeenCalled();
		await expect(controller.resolveHover('n + 1')).resolves.toBeNull();
		expect(debugEvaluate).toHaveBeenCalledTimes(1);
	});

	it('pages large named objects and bounds live/snapshot trees including cyclic references', async () => {
		const debugVariables = vi.fn(async (_reference: number, start = 0, count = 50) =>
			Array.from({ length: count }, (_, index) => ({
				name: `field${start + index}`,
				value: '1'
			}))
		);
		const controller = controllerWith({ debugVariables }, { snapshotVariableLimit: 10 });
		pause(controller, {
			variables: [
				{ name: 'object', value: '{...}', variablesReference: 50, namedVariables: 1_000 }
			]
		});
		await controller.expandVariable(controller.variableNodes[0].path);
		expect(controller.variableNodes[0].children).toHaveLength(50);
		expect(debugVariables).toHaveBeenCalledWith(50, 0, 50);
		expect(controller.history[0].truncated).toBe(true);
		pause(controller, {
			variables: Array.from({ length: 5_100 }, (_, index) => ({
				name: `n${index}`,
				value: '1'
			}))
		});
		expect(controller.variableNodes).toHaveLength(5_000);
		const cyclic = controllerWith({
			debugVariables: async () => [{ name: 'self', value: '{...}', variablesReference: 50 }]
		});
		pause(cyclic, { variables: [{ name: 'object', value: '{...}', variablesReference: 50 }] });
		await cyclic.expandVariable(cyclic.variableNodes[0].path);
		expect(cyclic.variableNodes[0].children[0].children).toEqual([]);
	});

	it('does not reuse a terminal replacement or different thread as a comparison baseline', async () => {
		const controller = controllerWith();
		pause(controller, { variables: [{ name: 'n', value: '1' }] });
		controller.setTerminal({ debugCommand: async () => {} } as DebugTerminalControl);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, { variables: [{ name: 'n', value: '2' }] });
		expect(controller.variableNodes[0].changed).toBe(false);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		controller.handleEvent({
			type: 'pause',
			reason: 'step',
			line: 7,
			sourcePath: '/workspace/main.cpp',
			threadId: 2,
			frameId: 1,
			locals: [{ name: 'n', value: '3' }],
			callStack: [
				{ id: 1, functionName: 'solve', sourcePath: '/workspace/main.cpp', line: 7 }
			],
			scopes: [
				{
					name: 'Locals',
					variablesReference: 10,
					expensive: false,
					variables: [{ name: 'n', value: '3' }]
				}
			]
		});
		expect(controller.variableNodes[0].changed).toBe(false);
	});

	it('refuses ambiguous duplicate variable-name watch and watchpoint shortcuts', async () => {
		const debugDataBreakpointInfo = vi.fn();
		const controller = controllerWith({ debugDataBreakpointInfo });
		pause(controller, {
			variables: [
				{ name: 'n', value: 'inner' },
				{ name: 'n', value: 'outer' }
			],
			capabilities: { ...capabilities, dataBreakpoints: true }
		});
		expect(controller.addWatchFromVariable(controller.variableNodes[1].path)).toBe(false);
		await expect(controller.watchVariable(controller.variableNodes[1].path)).resolves.toEqual(
			[]
		);
		expect(debugDataBreakpointInfo).not.toHaveBeenCalled();
	});
	it('restores nested expansion by source paths with new DAP handles and keeps collapsed branches lazy', async () => {
		const debugVariables = vi.fn(async (reference: number, start?: number, count?: number) =>
			reference === 50 || reference === 60
				? [{ name: '[0]', value: '{...}', variablesReference: reference + 1 }]
				: [{ name: 'answer', value: '42' }]
		);
		const controller = controllerWith({ debugVariables });
		pause(controller);
		const path = controller.variableNodes[0].path;
		await controller.expandVariable(path);
		const childPath = controller.variableNodes[0].children[0].path;
		await controller.expandVariable(childPath);
		expect(controller.variableNodes[0].children[0].children[0].variable.value).toBe('42');
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, { id: 90, reference: 60 });
		await vi.waitFor(() =>
			expect(controller.variableNodes[0].children[0]?.children[0]?.variable.value).toBe('42')
		);
		expect(controller.variableNodes[0].path).toBe(path);
		expect(controller.variableNodes[0].children[0].path).toBe(childPath);
		expect(debugVariables).toHaveBeenCalledWith(60, 0, 50);
		await controller.expandVariable(path, false);
		debugVariables.mockClear();
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, { id: 91, reference: 70 });
		await Promise.resolve();
		expect(controller.variableNodes[0].expanded).toBe(false);
		expect(debugVariables).not.toHaveBeenCalled();
	});

	it('restores expansion and compares a stepped frame after its caller pages arrive', async () => {
		let value = 'old';
		const debugVariables = vi.fn(async (reference: number) =>
			reference === 20
				? [{ name: 'items', value: 'after', variablesReference: 60 }]
				: [{ name: '[0]', value }]
		);
		const controller = controllerWith({ debugVariables });
		const frames = [
			{ id: 1, functionName: 'solve', line: 7, sourcePath: '/workspace/main.cpp' },
			{ id: 2, functionName: 'main', line: 4, sourcePath: '/workspace/main.cpp' }
		];
		pause(controller, { frames, sessionId: 'lldb', stopId: 1, value: 'before' });
		const path = controller.variableNodes[0].path;
		await controller.expandVariable(path);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		value = 'new';
		const nextFrames = frames.map((frame) => ({ ...frame, id: frame.id + 90 }));
		pause(controller, {
			id: 91,
			frames: nextFrames.slice(0, 1),
			sessionId: 'lldb',
			stopId: 2,
			callStackComplete: false,
			variables: [],
			scopes: []
		});
		controller.handleEvent({
			type: 'pauseDetails',
			stopId: 2,
			frameId: 91,
			scopes: [
				{
					name: 'Locals',
					variablesReference: 20,
					expensive: false,
					variables: [{ name: 'items', value: 'after', variablesReference: 60 }]
				}
			]
		});
		controller.handleEvent({
			type: 'pauseDetails',
			stopId: 2,
			callStack: nextFrames,
			callStackComplete: true
		});
		await vi.waitFor(() => expect(controller.variableNodes[0].children[0]?.changed).toBe(true));
		expect(controller.variableNodes[0]).toMatchObject({
			path,
			expanded: true,
			changed: true,
			previousValue: 'before'
		});
		expect(controller.variableNodes[0].children[0].previousValue).toBe('old');
		expect(debugVariables).toHaveBeenCalledWith(60, undefined, undefined);
	});

	it('does not compare an incomplete caller suffix with a previous complete frame', () => {
		const controller = controllerWith();
		pause(controller, { sessionId: 'lldb', stopId: 1, variables: [{ name: 'n', value: '1' }] });
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, {
			sessionId: 'lldb',
			stopId: 2,
			callStackComplete: false,
			variables: [{ name: 'n', value: '2' }]
		});
		expect(controller.variableNodes[0].changed).toBe(false);
		controller.handleEvent({
			type: 'pauseDetails',
			stopId: 2,
			callStackComplete: true,
			callStack: [
				{ id: 1, functionName: 'solve', sourcePath: '/workspace/main.cpp', line: 8 }
			]
		});
		expect(controller.variableNodes[0]).toMatchObject({ changed: true, previousValue: '1' });
	});

	it('does not retain a partial stack as the next stop comparison baseline', () => {
		const controller = controllerWith();
		pause(controller, {
			sessionId: 'lldb',
			stopId: 1,
			callStackComplete: false,
			variables: [{ name: 'n', value: '1' }]
		});
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, { sessionId: 'lldb', stopId: 2, variables: [{ name: 'n', value: '2' }] });
		expect(controller.variableNodes[0].changed).toBe(false);
	});

	it('ignores delayed details from another runtime session with the same stop number', () => {
		const controller = controllerWith();
		pause(controller, { sessionId: 'new-session', stopId: 1 });
		controller.handleEvent({
			type: 'pauseDetails',
			sessionId: 'old-session',
			stopId: 1,
			callStack: []
		});
		expect(controller.callStack).toHaveLength(1);
	});

	it('compares only pages loaded in both adjacent controlled steps', async () => {
		let value = 'old';
		const debugVariables = vi.fn(async (_reference: number, start = 0, count = 50) =>
			Array.from({ length: count }, (_, index) => ({ name: `[${index + start}]`, value }))
		);
		const controller = controllerWith({ debugVariables });
		pause(controller);
		const path = controller.variableNodes[0].path;
		await controller.expandVariable(path);
		await controller.sendCommand('nextLine');
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		value = 'new';
		pause(controller, { id: 99, reference: 60 });
		await vi.waitFor(() => expect(controller.variableNodes[0].children[0]?.changed).toBe(true));
		expect(controller.variableNodes[0].children[0].previousValue).toBe('old');
		await controller.loadMoreVariablePath(path);
		expect(controller.variableNodes[0].children).toHaveLength(100);
		expect(controller.variableNodes[0].children[50].changed).toBe(false);
		expect(controller.variableNodes[0].children[50].previousValue).toBeUndefined();
	});

	it('suppresses comparisons after continue, in a new session, and for ambiguous stack identity', async () => {
		const controller = controllerWith();
		pause(controller, { variables: [{ name: 'n', value: '1' }], sessionId: 'one' });
		controller.handleEvent({ type: 'resume', command: 'continue' });
		pause(controller, { variables: [{ name: 'n', value: '2' }], sessionId: 'one' });
		expect(controller.variableNodes[0].changed).toBe(false);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, { variables: [{ name: 'n', value: '3' }], sessionId: 'two' });
		expect(controller.variableNodes[0].changed).toBe(false);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, { frames: [], variables: [{ name: 'n', value: '4' }] });
		expect(controller.variableNodes[0].changed).toBe(false);
	});

	it('distinguishes recursive frames even when the new stop reuses their numeric IDs', async () => {
		let selected = 'outer';
		const frames = [
			{ id: 1, functionName: 'solve', line: 7, sourcePath: '/workspace/main.cpp' },
			{ id: 2, functionName: 'solve', line: 4, sourcePath: '/workspace/main.cpp' }
		];
		const controller = controllerWith({
			debugScopes: async () => [
				{
					name: 'Locals',
					expensive: false,
					variablesReference: 10,
					variables: [{ name: 'n', value: selected }]
				}
			]
		});
		pause(controller, { frames, variables: [{ name: 'n', value: 'inner' }] });
		const inner = controller.variableNodes[0].path;
		await controller.selectFrame(2);
		const outer = controller.variableNodes[0].path;
		expect(inner).not.toBe(outer);
		controller.handleEvent({ type: 'resume', command: 'stepOut' });
		selected = 'outer changed';
		pause(controller, {
			id: 1,
			frames: [{ ...frames[1], id: 1 }],
			variables: [{ name: 'n', value: selected }]
		});
		expect(controller.variableNodes[0].path).toBe(outer);
		expect(controller.variableNodes[0].changed).toBe(true);
		expect(controller.variableNodes[0].previousValue).toBe('outer');
	});

	it('invalidates late tree loads and does not fetch handles from read-only history', async () => {
		const children = deferred<DebugVariable[]>();
		const debugVariables = vi.fn(() => children.promise);
		const controller = controllerWith({ debugVariables });
		pause(controller);
		const path = controller.variableNodes[0].path;
		const expanding = controller.expandVariable(path);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause(controller, { id: 2, reference: 60 });
		children.resolve([{ name: '[0]', value: 'late' }]);
		await expanding;
		await Promise.resolve();
		expect(controller.variablesByReference.has(50)).toBe(false);
		controller.selectHistory(controller.history[0].id);
		debugVariables.mockClear();
		await expect(controller.expandVariable(controller.variableNodes[0].path)).resolves.toBe(
			false
		);
		await expect(controller.resolveHover('items')).resolves.toBeNull();
		expect(debugVariables).not.toHaveBeenCalled();
	});

	it('bounds and freezes snapshots without retaining live handles or mutable variables', async () => {
		const controller = controllerWith({}, { historyLimit: 2, snapshotVariableLimit: 1 });
		const variable = {
			name: 'n',
			value: 'one',
			variablesReference: 50,
			memoryReference: 'address'
		};
		pause(controller, { variables: [variable, { name: 'other', value: 'two' }] });
		const old = controller.history[0];
		variable.value = 'mutated';
		expect(old.variables[0].value).toBe('one');
		expect(old.truncated).toBe(true);
		expect(Object.isFrozen(old)).toBe(true);
		expect(Object.isFrozen(old.variables[0])).toBe(true);
		expect(JSON.stringify(old)).not.toContain('variablesReference');
		expect(JSON.stringify(old)).not.toContain('memoryReference');
		controller.selectHistory(old.id);
		pause(controller);
		pause(controller);
		expect(controller.history).toHaveLength(2);
		expect(controller.selectedHistoryId).toBeNull();
		expect(controller.selectHistory(old.id)).toBe(false);
	});

	it('resolves expandable watches and hover through safe variable paths while evaluation is unavailable', async () => {
		const debugEvaluateValue = vi.fn();
		const debugVariables = vi.fn(async () => [{ name: 'answer', value: '42' }]);
		const controller = controllerWith({ debugEvaluateValue, debugVariables });
		pause(controller, {
			variables: [{ name: 'pair', value: '{...}', variablesReference: 20, namedVariables: 1 }]
		});
		expect(controller.addWatchFromVariable(controller.variableNodes[0].path)).toBe(true);
		await vi.waitFor(() =>
			expect(controller.watchValues[0].node?.variable.variablesReference).toBe(20)
		);
		const watchPath = controller.watchValues[0].node!.path;
		await controller.expandVariable(watchPath);
		expect(controller.watchValues[0].node?.children[0].variable.value).toBe('42');
		await expect(controller.resolveHover('pair.answer')).resolves.toMatchObject({
			expression: 'pair.answer',
			value: '42'
		});
		await expect(controller.resolveHover('pair.answer + 1')).resolves.toBeNull();
		expect(debugEvaluateValue).not.toHaveBeenCalled();
	});

	it('retains structured evaluator references and rejects late hover results after frame changes', async () => {
		const result = deferred<{ result: string; variablesReference: number }>();
		const debugEvaluateValue = vi.fn(() => result.promise);
		const controller = controllerWith({ debugEvaluateValue, debugScopes: async () => [] });
		pause(controller, {
			capabilities: { ...capabilities, evaluateValues: true, evaluateForHovers: true },
			frames: [
				{ id: 1, functionName: 'solve', line: 7 },
				{ id: 2, functionName: 'main', line: 9 }
			]
		});
		const hovering = controller.resolveHover('items');
		await controller.selectFrame(2);
		result.resolve({ result: 'size=3', variablesReference: 80 });
		await expect(hovering).resolves.toBeNull();
		expect(debugEvaluateValue).toHaveBeenCalledWith('items', { context: 'hover', frameId: 1 });
	});

	it('uses variable discovery and preserves existing verified data breakpoints for quick actions', async () => {
		const debugDataBreakpointInfo = vi.fn(async ({ name }: { name: string }) => ({
			dataId: `opaque:${name}`,
			description: name,
			accessTypes: ['write' as const]
		}));
		const debugSetDataBreakpoints = vi.fn(async (specs: unknown[]) =>
			specs.map(() => ({ verified: true }))
		);
		const controller = controllerWith({ debugDataBreakpointInfo, debugSetDataBreakpoints });
		pause(controller, {
			variables: [
				{ name: 'a', value: '1' },
				{ name: 'b', value: '2' }
			],
			capabilities: { ...capabilities, dataBreakpoints: true }
		});
		await controller.watchVariable(controller.variableNodes[0].path);
		await controller.watchVariable(controller.variableNodes[1].path);
		expect(debugDataBreakpointInfo).toHaveBeenCalledWith({
			name: 'a',
			variablesReference: 10,
			frameId: 1
		});
		expect(debugSetDataBreakpoints).toHaveBeenLastCalledWith([
			{ dataId: 'opaque:a', accessType: 'write' },
			{ dataId: 'opaque:b', accessType: 'write' }
		]);
	});

	it('does not install a quick action after stale discovery or unsupported access', async () => {
		const discovery = deferred<{
			dataId: string;
			description: string;
			accessTypes: 'read'[];
		}>();
		const debugSetDataBreakpoints = vi.fn();
		const controller = controllerWith({
			debugDataBreakpointInfo: () => discovery.promise,
			debugSetDataBreakpoints
		});
		pause(controller, { capabilities: { ...capabilities, dataBreakpoints: true } });
		const setting = controller.watchVariable(controller.variableNodes[0].path);
		controller.handleEvent({ type: 'resume', command: 'continue' });
		discovery.resolve({ dataId: 'opaque', description: 'items', accessTypes: ['read'] });
		await expect(setting).resolves.toEqual([]);
		expect(debugSetDataBreakpoints).not.toHaveBeenCalled();
	});

	it('can replace earlier variable watches for a single-watchpoint UI and returns only the new result', async () => {
		const debugDataBreakpointInfo = vi.fn(async ({ name }: { name: string }) => ({
			dataId: name,
			description: name
		}));
		const debugSetDataBreakpoints = vi.fn(async (specs: { dataId: string }[]) =>
			specs.map((spec) => ({ id: spec.dataId === 'a' ? 10 : 20, verified: true }))
		);
		const controller = controllerWith({ debugDataBreakpointInfo, debugSetDataBreakpoints });
		pause(controller, {
			variables: [
				{ name: 'a', value: '1' },
				{ name: 'b', value: '2' }
			],
			capabilities: { ...capabilities, dataBreakpoints: true }
		});
		await controller.watchVariable(controller.variableNodes[0].path);
		await expect(controller.watchVariable(controller.variableNodes[1].path)).resolves.toEqual([
			{ id: 20, verified: true }
		]);
		await expect(
			controller.watchVariable(controller.variableNodes[0].path, 'write', {
				replaceExisting: true
			})
		).resolves.toEqual([{ id: 10, verified: true }]);
		expect(debugSetDataBreakpoints).toHaveBeenLastCalledWith([
			{ dataId: 'a', accessType: 'write' }
		]);
	});

	it('an explicit watchpoint replacement supersedes pending quick-action discovery', async () => {
		const info = deferred<{ dataId: string; description: string }>();
		const debugSetDataBreakpoints = vi.fn(async () => []);
		const controller = controllerWith({
			debugDataBreakpointInfo: () => info.promise,
			debugSetDataBreakpoints
		});
		pause(controller, { capabilities: { ...capabilities, dataBreakpoints: true } });
		const discovering = controller.watchVariable(controller.variableNodes[0].path);
		await controller.setDataBreakpoints([]);
		info.resolve({ dataId: 'late', description: 'items' });
		await expect(discovering).resolves.toEqual([]);
		expect(debugSetDataBreakpoints).toHaveBeenCalledExactlyOnceWith([]);
	});
});

describe('shared structured breakpoint and stepping state', () => {
	it('keeps the latest stepping preference when earlier completion or failure arrives late', async () => {
		const old = deferred<void>();
		const debugSetSteppingOptions = vi
			.fn()
			.mockReturnValueOnce(old.promise)
			.mockResolvedValue(undefined);
		const controller = controllerWith({ debugSetSteppingOptions });
		pause(controller, { capabilities: { ...capabilities, skipLibraryCode: true } });
		const first = controller.setSteppingOptions({ skipLibraryCode: true });
		await controller.setSteppingOptions({ skipLibraryCode: false });
		old.resolve();
		await expect(first).resolves.toBe(false);
		expect(controller.steppingOptions.skipLibraryCode).toBe(false);
		const next = deferred<void>();
		debugSetSteppingOptions.mockReturnValueOnce(next.promise);
		const replacing = controller.setSteppingOptions({ skipLibraryCode: true });
		controller.setTerminal({ debugCommand: async () => {} } as DebugTerminalControl);
		next.resolve();
		await expect(replacing).resolves.toBe(false);
		expect(controller.steppingOptions.skipLibraryCode).toBe(false);
	});
	it('retains disabled enriched specifications but rejects enabling unsupported options', async () => {
		const setSourceBreakpoints = vi.fn(async () => {});
		const controller = controllerWith({ setSourceBreakpoints });
		pause(controller);
		await expect(
			controller.setStructuredBreakpoints([{ line: 3, enabled: false, condition: 'n == 7' }])
		).resolves.toBe(true);
		expect(controller.structuredBreakpoints).toEqual([
			{ line: 3, enabled: false, condition: 'n == 7' }
		]);
		expect(setSourceBreakpoints).toHaveBeenLastCalledWith([], '/workspace/main.cpp');
		expect(() => controller.setBreakpoints([3])).toThrow('condition');
		expect(controller.breakpoints).toEqual([]);
		controller.setBreakpoints([]);
		expect(controller.structuredBreakpoints).toEqual([]);
	});
	it('restores a hit-count breakpoint after unconditional run-to-cursor on the same line', async () => {
		const setSourceBreakpoints = vi.fn(async () => {});
		const controller = controllerWith({ setSourceBreakpoints }, { syncBreakpointsWhile: true });
		await controller.setStructuredBreakpoints([{ line: 9, hitCondition: '10' }]);
		pause(controller, { capabilities: { ...capabilities, hitConditionalBreakpoints: true } });
		await controller.runToCursor(9);
		expect(setSourceBreakpoints).toHaveBeenLastCalledWith([{ line: 9 }], '/workspace/main.cpp');
		pause(controller, { capabilities: { ...capabilities, hitConditionalBreakpoints: true } });
		expect(setSourceBreakpoints).toHaveBeenLastCalledWith(
			[{ line: 9, hitCondition: '10' }],
			'/workspace/main.cpp'
		);
		expect(controller.structuredBreakpoints).toEqual([{ line: 9, hitCondition: '10' }]);
	});

	it('ignores superseded breakpoint transport failures and keeps the newer specification', async () => {
		let rejectOld!: (error: Error) => void;
		const old = new Promise<void>((_resolve, reject) => {
			rejectOld = reject;
		});
		const setSourceBreakpoints = vi.fn().mockReturnValueOnce(old).mockResolvedValue(undefined);
		const controller = controllerWith({ setSourceBreakpoints }, { syncBreakpointsWhile: true });
		const first = controller.setStructuredBreakpoints([{ line: 3 }]);
		await controller.setStructuredBreakpoints([{ line: 4 }]);
		rejectOld(new Error('obsolete transport failure'));
		await first;
		expect(controller.breakpointError).toBeNull();
		expect(controller.structuredBreakpoints).toEqual([{ line: 4 }]);
	});

	it('retains stepping policy when the active runtime rejects an update', async () => {
		const debugSetSteppingOptions = vi.fn(async () => {
			throw new Error('policy failed');
		});
		const controller = controllerWith({ debugSetSteppingOptions });
		pause(controller, { capabilities: { ...capabilities, skipLibraryCode: true } });
		await expect(controller.setSteppingOptions({ skipLibraryCode: true })).rejects.toThrow(
			'policy failed'
		);
		expect(controller.steppingOptions).toEqual({ skipLibraryCode: false });
	});
	it('preserves structured options by source, disabled specifications, and numeric gutter compatibility', async () => {
		const setSourceBreakpoints = vi.fn(async () => {});
		const controller = controllerWith({ setSourceBreakpoints }, { syncBreakpointsWhile: true });
		await controller.setStructuredBreakpoints([
			{ line: 4, condition: 'n == 7' },
			{ line: 9, enabled: false, logMessage: 'n={n}' }
		]);
		expect(controller.breakpoints).toEqual([4]);
		expect(setSourceBreakpoints).toHaveBeenLastCalledWith(
			[{ line: 4, condition: 'n == 7' }],
			'/workspace/main.cpp'
		);
		controller.setBreakpoints([4, 8]);
		expect(controller.structuredBreakpoints).toEqual([
			{ line: 4, condition: 'n == 7' },
			{ line: 8 }
		]);
		controller.setSourcePath('/workspace/lib.cpp');
		await controller.setStructuredBreakpoints([{ line: 3, hitCondition: '10' }]);
		controller.setSourcePath('/workspace/main.cpp');
		expect(controller.structuredBreakpoints[0].condition).toBe('n == 7');
		expect(controller.sourceBreakpoints[0].breakpoints).toHaveLength(2);
		controller.setBreakpoints([]);
		expect(controller.structuredBreakpoints).toEqual([]);
		expect(controller.breakpoints).toEqual([]);
	});

	it('gates unsupported live options and applies supported stepping to the actual terminal', async () => {
		const setSourceBreakpoints = vi.fn(async () => {});
		const debugSetSteppingOptions = vi.fn(async () => {});
		const controller = controllerWith({ setSourceBreakpoints, debugSetSteppingOptions });
		pause(controller);
		await expect(
			controller.setStructuredBreakpoints([{ line: 3, condition: 'n' }])
		).resolves.toBe(false);
		await expect(controller.setSteppingOptions({ skipLibraryCode: true })).resolves.toBe(false);
		expect(setSourceBreakpoints).not.toHaveBeenCalled();
		expect(debugSetSteppingOptions).not.toHaveBeenCalled();
		pause(controller, { capabilities: { ...capabilities, skipLibraryCode: true } });
		await expect(controller.setSteppingOptions({ skipLibraryCode: true })).resolves.toBe(true);
		expect(controller.steppingOptions).toEqual({ skipLibraryCode: true });
		expect(debugSetSteppingOptions).toHaveBeenCalledWith({ skipLibraryCode: true });
	});
});
