import { describe, expect, it, vi } from 'vitest';
import type { DebugScope, DebugVariable } from '@wasm-idle/core';
import { createDebugSessionController, type DebugTerminalControl } from '../src/controller.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

const scopes: DebugScope[] = [
	{ name: 'Locals', variablesReference: 10, expensive: false, variables: [] },
	{ name: 'Arguments', variablesReference: 20, expensive: false, variables: [] }
];

function fixture(terminal: DebugTerminalControl, structured = true) {
	const controller = createDebugSessionController({ sourcePath: '/workspace/main.c', terminal });
	const pause = (nextScopes: DebugScope[] = []) =>
		controller.handleEvent({
			type: 'pause',
			reason: 'step',
			line: 3,
			frameId: 1,
			sessionId: 'session',
			sourcePath: '/workspace/main.c',
			locals: [],
			scopes: nextScopes,
			callStack: [
				{ id: 1, functionName: 'main', line: 3 },
				{ id: 2, functionName: 'caller', line: 8 }
			],
			capabilities: {
				readMemory: false,
				writeMemory: true,
				dataBreakpoints: false,
				evaluateValues: structured,
				evaluateForHovers: structured
			}
		});
	return { controller, pause };
}

async function ready(controller: ReturnType<typeof createDebugSessionController>) {
	await vi.waitFor(() =>
		expect(controller.watchValues.every((watch) => watch.value !== '...')).toBe(true)
	);
}

describe('watch evaluation across scope hydration', () => {
	it.each([true, false])(
		'evaluates each watch once while two scopes arrive (structured=%s)',
		async (structured) => {
			const locals = deferred<DebugVariable[]>();
			const arguments_ = deferred<DebugVariable[]>();
			const evaluate = vi.fn(async (expression: string) => expression);
			const { controller, pause } = fixture(
				{
					debugVariables: (reference) =>
						reference === 10 ? locals.promise : arguments_.promise,
					...(structured
						? {
								debugEvaluateValue: async (expression: string) => ({
									result: await evaluate(expression),
									variablesReference: 0
								})
							}
						: { debugEvaluate: evaluate })
				},
				structured
			);
			controller.addWatchExpression('first');
			controller.addWatchExpression('second');
			pause(scopes);
			await ready(controller);
			expect(evaluate).toHaveBeenCalledTimes(2);
			locals.resolve([{ name: 'local', value: '1' }]);
			await vi.waitFor(() => expect(controller.variablesByReference.has(10)).toBe(true));
			await ready(controller);
			arguments_.resolve([{ name: 'arg', value: '2' }]);
			await vi.waitFor(() => expect(controller.variablesByReference.has(20)).toBe(true));
			await ready(controller);
			expect(evaluate.mock.calls.map(([expression]) => expression)).toEqual([
				'first',
				'second'
			]);
		}
	);

	it('still resolves variable-path fallback when a scope arrives after unavailable evaluation', async () => {
		const variables = deferred<DebugVariable[]>();
		const evaluate = vi.fn(async () => '?');
		const { controller, pause } = fixture(
			{ debugEvaluate: evaluate, debugVariables: () => variables.promise },
			false
		);
		controller.addWatchExpression('answer');
		pause(scopes.slice(0, 1));
		variables.resolve([{ name: 'answer', value: '42' }]);
		await vi.waitFor(() => expect(controller.watchValues[0]?.value).toBe('42'));
		expect(evaluate).toHaveBeenCalledOnce();
	});

	it('reevaluates existing expressions when watches are added or removed', async () => {
		const evaluate = vi.fn(async (expression: string) => expression);
		const { controller, pause } = fixture({ debugEvaluate: evaluate }, false);
		controller.addWatchExpression('first');
		pause();
		await ready(controller);
		controller.addWatchExpression('second');
		await ready(controller);
		controller.removeWatchExpression('second');
		await ready(controller);
		expect(evaluate.mock.calls.map(([expression]) => expression)).toEqual([
			'first',
			'first',
			'second',
			'first'
		]);
		expect(controller.watchValues).toEqual([{ expression: 'first', value: 'first' }]);
	});

	it('reevaluates after a successful memory write', async () => {
		let value = '1';
		const evaluate = vi.fn(async () => value);
		const { controller, pause } = fixture(
			{
				debugEvaluate: evaluate,
				debugWriteMemory: async () => {
					value = '2';
					return { bytesWritten: 1 };
				}
			},
			false
		);
		controller.addWatchExpression('answer');
		pause();
		await ready(controller);
		expect(controller.watchValues[0].value).toBe('1');
		await controller.writeMemory('0x10', 0, new Uint8Array([2]));
		await ready(controller);
		expect(controller.watchValues[0].value).toBe('2');
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it('does not reuse an evaluation still pending from an earlier stop', async () => {
		const old = deferred<string>();
		const evaluate = vi
			.fn()
			.mockImplementationOnce(() => old.promise)
			.mockResolvedValue('new');
		const { controller, pause } = fixture({ debugEvaluate: evaluate }, false);
		controller.addWatchExpression('answer');
		pause();
		expect(evaluate).toHaveBeenCalledOnce();
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause();
		await ready(controller);
		old.resolve('old');
		await old.promise;
		await ready(controller);
		expect(controller.watchValues[0].value).toBe('new');
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it('invalidates evaluation on frame selection and keeps hover context independent', async () => {
		const evaluate = vi.fn(
			async (_expression: string, options?: { frameId?: number; context?: string }) => ({
				result: `${options?.context}:${options?.frameId}`,
				variablesReference: 0
			})
		);
		const { controller, pause } = fixture({
			debugEvaluateValue: evaluate,
			debugScopes: async () => []
		});
		controller.addWatchExpression('answer');
		pause();
		await ready(controller);
		expect(controller.watchValues[0].value).toBe('watch:1');
		expect((await controller.resolveHover('answer'))?.value).toBe('hover:1');
		await controller.selectFrame(2);
		await ready(controller);
		expect(controller.watchValues[0].value).toBe('watch:2');
		expect(evaluate).toHaveBeenCalledTimes(3);
	});

	it('does not invalidate a newer stop when an earlier memory write completes', async () => {
		const write = deferred<{ bytesWritten: number }>();
		const evaluate = vi.fn(async () => 'current');
		const { controller, pause } = fixture(
			{ debugEvaluate: evaluate, debugWriteMemory: () => write.promise },
			false
		);
		controller.addWatchExpression('answer');
		pause();
		await ready(controller);
		const pendingWrite = controller.writeMemory('0x10', 0, new Uint8Array([2]));
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause();
		await ready(controller);
		write.resolve({ bytesWritten: 1 });
		await pendingWrite;
		expect(evaluate).toHaveBeenCalledTimes(2);
	});
});
