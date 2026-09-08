import { describe, expect, it, vi } from 'vitest';
import type { DebugVariable } from '@wasm-idle/core';

import { createDebugSessionController, type DebugTerminalControl } from '../src/controller.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createPausedVariableController(
	terminal: Partial<DebugTerminalControl>,
	locals: DebugVariable[] = []
) {
	const controller = createDebugSessionController({ terminal: terminal as DebugTerminalControl });
	controller.handleEvent({
		type: 'pause',
		line: 7,
		reason: 'breakpoint',
		frameId: 11,
		locals,
		callStack: [
			{ id: 11, functionName: 'callee', line: 7 },
			{ id: 12, functionName: 'main', line: 9 }
		],
		scopes: [{ name: 'Locals', variablesReference: 10, expensive: false, variables: locals }]
	});
	return controller;
}

describe('createDebugSessionController', () => {
	it('automatically loads bounded locals and arguments without expanding arrays or expensive scopes', async () => {
		const debugVariables = vi.fn(async (reference: number) => [
			{
				name: reference === 10 ? 'values' : 'argc',
				value: reference === 10 ? '[...]' : '2',
				variablesReference: reference === 10 ? 99 : 0,
				indexedVariables: reference === 10 ? 1000 : 0
			}
		]);
		const controller = createDebugSessionController({ terminal: { debugVariables } as never });
		controller.handleEvent({
			type: 'pause',
			line: 7,
			reason: 'breakpoint',
			frameId: 1,
			locals: [],
			callStack: [{ id: 1, functionName: 'main', line: 7 }],
			scopes: [
				{
					name: 'Local variables',
					presentationHint: 'locals',
					variablesReference: 10,
					expensive: false,
					variables: []
				},
				{
					name: 'Arguments',
					presentationHint: 'arguments',
					variablesReference: 11,
					expensive: false,
					variables: []
				},
				{ name: 'Globals', variablesReference: 12, expensive: true, variables: [] },
				{
					name: 'Registers',
					presentationHint: 'registers',
					variablesReference: 13,
					expensive: false,
					variables: []
				}
			]
		});
		expect(controller.paused).toBe(true);
		await vi.waitFor(() =>
			expect(controller.locals.map((variable) => variable.name)).toEqual(['values', 'argc'])
		);
		expect(debugVariables.mock.calls).toEqual([
			[10, 0, 50],
			[11, 0, 50]
		]);
		expect(controller.variablesByReference.has(99)).toBe(false);
	});

	it('loads frame locals automatically and discards the prior stop response after a step', async () => {
		const first = deferred<DebugVariable[]>();
		const debugVariables = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValue([{ name: 'depth', value: '2' }]);
		const controller = createPausedVariableController({
			debugVariables,
			debugScopes: async () => [
				{ name: 'Locals', variablesReference: 20, expensive: false, variables: [] }
			]
		});
		await controller.selectFrame(12);
		await vi.waitFor(() => expect(controller.locals).toEqual([{ name: 'depth', value: '2' }]));
		first.resolve([{ name: 'depth', value: '1' }]);
		await Promise.resolve();
		expect(controller.locals).toEqual([{ name: 'depth', value: '2' }]);
		expect(controller.variablesByReference.has(10)).toBe(false);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		expect(controller.locals).toEqual([]);
	});

	it('allows an automatic locals failure to be retried without leaving a loading reference', async () => {
		const debugVariables = vi
			.fn()
			.mockRejectedValueOnce(new Error('unavailable'))
			.mockResolvedValue([{ name: 'answer', value: '42' }]);
		const controller = createPausedVariableController({ debugVariables });
		await vi.waitFor(() => expect(controller.loadingVariableReferences.size).toBe(0));
		expect(controller.variablesByReference.has(10)).toBe(false);
		await controller.loadVariableChildren(10);
		expect(controller.locals).toEqual([{ name: 'answer', value: '42' }]);
	});
	it('pauses an active LLDB terminal without requiring an existing stopped frame', async () => {
		const debugPause = vi.fn(async () => undefined);
		const controller = createDebugSessionController({
			terminal: {
				debugPause
			} as never
		});

		controller.begin();
		await expect(controller.pause()).resolves.toBe(true);
		expect(debugPause).toHaveBeenCalledOnce();

		controller.handleEvent({
			type: 'pause',
			line: 1,
			reason: 'pause',
			locals: [],
			callStack: []
		});
		await expect(controller.pause()).resolves.toBe(false);
		expect(debugPause).toHaveBeenCalledOnce();
	});

	it('prefers runtime-backed watch evaluation and adds a temporary run-to-cursor breakpoint', async () => {
		const setBreakpoints = vi.fn(async () => undefined);
		const debugCommand = vi.fn(async () => undefined);
		const debugEvaluate = vi.fn(async (expression: string) => `${expression}=runtime`);
		const controller = createDebugSessionController({
			terminal: {
				debugCommand,
				setBreakpoints,
				debugEvaluate
			} as never,
			adapter: {
				id: 'cpp',
				evaluateExpression: vi.fn(() => 'fallback'),
				selectInlineLocals: vi.fn(() => [])
			} as never,
			breakpoints: [4],
			cursorLine: 8
		});

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [{ name: 'i', value: '5' }],
			callStack: [{ functionName: 'main', line: 5 }]
		});
		controller.watchInput = 'A[i].s';
		controller.addWatchExpression();

		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([
				{ expression: 'A[i].s', value: 'A[i].s=runtime' }
			])
		);
		expect(controller.canRunToCursor).toBe(true);

		await controller.runToCursor();

		expect(setBreakpoints).toHaveBeenLastCalledWith([4, 8]);
		expect(debugCommand).toHaveBeenLastCalledWith('continue');
	});

	it('resolves exact lazy LLDB variable names without advertising expression evaluation', async () => {
		const debugEvaluate = vi.fn(async () => '?');
		const debugVariables = vi.fn(async () => [
			{ name: 'answer', value: '42', type: 'int', variablesReference: 0 }
		]);
		const controller = createDebugSessionController({
			terminal: {
				debugEvaluate,
				debugVariables
			} as never
		});

		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [],
			callStack: [{ functionName: 'main', line: 5 }],
			scopes: [
				{
					name: 'Locals',
					variablesReference: 10,
					expensive: false,
					variables: []
				}
			]
		});
		controller.addWatchExpression('answer');
		controller.addWatchExpression('answer + 1');

		await controller.loadVariableChildren(10);

		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([
				{ expression: 'answer', value: '42' },
				{ expression: 'answer + 1', value: '?' }
			])
		);
		expect(debugEvaluate).toHaveBeenCalledWith('answer');
		expect(debugEvaluate).toHaveBeenCalledWith('answer + 1');
	});

	it('resolves safe nested LLDB variable paths with indexed paging', async () => {
		const debugEvaluate = vi.fn(async () => '?');
		const debugVariables = vi.fn(
			async (variablesReference: number, start?: number, count?: number) => {
				if (variablesReference === 10) {
					return [
						{ name: 'pair', value: '{...}', variablesReference: 20 },
						{ name: 'items', value: '[...]', variablesReference: 30 }
					];
				}
				if (variablesReference === 20) {
					return [
						{ name: 'first', value: '35', variablesReference: 0 },
						{ name: 'second', value: '38', variablesReference: 0 }
					];
				}
				if (variablesReference === 30 && start === 2 && count === 1) {
					return [{ name: '[2]', value: '73', variablesReference: 0 }];
				}
				return [];
			}
		);
		const controller = createDebugSessionController({
			terminal: { debugEvaluate, debugVariables } as never
		});
		controller.addWatchExpression('pair.first');
		controller.addWatchExpression('items[2]');
		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [],
			callStack: [{ functionName: 'main', line: 5 }],
			scopes: [
				{
					name: 'Locals',
					variablesReference: 10,
					expensive: false,
					variables: []
				}
			]
		});

		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([
				{ expression: 'pair.first', value: '35' },
				{ expression: 'items[2]', value: '73' }
			])
		);
		expect(debugVariables).toHaveBeenCalledWith(10, 0, 50);
		expect(debugVariables).toHaveBeenCalledWith(20);
		expect(debugVariables).toHaveBeenCalledWith(30, 2, 1);
	});

	it('does not traverse arbitrary watch expressions when LLDB evaluation is unavailable', async () => {
		const debugVariables = vi.fn(async () => []);
		const controller = createDebugSessionController({
			terminal: {
				debugEvaluate: vi.fn(async () => '?'),
				debugVariables
			} as never
		});
		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [{ name: 'pair', value: '{...}', variablesReference: 20 }],
			callStack: [{ functionName: 'main', line: 5 }]
		});
		controller.addWatchExpression('pair.first + 1');
		controller.addWatchExpression('pair.first()');

		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([
				{ expression: 'pair.first + 1', value: '?' },
				{ expression: 'pair.first()', value: '?' }
			])
		);
		expect(debugVariables).not.toHaveBeenCalled();
	});

	it('rejects oversized and over-deep watch expressions before invoking the runtime', () => {
		const debugEvaluate = vi.fn(async () => '?');
		const debugVariables = vi.fn(async () => []);
		const controller = createDebugSessionController({
			terminal: { debugEvaluate, debugVariables } as never
		});
		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [{ name: 'root', value: '{...}', variablesReference: 20 }],
			callStack: [{ functionName: 'main', line: 5 }]
		});

		const oversized = `${'x'.repeat(4_096)}y`;
		const overDeep = [
			'root',
			...Array.from({ length: 64 }, (_, index) => `field${index}`)
		].join('.');

		expect(controller.addWatchExpression(oversized)).toBe(false);
		expect(controller.addWatchExpression(overDeep)).toBe(false);
		expect(controller.watchExpressions).toEqual([]);
		expect(controller.watchValues).toEqual([]);
		expect(debugEvaluate).not.toHaveBeenCalled();
		expect(debugVariables).not.toHaveBeenCalled();
	});

	it('accepts the exact watch expression and variable-path limits', () => {
		const controller = createDebugSessionController();
		const exactCodeUnits = 'x'.repeat(4_096);
		const exactSegments = [
			'root',
			...Array.from({ length: 63 }, (_, index) => `field${index}`)
		].join('.');

		expect(controller.addWatchExpression(exactCodeUnits)).toBe(true);
		expect(controller.addWatchExpression(exactSegments)).toBe(true);
		expect(controller.watchExpressions).toEqual([exactCodeUnits, exactSegments]);
	});

	it('limits active watches without evaluating a rejected entry', () => {
		const controller = createDebugSessionController();
		for (let index = 0; index < 64; index += 1) {
			expect(controller.addWatchExpression(`watch${index}`)).toBe(true);
		}
		const evaluateExpression = vi.fn(() => 'value');
		controller.setAdapter({
			id: 'cpp',
			evaluateExpression,
			selectInlineLocals: vi.fn(() => [])
		} as never);
		const callsAtLimit = evaluateExpression.mock.calls.length;

		expect(controller.addWatchExpression('watch64')).toBe(false);
		expect(controller.watchExpressions).toHaveLength(64);
		expect(evaluateExpression).toHaveBeenCalledTimes(callsAtLimit);
	});

	it('discards a nested watch result that resolves after resume', async () => {
		const children =
			deferred<Array<{ name: string; value: string; variablesReference: number }>>();
		const controller = createDebugSessionController({
			terminal: {
				debugEvaluate: vi.fn(async () => '?'),
				debugVariables: vi.fn(() => children.promise)
			} as never
		});
		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [{ name: 'pair', value: '{...}', variablesReference: 20 }],
			callStack: [{ functionName: 'main', line: 5 }]
		});
		controller.addWatchExpression('pair.first');
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'pair.first', value: '...' }])
		);

		controller.handleEvent({ type: 'resume', command: 'continue' });
		children.resolve([{ name: 'first', value: '35', variablesReference: 0 }]);
		await Promise.resolve();
		await Promise.resolve();

		expect(controller.watchValues).toEqual([{ expression: 'pair.first', value: 'error' }]);
	});

	it('falls back to adapter evaluation, syncs breakpoints, and clears pause state on stop', () => {
		const setBreakpoints = vi.fn(async () => undefined);
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				setBreakpoints
			} as never,
			adapter: {
				id: 'cpp',
				evaluateExpression: vi.fn(
					(_expression: string, locals: { value: string }[]) => locals[0]?.value || '?'
				),
				selectInlineLocals: vi.fn(() => [])
			} as never
		});

		controller.setCursorLine(3);
		controller.setBreakpoints([2, 9]);
		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 2,
			reason: 'entry',
			locals: [{ name: 'sum', value: '55' }],
			callStack: [{ functionName: 'main', line: 2 }]
		});
		controller.watchInput = 'sum';
		controller.addWatchExpression();

		expect(controller.watchValues).toEqual([{ expression: 'sum', value: '55' }]);
		expect(controller.breakpoints).toEqual([2, 9]);
		expect(controller.active).toBe(true);
		expect(controller.paused).toBe(true);
		expect(setBreakpoints).toHaveBeenCalledWith([2, 9]);

		controller.handleEvent({ type: 'stop' });

		expect(controller.active).toBe(false);
		expect(controller.paused).toBe(false);
		expect(controller.pausedLine).toBe(null);
		expect(controller.locals).toEqual([]);
		expect(controller.callStack).toEqual([]);
	});

	it('updates watches when terminal or adapter bindings change after construction', async () => {
		const adapter = {
			id: 'cpp',
			evaluateExpression: vi.fn(() => 'fallback'),
			selectInlineLocals: vi.fn(() => [])
		} as never;
		const controller = createDebugSessionController();

		controller.handleEvent({
			type: 'pause',
			line: 3,
			reason: 'breakpoint',
			locals: [{ name: 'sum', value: '34' }],
			callStack: [{ functionName: 'main', line: 3 }]
		});
		controller.watchInput = 'sum';
		controller.addWatchExpression();

		expect(controller.watchValues).toEqual([{ expression: 'sum', value: 'error' }]);

		controller.setAdapter(adapter);
		expect(controller.watchValues).toEqual([{ expression: 'sum', value: 'fallback' }]);

		controller.setTerminal({
			debugCommand: vi.fn(async () => undefined),
			debugEvaluate: vi.fn(async () => '34')
		} as never);

		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'sum', value: '34' }])
		);
	});

	it('does not restore cleared watches when an older runtime evaluation resolves late', async () => {
		let resolveEvaluation: ((value: string) => void) | null = null;
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				debugEvaluate: vi.fn(
					() =>
						new Promise<string>((resolve) => {
							resolveEvaluation = resolve;
						})
				)
			} as never
		});

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 4,
			reason: 'breakpoint',
			locals: [{ name: 'sum', value: '21' }],
			callStack: [{ functionName: 'main', line: 4 }]
		});
		controller.watchInput = 'sum';
		controller.addWatchExpression();
		controller.clearWatches();

		expect(controller.watchExpressions).toEqual([]);
		expect(controller.watchValues).toEqual([]);

		expect(resolveEvaluation).not.toBeNull();
		if (!resolveEvaluation) {
			throw new Error('expected pending evaluation resolver');
		}
		(resolveEvaluation as (value: string) => void)('21');
		await Promise.resolve();
		await Promise.resolve();

		expect(controller.watchExpressions).toEqual([]);
		expect(controller.watchValues).toEqual([]);
	});

	it('does not dispatch a second continue or step command while one is pending', async () => {
		let resolveCommand: (() => void) | null = null;
		const debugCommand = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveCommand = resolve;
				})
		);
		const controller = createDebugSessionController({
			terminal: { debugCommand } as never
		});

		controller.handleEvent({
			type: 'pause',
			line: 6,
			reason: 'breakpoint',
			locals: [],
			callStack: []
		});

		const continuing = controller.sendCommand('continue');
		await expect(controller.sendCommand('nextLine')).resolves.toBe(false);
		expect(debugCommand).toHaveBeenCalledTimes(1);

		expect(resolveCommand).not.toBeNull();
		if (!resolveCommand) throw new Error('expected pending command resolver');
		(resolveCommand as () => void)();
		await expect(continuing).resolves.toBe(true);
	});

	it('releases a pending command on pause without letting its late completion unlock the next command', async () => {
		const commandResolvers: Array<() => void> = [];
		const debugCommand = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					commandResolvers.push(resolve);
				})
		);
		const controller = createDebugSessionController({
			terminal: { debugCommand } as never
		});

		controller.handleEvent({
			type: 'pause',
			line: 6,
			reason: 'entry',
			locals: [],
			callStack: []
		});
		const continuing = controller.sendCommand('continue');
		controller.handleEvent({ type: 'resume', command: 'continue' });
		controller.handleEvent({
			type: 'pause',
			line: 7,
			reason: 'breakpoint',
			locals: [],
			callStack: []
		});

		const stepping = controller.sendCommand('nextLine');
		expect(debugCommand).toHaveBeenCalledTimes(2);
		commandResolvers[0]();
		await expect(continuing).resolves.toBe(true);
		await expect(controller.sendCommand('stepOut')).resolves.toBe(false);

		commandResolvers[1]();
		await expect(stepping).resolves.toBe(true);
	});

	it('restores persistent breakpoints after a run-to-cursor pause', async () => {
		const setBreakpoints = vi.fn(async () => undefined);
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				setBreakpoints
			} as never,
			breakpoints: [4],
			cursorLine: 8
		});

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [],
			callStack: []
		});
		await controller.runToCursor();
		expect(setBreakpoints).toHaveBeenLastCalledWith([4, 8]);

		controller.handleEvent({
			type: 'pause',
			line: 8,
			reason: 'breakpoint',
			locals: [],
			callStack: []
		});

		expect(setBreakpoints).toHaveBeenLastCalledWith([4]);
		expect(controller.runToCursorLine).toBe(null);
		expect(controller.effectiveBreakpoints).toEqual([4]);
	});

	it('retains LLDB thread, frame, scopes, and loads variable children lazily', async () => {
		const debugVariables = vi.fn(async () => [
			{ name: 'field', value: '9', type: 'int', variablesReference: 0 }
		]);
		const debugScopes = vi.fn(async (frameId: number) => [
			{
				name: `Locals ${frameId}`,
				variablesReference: frameId,
				expensive: false,
				variables: []
			}
		]);
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				debugVariables,
				debugScopes
			} as never
		});

		controller.handleEvent({
			type: 'pause',
			line: 7,
			reason: 'breakpoint',
			stoppedReason: 'breakpoint',
			threadId: 3,
			frameId: 11,
			locals: [{ name: 'point', value: '{...}', variablesReference: 42 }],
			callStack: [
				{ id: 11, functionName: 'recurse', line: 7 },
				{ id: 12, functionName: 'recurse', line: 9 }
			],
			scopes: [
				{
					name: 'Locals',
					variablesReference: 10,
					expensive: false,
					variables: [{ name: 'point', value: '{...}', variablesReference: 42 }]
				}
			]
		});

		expect(controller.threadId).toBe(3);
		expect(controller.frameId).toBe(11);
		expect(controller.stoppedReason).toBe('breakpoint');
		expect(controller.scopes[0]?.name).toBe('Locals');
		expect(controller.variablesByReference.has(42)).toBe(false);

		await expect(controller.selectFrame(12)).resolves.toBe(true);
		expect(debugScopes).toHaveBeenCalledWith(12);
		expect(controller.frameId).toBe(12);
		expect(controller.scopes).toEqual([
			{
				name: 'Locals 12',
				variablesReference: 12,
				expensive: false,
				variables: []
			}
		]);
		expect(controller.variablesByReference.size).toBe(0);

		debugScopes.mockRejectedValueOnce(new Error('scope failure'));
		await expect(controller.selectFrame(11)).resolves.toBe(false);
		expect(controller.frameId).toBe(12);
		expect(controller.scopes[0]?.name).toBe('Locals 12');

		await expect(controller.loadVariableChildren(42)).resolves.toEqual([
			{ name: 'field', value: '9', type: 'int', variablesReference: 0 }
		]);
		expect(debugVariables).toHaveBeenCalledWith(42, undefined, undefined);
		expect(controller.variablesByReference.get(42)).toEqual([
			{ name: 'field', value: '9', type: 'int', variablesReference: 0 }
		]);

		controller.handleEvent({
			type: 'breakpoints',
			sourcePath: '/workspace/main.cpp',
			breakpoints: [
				{ requestedLine: 6, line: 7, verified: true },
				{ requestedLine: 10, line: 10, verified: false, message: 'no code' }
			]
		});
		expect(controller.resolvedBreakpoints).toEqual([
			{ requestedLine: 6, line: 7, verified: true },
			{ requestedLine: 10, line: 10, verified: false, message: 'no code' }
		]);
	});

	it.each(['success', 'failure'] as const)(
		'discards a late lazy-variable %s after resume',
		async (settlement) => {
			let resolveVariables!: (variables: Array<{ name: string; value: string }>) => void;
			let rejectVariables!: (error: Error) => void;
			const debugVariables = vi.fn(
				() =>
					new Promise<Array<{ name: string; value: string }>>((resolve, reject) => {
						resolveVariables = resolve;
						rejectVariables = reject;
					})
			);
			const controller = createDebugSessionController({
				terminal: { debugVariables } as never
			});
			controller.handleEvent({
				type: 'pause',
				line: 7,
				reason: 'breakpoint',
				locals: [],
				callStack: [{ id: 11, functionName: 'main', line: 7 }],
				scopes: [
					{
						name: 'Locals',
						variablesReference: 50,
						expensive: false,
						variables: []
					}
				]
			});

			const loading = controller.loadVariableChildren(50);
			expect(debugVariables).toHaveBeenCalledWith(50, 0, 50);
			controller.handleEvent({ type: 'resume', command: 'continue' });
			if (settlement === 'success') {
				resolveVariables([{ name: 'late', value: '1' }]);
			} else {
				rejectVariables(new Error('obsolete variable failure'));
			}

			await expect(loading).resolves.toEqual([]);
			expect(controller.variablesByReference.has(50)).toBe(false);
			expect(controller.locals).toEqual([]);
			expect(controller.paused).toBe(false);
		}
	);

	it('merges paginated lazy-variable children at their requested offsets', async () => {
		const firstPage = [
			{ name: '[0]', value: '10', variablesReference: 0 },
			{ name: '[1]', value: '20', variablesReference: 0 }
		];
		const secondPage = [{ name: '[2]', value: '30', variablesReference: 0 }];
		const debugVariables = vi
			.fn()
			.mockResolvedValueOnce(firstPage)
			.mockResolvedValueOnce(secondPage);
		const controller = createDebugSessionController({
			terminal: { debugVariables } as never
		});
		controller.handleEvent({
			type: 'pause',
			line: 7,
			reason: 'breakpoint',
			locals: [],
			callStack: [{ id: 11, functionName: 'main', line: 7 }],
			scopes: [
				{
					name: 'Custom scope',
					variablesReference: 50,
					expensive: false,
					variables: []
				}
			]
		});

		await expect(controller.loadVariableChildren(50, 0, 2)).resolves.toEqual(firstPage);
		await expect(controller.loadVariableChildren(50, 2, 2)).resolves.toEqual(secondPage);

		expect(debugVariables).toHaveBeenNthCalledWith(1, 50, 0, 2);
		expect(debugVariables).toHaveBeenNthCalledWith(2, 50, 2, 2);
		expect(controller.variablesByReference.get(50)).toEqual([...firstPage, ...secondPage]);
		expect(controller.locals).toEqual([...firstPage, ...secondPage]);
	});

	it('loads a thousand-element array in 50-child pages and coalesces rapid expansion clicks', async () => {
		const elements = Array.from({ length: 1_000 }, (_, index) => ({
			name: `[${index}]`,
			value: String(index),
			variablesReference: 0
		}));
		const firstPage = deferred<DebugVariable[]>();
		const debugVariables = vi.fn(async (_reference: number, start?: number, count?: number) =>
			start === 0 ? firstPage.promise : elements.slice(start, start! + count!)
		);
		const variable = {
			name: 'items',
			value: '[...]',
			variablesReference: 50,
			indexedVariables: 1_000
		};
		const controller = createPausedVariableController({ debugVariables }, [variable]);

		const firstClick = controller.loadMoreVariableChildren(variable);
		const repeatedClick = controller.loadMoreVariableChildren(variable);
		expect(debugVariables).toHaveBeenCalledExactlyOnceWith(50, 0, 50);
		expect(controller.loadingVariableReferences.has(50)).toBe(true);
		firstPage.resolve(elements.slice(0, 50));
		await Promise.all([firstClick, repeatedClick]);
		expect(controller.loadingVariableReferences.size).toBe(0);
		expect(controller.variablesByReference.get(50)).toEqual(elements.slice(0, 50));

		await controller.loadMoreVariableChildren(variable);
		expect(debugVariables).toHaveBeenNthCalledWith(2, 50, 50, 50);
		expect(controller.variablesByReference.get(50)).toEqual(elements.slice(0, 100));
		expect(controller.locals).toEqual([variable]);
	});

	it('preserves mixed named/indexed children and stops after the short final page', async () => {
		const children = [
			{ name: 'length', value: '51' },
			{ name: 'capacity', value: '51' },
			...Array.from({ length: 51 }, (_, index) => ({
				name: `[${index}]`,
				value: String(index)
			}))
		];
		const debugVariables = vi.fn(async (_reference: number, start?: number, count?: number) =>
			children.slice(start, start! + count!)
		);
		const variable = {
			name: 'items',
			value: '[...]',
			variablesReference: 50,
			namedVariables: 2,
			indexedVariables: 51
		};
		const controller = createPausedVariableController({ debugVariables }, [variable]);

		await controller.loadMoreVariableChildren(variable);
		await controller.loadMoreVariableChildren(variable);
		await expect(controller.loadMoreVariableChildren(variable)).resolves.toEqual([]);
		expect(debugVariables.mock.calls).toEqual([
			[50, 0, 50],
			[50, 50, 3]
		]);
		expect(controller.variablesByReference.get(50)).toEqual(children);
	});

	it('keeps named-only children unpaged and leaves scalar variables alone', async () => {
		const fields = [
			{ name: 'x', value: '1' },
			{ name: 'y', value: '2' }
		];
		const debugVariables = vi.fn(async () => fields);
		const variable = {
			name: 'point',
			value: '{...}',
			variablesReference: 50,
			namedVariables: 2
		};
		const controller = createPausedVariableController({ debugVariables }, [variable]);

		await controller.loadMoreVariableChildren(variable);
		await controller.loadMoreVariableChildren(variable);
		await controller.loadMoreVariableChildren({
			name: 'scalar',
			value: '3',
			variablesReference: 0
		});
		expect(debugVariables).toHaveBeenCalledExactlyOnceWith(50, undefined, undefined);
		expect(controller.variablesByReference.get(50)).toEqual(fields);
	});

	it('shares an in-flight scope read between a watch and the variable panel', async () => {
		const variables = deferred<DebugVariable[]>();
		const debugVariables = vi.fn(() => variables.promise);
		const controller = createPausedVariableController({
			debugVariables,
			debugEvaluate: async () => '?'
		});
		controller.addWatchExpression('answer');
		await vi.waitFor(() => expect(debugVariables).toHaveBeenCalledOnce());
		const panel = controller.loadVariableChildren(10);
		expect(debugVariables).toHaveBeenCalledOnce();
		variables.resolve([{ name: 'answer', value: '42' }]);
		await panel;
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'answer', value: '42' }])
		);
		expect(debugVariables).toHaveBeenCalledOnce();
		expect(controller.locals).toEqual([{ name: 'answer', value: '42' }]);
	});

	it('keeps distant indexed watch reads separate from the displayed array prefix', async () => {
		const elements = Array.from({ length: 1_000 }, (_, index) => ({
			name: `[${index}]`,
			value: String(index)
		}));
		const debugVariables = vi.fn(async (_reference: number, start?: number, count?: number) =>
			elements.slice(start, start! + count!)
		);
		const variable = {
			name: 'items',
			value: '[...]',
			variablesReference: 50,
			indexedVariables: 1_000
		};
		const controller = createPausedVariableController(
			{ debugVariables, debugEvaluate: async () => '?' },
			[variable]
		);
		await controller.loadMoreVariableChildren(variable);
		controller.addWatchExpression('items[999]');
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'items[999]', value: '999' }])
		);
		expect(debugVariables).toHaveBeenLastCalledWith(50, 999, 1);
		expect(controller.variablesByReference.get(50)).toEqual(elements.slice(0, 50));
		await controller.loadMoreVariableChildren(variable);
		expect(debugVariables).toHaveBeenLastCalledWith(50, 50, 50);
		expect(controller.variablesByReference.get(50)).toEqual(elements.slice(0, 100));
	});

	it('resolves a named watch outside a mixed array page without expanding the displayed list', async () => {
		const children = [
			...Array.from({ length: 100 }, (_, index) => ({
				name: `[${index}]`,
				value: String(index)
			})),
			{ name: 'length', value: '100' }
		];
		const debugVariables = vi.fn(async (_reference: number, start?: number, count?: number) =>
			start === undefined ? children : children.slice(start, start + count!)
		);
		const variable = {
			name: 'items',
			value: '[...]',
			variablesReference: 50,
			indexedVariables: 100,
			namedVariables: 1
		};
		const controller = createPausedVariableController(
			{ debugVariables, debugEvaluate: async () => '?' },
			[variable]
		);
		await controller.loadMoreVariableChildren(variable);
		controller.addWatchExpression('items.length');
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'items.length', value: '100' }])
		);
		expect(controller.variablesByReference.get(50)).toEqual(children.slice(0, 50));
	});

	it('does not share old in-flight reads when a new stop reuses a variable reference', async () => {
		const oldPage = deferred<DebugVariable[]>();
		const newPage = deferred<DebugVariable[]>();
		const debugVariables = vi
			.fn()
			.mockReturnValueOnce(oldPage.promise)
			.mockReturnValueOnce(newPage.promise);
		const variable = {
			name: 'items',
			value: '[...]',
			variablesReference: 50,
			indexedVariables: 100
		};
		const controller = createPausedVariableController({ debugVariables }, [variable]);
		const oldLoad = controller.loadMoreVariableChildren(variable);
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		expect(controller.loadingVariableReferences.size).toBe(0);
		await controller.loadMoreVariableChildren(variable);
		expect(debugVariables).toHaveBeenCalledOnce();
		controller.handleEvent({
			type: 'pause',
			reason: 'step',
			line: 8,
			locals: [variable],
			callStack: []
		});
		const newLoad = controller.loadMoreVariableChildren(variable);
		expect(debugVariables).toHaveBeenCalledTimes(2);
		oldPage.resolve([{ name: '[0]', value: 'old' }]);
		await expect(oldLoad).resolves.toEqual([]);
		expect(controller.loadingVariableReferences.has(50)).toBe(true);
		expect(controller.variablesByReference.has(50)).toBe(false);
		newPage.resolve([{ name: '[0]', value: 'new' }]);
		await newLoad;
		expect(controller.variablesByReference.get(50)).toEqual([{ name: '[0]', value: 'new' }]);
		expect(controller.loadingVariableReferences.size).toBe(0);
	});

	it('invalidates reads started both before and during a frame switch', async () => {
		const oldPage = deferred<DebugVariable[]>();
		const duringSwitch = deferred<DebugVariable[]>();
		const scopeRead = deferred<[]>();
		const debugVariables = vi
			.fn()
			.mockReturnValueOnce(oldPage.promise)
			.mockReturnValueOnce(duringSwitch.promise)
			.mockResolvedValue([{ name: '[0]', value: 'new frame' }]);
		const variable = {
			name: 'items',
			value: '[...]',
			variablesReference: 50,
			indexedVariables: 100
		};
		const controller = createPausedVariableController(
			{ debugVariables, debugScopes: () => scopeRead.promise },
			[variable]
		);
		const oldLoad = controller.loadMoreVariableChildren(variable);
		const selecting = controller.selectFrame(12);
		const duringLoad = controller.loadMoreVariableChildren(variable);
		expect(debugVariables).toHaveBeenCalledTimes(2);
		scopeRead.resolve([]);
		await expect(selecting).resolves.toBe(true);
		oldPage.resolve([{ name: '[0]', value: 'old' }]);
		duringSwitch.resolve([{ name: '[0]', value: 'during' }]);
		await expect(oldLoad).resolves.toEqual([]);
		await expect(duringLoad).resolves.toEqual([]);
		expect(controller.variablesByReference.has(50)).toBe(false);
		await controller.loadMoreVariableChildren(variable);
		expect(debugVariables).toHaveBeenNthCalledWith(3, 50, 0, 50);
		expect(controller.variablesByReference.get(50)).toEqual([
			{ name: '[0]', value: 'new frame' }
		]);
	});

	it('restarts canceled watch evaluation when a frame switch fails', async () => {
		const oldEvaluation = deferred<string>();
		const debugEvaluate = vi
			.fn()
			.mockReturnValueOnce(oldEvaluation.promise)
			.mockResolvedValue('?');
		const controller = createPausedVariableController(
			{
				debugEvaluate,
				debugScopes: async () => {
					throw new Error('scope failure');
				}
			},
			[{ name: 'answer', value: '42' }]
		);
		controller.addWatchExpression('answer');
		expect(controller.watchValues).toEqual([{ expression: 'answer', value: '...' }]);
		await expect(controller.selectFrame(12)).resolves.toBe(false);
		await vi.waitFor(() =>
			expect(controller.watchValues).toEqual([{ expression: 'answer', value: '42' }])
		);
		oldEvaluation.resolve('stale');
		await oldEvaluation.promise;
		expect(controller.frameId).toBe(11);
		expect(controller.watchValues).toEqual([{ expression: 'answer', value: '42' }]);
	});

	it('does not reuse a pending variable read after the terminal changes', async () => {
		const oldPage = deferred<DebugVariable[]>();
		const oldVariables = vi.fn(() => oldPage.promise);
		const newVariables = vi.fn(async () => [{ name: '[0]', value: 'new terminal' }]);
		const controller = createPausedVariableController({ debugVariables: oldVariables });
		const oldLoad = controller.loadVariableChildren(50, 0, 50);
		controller.setTerminal({ debugVariables: newVariables } as DebugTerminalControl);
		await controller.loadVariableChildren(50, 0, 50);
		oldPage.resolve([{ name: '[0]', value: 'old terminal' }]);
		await expect(oldLoad).resolves.toEqual([]);
		expect(newVariables).toHaveBeenCalledExactlyOnceWith(50, 0, 50);
		expect(controller.variablesByReference.get(50)).toEqual([
			{ name: '[0]', value: 'new terminal' }
		]);
	});

	it('releases failed requests so the same page can be retried', async () => {
		const debugVariables = vi
			.fn()
			.mockRejectedValueOnce(new Error('read failed'))
			.mockResolvedValue([{ name: '[0]', value: '1' }]);
		const variable = {
			name: 'items',
			value: '[...]',
			variablesReference: 50,
			indexedVariables: 100
		};
		const controller = createPausedVariableController({ debugVariables }, [variable]);
		await expect(controller.loadMoreVariableChildren(variable)).rejects.toThrow('read failed');
		expect(controller.loadingVariableReferences.size).toBe(0);
		expect(controller.variablesByReference.has(50)).toBe(false);
		await controller.loadMoreVariableChildren(variable);
		expect(debugVariables.mock.calls).toEqual([
			[50, 0, 50],
			[50, 0, 50]
		]);
	});

	it('reads LLDB memory through the paused terminal session', async () => {
		const debugReadMemory = vi.fn(async () => ({
			address: '0x20',
			data: Uint8Array.of(0x2a, 0x00),
			unreadableBytes: 0
		}));
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				debugReadMemory
			} as never
		});

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 3,
			reason: 'breakpoint',
			locals: [],
			callStack: [],
			capabilities: { readMemory: true, writeMemory: false, dataBreakpoints: false }
		});

		await expect(controller.readMemory('0x20', 0, 2)).resolves.toEqual({
			address: '0x20',
			data: Uint8Array.of(0x2a, 0x00),
			unreadableBytes: 0
		});
		expect(debugReadMemory).toHaveBeenCalledWith('0x20', 0, 2);
	});

	it('writes LLDB memory only through a paused terminal session', async () => {
		const debugWriteMemory = vi.fn(async () => ({ offset: 4, bytesWritten: 2 }));
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				debugWriteMemory
			} as never
		});

		await expect(
			controller.writeMemory('0x20', 4, Uint8Array.of(0x2a, 0x00), true)
		).resolves.toBeNull();

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 3,
			reason: 'breakpoint',
			locals: [],
			callStack: [],
			capabilities: { readMemory: false, writeMemory: true, dataBreakpoints: false }
		});

		await expect(
			controller.writeMemory('0x20', 4, Uint8Array.of(0x2a, 0x00), true)
		).resolves.toEqual({ offset: 4, bytesWritten: 2 });
		expect(debugWriteMemory).toHaveBeenCalledTimes(1);
		expect(debugWriteMemory).toHaveBeenCalledWith('0x20', 4, Uint8Array.of(0x2a, 0x00), true);
	});

	it('manages LLDB data breakpoints only through a paused terminal session', async () => {
		const debugDataBreakpointInfo = vi.fn(async () => ({
			dataId: '20/2',
			description: '2 bytes at 20',
			accessTypes: ['read', 'write', 'readWrite'] as const
		}));
		const debugSetDataBreakpoints = vi.fn(async () => [{ id: 4, verified: true }]);
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				debugDataBreakpointInfo,
				debugSetDataBreakpoints
			} as never
		});

		await expect(
			controller.dataBreakpointInfo({ name: '0x20', asAddress: true, bytes: 2 })
		).resolves.toBeNull();
		await expect(controller.setDataBreakpoints([])).resolves.toEqual([]);

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 3,
			reason: 'breakpoint',
			locals: [],
			callStack: [],
			capabilities: { readMemory: false, writeMemory: false, dataBreakpoints: true }
		});

		await expect(
			controller.dataBreakpointInfo({ name: '0x20', asAddress: true, bytes: 2 })
		).resolves.toEqual({
			dataId: '20/2',
			description: '2 bytes at 20',
			accessTypes: ['read', 'write', 'readWrite']
		});
		await expect(
			controller.setDataBreakpoints([{ dataId: '20/2', accessType: 'write' }])
		).resolves.toEqual([{ id: 4, verified: true }]);
		expect(debugDataBreakpointInfo).toHaveBeenCalledOnce();
		expect(debugSetDataBreakpoints).toHaveBeenCalledOnce();
	});

	it('rejects bounded memory and data-breakpoint inputs before calling the terminal', async () => {
		const debugReadMemory = vi.fn(async () => ({
			address: '0x0',
			data: new Uint8Array(),
			unreadableBytes: 0
		}));
		const debugWriteMemory = vi.fn(async () => ({ bytesWritten: 0 }));
		const debugDataBreakpointInfo = vi.fn(async () => ({ description: 'byte' }));
		const debugSetDataBreakpoints = vi.fn(async () => []);
		const controller = createDebugSessionController({
			terminal: {
				debugReadMemory,
				debugWriteMemory,
				debugDataBreakpointInfo,
				debugSetDataBreakpoints
			} as never
		});
		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 1,
			reason: 'breakpoint',
			locals: [],
			callStack: [],
			capabilities: { readMemory: true, writeMemory: true, dataBreakpoints: true }
		});

		await expect(controller.readMemory('m'.repeat(4097), 0, 1)).resolves.toBeNull();
		await expect(controller.readMemory('memory', 0, 257)).resolves.toBeNull();
		await expect(
			controller.writeMemory('m'.repeat(4097), 0, Uint8Array.of(1))
		).resolves.toBeNull();
		await expect(controller.writeMemory('memory', 0, new Uint8Array(257))).resolves.toBeNull();
		await expect(
			controller.writeMemory('memory', 0, Uint8Array.of(1), 'yes' as never)
		).resolves.toBeNull();
		await expect(controller.dataBreakpointInfo({ name: '' })).resolves.toBeNull();
		await expect(controller.dataBreakpointInfo({ name: 'n'.repeat(4097) })).resolves.toBeNull();
		await expect(
			controller.dataBreakpointInfo({ name: 'counter', bytes: 257 })
		).resolves.toBeNull();
		await expect(
			controller.dataBreakpointInfo({ name: 'counter', asAddress: 'yes' as never })
		).resolves.toBeNull();
		await expect(controller.setDataBreakpoints({ length: 0 } as never)).resolves.toEqual([]);
		await expect(
			controller.setDataBreakpoints(
				Array.from({ length: 257 }, (_, index) => ({ dataId: `${index}/1` }))
			)
		).resolves.toEqual([]);
		await expect(controller.setDataBreakpoints([{ dataId: '' }])).resolves.toEqual([]);
		await expect(
			controller.setDataBreakpoints([{ dataId: 'd'.repeat(4097) }])
		).resolves.toEqual([]);

		expect(debugReadMemory).not.toHaveBeenCalled();
		expect(debugWriteMemory).not.toHaveBeenCalled();
		expect(debugDataBreakpointInfo).not.toHaveBeenCalled();
		expect(debugSetDataBreakpoints).not.toHaveBeenCalled();
	});

	it('serializes a data-breakpoint replacement against run to cursor', async () => {
		const replacement = deferred<Array<{ id: number; verified: boolean }>>();
		const debugSetDataBreakpoints = vi.fn(() => replacement.promise);
		const debugCommand = vi.fn(async () => undefined);
		const setBreakpoints = vi.fn(async () => undefined);
		const controller = createDebugSessionController({
			terminal: {
				debugCommand,
				debugSetDataBreakpoints,
				setBreakpoints
			} as never,
			breakpoints: [4],
			cursorLine: 8
		});
		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 5,
			reason: 'breakpoint',
			locals: [],
			callStack: [],
			capabilities: { dataBreakpoints: true }
		});
		setBreakpoints.mockClear();

		const replacing = controller.setDataBreakpoints([
			{ dataId: '1000/1', accessType: 'write' }
		]);
		await vi.waitFor(() => expect(debugSetDataBreakpoints).toHaveBeenCalledOnce());

		await expect(controller.runToCursor()).resolves.toBe(false);
		expect(setBreakpoints).not.toHaveBeenCalled();
		expect(debugCommand).not.toHaveBeenCalled();

		replacement.resolve([{ id: 1, verified: true }]);
		await expect(replacing).resolves.toEqual([{ id: 1, verified: true }]);
		await expect(controller.runToCursor()).resolves.toBe(true);
		expect(setBreakpoints).toHaveBeenLastCalledWith([4, 8]);
		expect(debugCommand).toHaveBeenLastCalledWith('continue');
	});

	it('gates paused memory operations with effective LLDB capabilities', async () => {
		const debugReadMemory = vi.fn(async () => ({ data: Uint8Array.of(1), unreadableBytes: 0 }));
		const debugWriteMemory = vi.fn(async () => ({ bytesWritten: 1 }));
		const debugDataBreakpointInfo = vi.fn(async () => ({ description: 'byte' }));
		const debugSetDataBreakpoints = vi.fn(async () => [{ verified: true }]);
		const controller = createDebugSessionController({
			terminal: {
				debugReadMemory,
				debugWriteMemory,
				debugDataBreakpointInfo,
				debugSetDataBreakpoints
			} as never
		});

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 1,
			reason: 'breakpoint',
			locals: [],
			callStack: [],
			capabilities: { readMemory: false, writeMemory: false, dataBreakpoints: false }
		});

		expect(controller.capabilities).toEqual({
			readMemory: false,
			writeMemory: false,
			dataBreakpoints: false
		});
		await expect(controller.readMemory('0x0', 0, 1)).resolves.toBeNull();
		await expect(controller.writeMemory('0x0', 0, Uint8Array.of(1))).resolves.toBeNull();
		await expect(controller.dataBreakpointInfo({ name: '0x0' })).resolves.toBeNull();
		await expect(controller.setDataBreakpoints([])).resolves.toEqual([]);
		expect(debugReadMemory).not.toHaveBeenCalled();
		expect(debugWriteMemory).not.toHaveBeenCalled();
		expect(debugDataBreakpointInfo).not.toHaveBeenCalled();
		expect(debugSetDataBreakpoints).not.toHaveBeenCalled();

		controller.handleEvent({ type: 'resume', command: 'continue' });
		expect(controller.capabilities).toEqual({
			readMemory: false,
			writeMemory: false,
			dataBreakpoints: false
		});
	});

	it('keeps breakpoints and resolved locations isolated by source path', () => {
		const setBreakpoints = vi.fn(async () => undefined);
		const controller = createDebugSessionController({
			terminal: { setBreakpoints } as never,
			sourcePath: '/workspace/main.cpp',
			sourceBreakpoints: [
				{ sourcePath: '/workspace/main.cpp', lines: [4] },
				{ sourcePath: '/workspace/lib.cpp', lines: [9] }
			],
			syncBreakpointsWhile: true
		});

		expect(controller.breakpoints).toEqual([4]);
		controller.setSourcePath('/workspace/lib.cpp');
		expect(controller.breakpoints).toEqual([9]);

		controller.setBreakpoints([9, 12]);
		expect(controller.sourceBreakpoints).toEqual([
			{ sourcePath: '/workspace/main.cpp', lines: [4] },
			{ sourcePath: '/workspace/lib.cpp', lines: [9, 12] }
		]);

		controller.handleEvent({
			type: 'breakpoints',
			sourcePath: '/workspace/main.cpp',
			breakpoints: [{ requestedLine: 4, line: 5, verified: true }]
		});
		expect(controller.resolvedBreakpoints).toEqual([]);

		controller.setSourcePath('/workspace/main.cpp');
		expect(controller.resolvedBreakpoints).toEqual([
			{ requestedLine: 4, line: 5, verified: true }
		]);
		expect(setBreakpoints).toHaveBeenLastCalledWith([4], '/workspace/main.cpp');
	});

	it('keeps a paused session controllable while hiding stale source locations', () => {
		const controller = createDebugSessionController({
			sourcePath: '/workspace/main.cpp'
		});

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 7,
			reason: 'breakpoint',
			sourcePath: '/workspace/main.cpp',
			sourceContentSha256: 'compiled-source-sha',
			locals: [],
			callStack: [
				{
					functionName: 'main',
					line: 7,
					sourcePath: '/workspace/main.cpp',
					sourceContentSha256: 'compiled-source-sha'
				}
			]
		});
		expect(controller.pausedLine).toBe(7);
		expect(controller.sourceRevisionStale).toBe(false);

		controller.markSourceRevisionStale('/workspace/main.cpp');

		expect(controller.paused).toBe(true);
		expect(controller.pausedLine).toBe(null);
		expect(controller.sourceRevisionStale).toBe(true);

		controller.handleEvent({ type: 'resume', command: 'continue' });
		expect(controller.sourceRevisionStale).toBe(false);
	});

	it('isolates stale locations while selecting frames across source tabs', async () => {
		const controller = createDebugSessionController({
			sourcePath: '/workspace/helper.h',
			terminal: {
				debugScopes: vi.fn(async () => [])
			} as never
		});

		controller.begin();
		controller.handleEvent({
			type: 'pause',
			line: 3,
			reason: 'breakpoint',
			sourcePath: '/workspace/helper.h',
			locals: [],
			callStack: [
				{
					id: 1,
					functionName: 'add_three',
					line: 3,
					sourcePath: '/workspace/helper.h'
				},
				{
					id: 2,
					functionName: 'main',
					line: 5,
					sourcePath: '/workspace/main.c'
				}
			]
		});
		controller.markSourceRevisionStale('/workspace/main.c');

		await expect(controller.selectFrame(2)).resolves.toBe(true);
		controller.setSourcePath('/workspace/main.c');
		expect(controller.sourceRevisionStale).toBe(true);
		expect(controller.pausedLine).toBe(null);

		await expect(controller.selectFrame(1)).resolves.toBe(true);
		controller.setSourcePath('/workspace/helper.h');
		expect(controller.sourceRevisionStale).toBe(false);
		expect(controller.pausedLine).toBe(3);
	});
});
