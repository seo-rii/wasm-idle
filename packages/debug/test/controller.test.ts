import { describe, expect, it, vi } from 'vitest';

import { createDebugSessionController } from '../src/controller.js';

describe('createDebugSessionController', () => {
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
		const controller = createDebugSessionController({
			terminal: {
				debugCommand: vi.fn(async () => undefined),
				debugVariables
			}
		});

		controller.handleEvent({
			type: 'pause',
			line: 7,
			reason: 'breakpoint',
			stoppedReason: 'breakpoint',
			threadId: 3,
			frameId: 11,
			locals: [{ name: 'point', value: '{...}', variablesReference: 42 }],
			callStack: [{ id: 11, functionName: 'main', line: 7 }],
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
});
