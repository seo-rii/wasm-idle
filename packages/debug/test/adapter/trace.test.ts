import type { DebugCommand, DebugSessionEvent } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

import {
	UnsupportedDebugOperationError,
	createTraceDebugAdapter,
	type DebugAdapterEvent
} from '../../src/adapter/index.js';

describe('TraceDebugAdapter', () => {
	it('reports trace limitations and maps launch, breakpoint, command, and stop calls', async () => {
		const debugCommand = vi.fn(async (_command: DebugCommand) => undefined);
		const setBreakpoints = vi.fn(async (_lines: number[]) => undefined);
		const stop = vi.fn(async () => undefined);
		const launch = vi.fn(async () => undefined);
		const adapter = createTraceDebugAdapter({
			control: { debugCommand, setBreakpoints, stop },
			launch,
			source: { name: 'main.cpp', path: '/workspace/main.cpp' }
		});

		await expect(adapter.initialize()).resolves.toMatchObject({
			supportsBreakpoints: true,
			supportsContinue: true,
			supportsPause: false,
			supportsStepIn: true,
			supportsStepOver: true,
			supportsStepOut: true,
			supportsEvaluate: false,
			supportsReadMemory: false,
			supportsConditionalBreakpoints: false
		});
		await adapter.launch({
			program: '/workspace/program.wasm',
			source: { name: 'main.cpp', path: '/workspace/main.cpp' }
		});
		await expect(
			adapter.setBreakpoints({ path: '/workspace/main.cpp', name: 'main.cpp' }, [3, 9])
		).resolves.toEqual([
			{
				verified: true,
				source: { path: '/workspace/main.cpp', name: 'main.cpp' },
				requestedLine: 3,
				line: 3
			},
			{
				verified: true,
				source: { path: '/workspace/main.cpp', name: 'main.cpp' },
				requestedLine: 9,
				line: 9
			}
		]);
		await adapter.continue(1);
		await adapter.next(1);
		await adapter.stepIn(1);
		await adapter.stepOut(1);
		await adapter.disconnect({ terminateTarget: true });

		expect(launch).toHaveBeenCalledWith({
			program: '/workspace/program.wasm',
			source: { name: 'main.cpp', path: '/workspace/main.cpp' }
		});
		expect(setBreakpoints).toHaveBeenCalledWith([3, 9]);
		expect(debugCommand.mock.calls.map(([command]) => command)).toEqual([
			'continue',
			'nextLine',
			'stepInto',
			'stepOut'
		]);
		expect(stop).toHaveBeenCalledOnce();
		await expect(adapter.threads()).resolves.toEqual([]);
		await expect(adapter.pause(1)).rejects.toBeInstanceOf(UnsupportedDebugOperationError);
		await expect(adapter.readMemory('memory', 0, 1)).rejects.toBeInstanceOf(
			UnsupportedDebugOperationError
		);
		await expect(
			adapter.dataBreakpointInfo({ name: 'counter', variablesReference: 1 })
		).rejects.toBeInstanceOf(UnsupportedDebugOperationError);
		await expect(adapter.setDataBreakpoints([])).rejects.toBeInstanceOf(
			UnsupportedDebugOperationError
		);
	});

	it('marks breakpoints in a second source as unverified without replacing trace breakpoints', async () => {
		const setBreakpoints = vi.fn(async (_lines: number[]) => undefined);
		const adapter = createTraceDebugAdapter({
			control: {
				debugCommand: vi.fn(async () => undefined),
				setBreakpoints,
				stop: vi.fn(async () => undefined)
			},
			launch: vi.fn(async () => undefined),
			source: { path: '/workspace/main.cpp' }
		});

		await expect(
			adapter.setBreakpoints({ path: '/workspace/helper.cpp' }, [4])
		).resolves.toEqual([
			{
				verified: false,
				source: { path: '/workspace/helper.cpp' },
				requestedLine: 4,
				line: 4,
				message: 'Trace debugging supports breakpoints in only one source file.'
			}
		]);
		expect(setBreakpoints).not.toHaveBeenCalled();
	});

	it('adapts flat pause state to thread, frame, scope, and lazy variable requests', async () => {
		const adapter = createTraceDebugAdapter({
			control: {
				debugCommand: vi.fn(async () => undefined),
				setBreakpoints: vi.fn(async () => undefined),
				debugEvaluate: vi.fn(async (expression: string) => `${expression} = 21`),
				stop: vi.fn(async () => undefined)
			},
			launch: vi.fn(async () => undefined),
			source: { path: '/workspace/main.cpp' }
		});
		const events: DebugAdapterEvent[] = [];
		adapter.onEvent((event) => events.push(event));

		adapter.handleEvent({
			type: 'pause',
			line: 8,
			reason: 'breakpoint',
			locals: [
				{ name: 'sum', value: '21' },
				{ name: 'point', value: '{x = 1, y = 2}' }
			],
			callStack: [
				{ functionName: 'solve', line: 8 },
				{ functionName: 'main', line: 14 }
			]
		});

		await expect(adapter.threads()).resolves.toEqual([{ id: 1, name: 'Main Thread' }]);
		const frames = await adapter.stackTrace(1);
		expect(frames).toEqual([
			{
				id: expect.any(Number),
				name: 'solve',
				source: { path: '/workspace/main.cpp' },
				line: 8,
				column: 1
			},
			{
				id: expect.any(Number),
				name: 'main',
				source: { path: '/workspace/main.cpp' },
				line: 14,
				column: 1
			}
		]);

		const scopes = await adapter.scopes(frames[0]!.id);
		expect(scopes).toEqual([
			{
				name: 'Locals',
				presentationHint: 'locals',
				variablesReference: expect.any(Number),
				namedVariables: 2,
				expensive: false
			}
		]);
		await expect(adapter.scopes(frames[1]!.id)).resolves.toEqual([]);
		await expect(adapter.variables(scopes[0]!.variablesReference, 1, 1)).resolves.toEqual([
			{
				name: 'point',
				value: '{x = 1, y = 2}',
				variablesReference: 0
			}
		]);
		await expect(adapter.evaluate('sum', frames[0]!.id)).resolves.toEqual({
			result: 'sum = 21',
			variablesReference: 0
		});
		expect(events).toEqual([
			{
				type: 'stopped',
				reason: 'breakpoint',
				threadId: 1,
				allThreadsStopped: true
			}
		]);

		adapter.handleEvent({ type: 'resume', command: 'continue' });
		await expect(adapter.stackTrace(1)).resolves.toEqual([]);
		expect(events.at(-1)).toEqual({
			type: 'continued',
			threadId: 1,
			allThreadsContinued: true
		});

		adapter.handleEvent({ type: 'stop' });
		await expect(adapter.threads()).resolves.toEqual([]);
		expect(events.at(-1)).toEqual({ type: 'terminated' });
	});

	it('accepts an injected trace event subscription', () => {
		let sendEvent: ((event: DebugSessionEvent) => void) | undefined;
		const adapter = createTraceDebugAdapter({
			control: {
				debugCommand: vi.fn(async () => undefined),
				setBreakpoints: vi.fn(async () => undefined),
				stop: vi.fn(async () => undefined)
			},
			launch: vi.fn(async () => undefined),
			subscribe(listener) {
				sendEvent = listener;
			}
		});
		const events: DebugAdapterEvent[] = [];
		adapter.onEvent((event) => events.push(event));

		sendEvent?.({
			type: 'pause',
			line: 2,
			reason: 'entry',
			locals: [],
			callStack: []
		});

		expect(events).toEqual([
			{
				type: 'stopped',
				reason: 'entry',
				threadId: 1,
				allThreadsStopped: true
			}
		]);
	});
});
