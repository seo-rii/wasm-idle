import type { DebugSessionEvent } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

import { createDebugSessionController, type DebugTerminalControl } from '../src/controller.js';

describe('debugger diagnostics', () => {
	it('retains pause state and logpoint metadata when output arrives', () => {
		const controller = createDebugSessionController({ sourcePath: '/workspace/main.cpp' });
		controller.begin();
		controller.handleEvent({
			type: 'pause',
			stopId: 1,
			line: 7,
			reason: 'breakpoint',
			threadId: 1,
			frameId: 11,
			locals: [{ name: 'counter', value: '3' }],
			callStack: [{ id: 11, functionName: 'main', line: 7 }]
		});
		const locals = controller.locals;
		const callStack = controller.callStack;
		const history = controller.history;
		const logpoint: Extract<DebugSessionEvent, { type: 'output' }> = {
			type: 'output',
			category: 'console',
			output: 'counter = 3\n',
			sourcePath: '/workspace/main.cpp',
			line: 7
		};
		controller.handleEvent(logpoint);
		controller.handleEvent({
			type: 'output',
			category: 'important',
			output: 'Connection warning\n'
		});

		expect(controller.active).toBe(true);
		expect(controller.paused).toBe(true);
		expect(controller.pausedLine).toBe(7);
		expect(controller.frameId).toBe(11);
		expect(controller.threadId).toBe(1);
		expect(controller.stoppedReason).toBe('breakpoint');
		expect(controller.locals).toBe(locals);
		expect(controller.callStack).toBe(callStack);
		expect(controller.history).toBe(history);
		expect(controller.diagnostics[0]).toEqual(logpoint);
		expect(controller.latestImportantDiagnostic?.output).toBe('Connection warning\n');
		logpoint.output = 'changed by the sender';
		expect(controller.diagnostics[0].output).toBe('counter = 3\n');
	});

	it('does not activate an idle session or stop a running one for diagnostic output', () => {
		const controller = createDebugSessionController();
		controller.handleEvent({
			type: 'output',
			category: 'important',
			output: 'Attach failed\n'
		});
		expect(controller.active).toBe(false);
		expect(controller.paused).toBe(false);
		expect(controller.latestImportantDiagnostic?.output).toBe('Attach failed\n');
		controller.begin();
		controller.handleEvent({ type: 'output', category: 'console', output: 'Attached\n' });
		expect(controller.active).toBe(true);
		expect(controller.paused).toBe(false);
	});

	it('retains diagnostics after stop and reset, then clears them for the next run', async () => {
		const stop = vi.fn(async () => {});
		const controller = createDebugSessionController({
			terminal: { stop } as DebugTerminalControl
		});
		controller.begin();
		controller.handleEvent({
			type: 'output',
			category: 'important',
			output: 'Runtime stopped\n'
		});
		controller.handleEvent({ type: 'stop' });
		expect(controller.diagnostics).toHaveLength(1);
		await controller.stop();
		expect(stop).toHaveBeenCalledOnce();
		expect(controller.latestImportantDiagnostic?.output).toBe('Runtime stopped\n');
		controller.reset();
		expect(controller.diagnostics).toHaveLength(1);
		controller.begin();
		expect(controller.diagnostics).toEqual([]);
		expect(controller.latestImportantDiagnostic).toBeNull();
		controller.handleEvent({ type: 'output', category: 'console', output: 'Next run\n' });
		controller.clearDiagnostics();
		expect(controller.diagnostics).toEqual([]);
		expect(controller.active).toBe(true);
	});

	it('retains only the latest 200 nonempty output chunks', () => {
		const controller = createDebugSessionController();
		for (let index = 0; index < 205; index += 1) {
			controller.handleEvent({ type: 'output', category: 'console', output: `${index}\n` });
		}
		controller.handleEvent({ type: 'output', category: 'important', output: '' });
		expect(controller.diagnostics).toHaveLength(200);
		expect(controller.diagnostics[0].output).toBe('5\n');
		expect(controller.diagnostics.at(-1)?.output).toBe('204\n');
		expect(controller.latestImportantDiagnostic).toBeNull();
	});

	it('bounds total text and source metadata and retains the end of oversized chunks', () => {
		const controller = createDebugSessionController();
		for (let index = 0; index < 70; index += 1) {
			controller.handleEvent({
				type: 'output',
				category: 'console',
				output: 'a'.repeat(1_024)
			});
		}
		expect(controller.diagnostics).toHaveLength(64);
		expect(
			controller.diagnostics.reduce((total, entry) => total + entry.output.length, 0)
		).toBe(65_536);
		controller.handleEvent({
			type: 'output',
			category: 'important',
			output: `${'b'.repeat(70_000)}last message`,
			sourcePath: 'x'.repeat(8_000)
		});
		expect(controller.diagnostics).toHaveLength(1);
		expect(controller.diagnostics[0].output).toHaveLength(65_536);
		expect(controller.diagnostics[0].output.endsWith('last message')).toBe(true);
		expect(controller.diagnostics[0].sourcePath).toHaveLength(4_096);
		expect(controller.latestImportantDiagnostic).toBe(controller.diagnostics[0]);
	});

	it('does not retain a partial Unicode character when truncating output', () => {
		const controller = createDebugSessionController();
		controller.handleEvent({
			type: 'output',
			category: 'console',
			output: `😀${'a'.repeat(65_535)}`
		});
		expect(controller.diagnostics[0].output).toBe('a'.repeat(65_535));
	});
});
