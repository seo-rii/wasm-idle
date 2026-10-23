import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebugSessionController } from '../../../packages/debug/src/controller.js';
import type { SandboxExecutionOptions } from './options';
import ObjectiveC from './objectivec';

const { sessions } = vi.hoisted(() => ({ sessions: [] as any[] }));

vi.mock('$lib/playground/lldbSession', () => ({
	LldbSandboxSession: class {
		constructor(readonly options: any) {
			sessions.push(this);
		}
		start = vi.fn(async () => true as const);
		setSourceBreakpoints = vi.fn(async () => undefined);
	}
}));

class ObjectiveCDebugFixture extends ObjectiveC {
	prepare(options: SandboxExecutionOptions) {
		this.configureLldb({ rootUrl: '/runtime/' }, options);
		this.prepareLldb(options, 'main.m');
	}
	start() {
		return this.startLldb(
			{
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.m', content: 'int main() {}' }]
			},
			{},
			[],
			[],
			false
		);
	}
}

describe('Objective-C structured breakpoint routing', () => {
	beforeEach(() => {
		sessions.length = 0;
	});

	it.each(['OBJC', 'OBJECTIVECXX'] as const)(
		'updates live %s trace breakpoints and Run to Cursor through the controller',
		async (language) => {
			const sandbox = new ObjectiveC(language);
			const controller = createDebugSessionController({
				terminal: {
					setBreakpoints: async (lines, path) => sandbox.setBreakpoints(lines, path),
					setSourceBreakpoints: sandbox.setSourceBreakpoints.bind(sandbox),
					debugCommand: async (command) => sandbox.debugCommand(command),
					stop: async () => sandbox.terminate()
				},
				sourcePath: '/workspace/main.m'
			});
			try {
				controller.handleEvent({
					type: 'pause',
					reason: 'step',
					line: 3,
					sourcePath: '/workspace/main.m',
					locals: [],
					callStack: [{ functionName: 'main', line: 3 }]
				});
				controller.setBreakpoints([7]);
				const control = new Int32Array(sandbox.debugBuffer);
				expect([Atomics.load(control, 3), Atomics.load(control, 4)]).toEqual([1, 7]);
				await controller.runToCursor(9);
				expect(controller.breakpointError).toBeNull();
				expect(Array.from(control.slice(3, 6))).toEqual([2, 7, 9]);
				expect(Atomics.load(control, 1)).toBe(1);
			} finally {
				controller.reset();
				sandbox.terminate();
			}
		}
	);

	it.each([{ condition: 'n > 1' }, { hitCondition: '2' }, { logMessage: 'n={n}' }])(
		'rejects unsupported trace metadata before changing the installed breakpoints: %j',
		async (metadata) => {
			const sandbox = new ObjectiveC();
			sandbox.setBreakpoints([3]);
			const control = new Int32Array(sandbox.debugBuffer);
			const previous = Array.from(control);
			await expect(sandbox.setSourceBreakpoints([{ line: 7, ...metadata }])).rejects.toThrow(
				'Debugger does not support breakpoint'
			);
			expect(Array.from(control)).toEqual(previous);
		}
	);

	it('omits disabled trace breakpoints and clears them with an empty replacement', async () => {
		const sandbox = new ObjectiveC();
		await sandbox.setSourceBreakpoints([
			{ line: 3, enabled: false, condition: 'n > 1' },
			{ line: 7 }
		]);
		const control = new Int32Array(sandbox.debugBuffer);
		expect(Array.from(control.slice(3, 6))).toEqual([1, 7, 0]);
		await sandbox.setSourceBreakpoints([]);
		expect(Array.from(control.slice(3, 6))).toEqual([0, 0, 0]);
	});

	it('preserves pending LLDB metadata and delegates live LLDB changes', async () => {
		const sandbox = new ObjectiveCDebugFixture();
		sandbox.prepare({ debugPath: 'main.m' });
		await sandbox.setSourceBreakpoints([
			{ line: 7, condition: 'n > 1' },
			{ line: 9, enabled: false }
		]);
		const run = sandbox.start();
		expect(sessions[0].options.sourceBreakpoints).toEqual([
			{
				sourcePath: '/workspace/main.m',
				lines: [7],
				breakpoints: [
					{ line: 7, condition: 'n > 1' },
					{ line: 9, enabled: false }
				]
			}
		]);
		await sandbox.setSourceBreakpoints([{ line: 10, hitCondition: '2' }], 'helper.m');
		expect(sessions[0].setSourceBreakpoints).toHaveBeenCalledWith(
			[{ line: 10, hitCondition: '2' }],
			'/workspace/helper.m'
		);
		await run;
		expect(Atomics.load(new Int32Array(sandbox.debugBuffer), 3)).toBe(0);
	});
});
