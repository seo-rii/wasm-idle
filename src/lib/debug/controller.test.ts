import { describe, expect, it, vi } from 'vitest';

import { createDebugSessionController } from './controller.svelte';

describe('createDebugSessionController', () => {
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
});
