import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugSessionEvent, SandboxExecutionOptions } from './options';
import type { LldbSandboxSessionOptions } from './lldbSession';

const { sessions } = vi.hoisted(() => ({ sessions: [] as any[] }));

vi.mock('$lib/playground/lldbSession', () => ({
	LldbSandboxSession: class {
		private resolveStart?: (value: true) => void;
		constructor(readonly options: LldbSandboxSessionOptions) {
			sessions.push(this);
		}
		start() {
			return new Promise<true>((resolve) => {
				this.resolveStart = resolve;
			});
		}
		finish() {
			this.resolveStart?.(true);
			try {
				this.options.onDebugEvent({ type: 'stop' });
			} catch {
				// LLDB teardown also isolates consumer stop callbacks.
			}
		}
		disconnect = vi.fn(async () => this.finish());
		debugCommand = vi.fn();
		setBreakpoints = vi.fn(async () => undefined);
		setSourceBreakpoints = vi.fn(async () => undefined);
		setSteppingOptions = vi.fn(async () => undefined);
		evaluateValue = vi.fn(async () => ({ result: '42', variablesReference: 9, type: 'int' }));
	}
}));

import { CompiledLldbSandbox } from './compiledLldb';

class Fixture extends CompiledLldbSandbox {
	prepare(options: SandboxExecutionOptions) {
		this.configureLldb({ rootUrl: '/absproxy/5173' }, options);
		this.prepareLldb(options, 'main.c');
	}
	start(options: SandboxExecutionOptions) {
		return this.startLldb(
			{
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.c', content: 'int main() {}' }]
			},
			options,
			[],
			[],
			false
		);
	}
	stop() {
		return this.stopLldb();
	}
}

describe('compiled LLDB wrapper', () => {
	beforeEach(() => {
		sessions.length = 0;
	});

	it.each([false, true])(
		'preserves structured launch breakpoints across paths (edited=%s)',
		async (edited) => {
			const sandbox = new Fixture();
			const breakpoints = [
				{ line: 3, condition: 'n > 1', hitCondition: '2', logMessage: 'n={n}' },
				{ line: 4, enabled: false }
			];
			const options: SandboxExecutionOptions = {
				debugPath: 'src/main.c',
				breakpoints: [3, 4],
				sourceBreakpoints: [
					{ sourcePath: 'src/main.c', lines: [3, 4], breakpoints },
					{
						sourcePath: '/workspace/helper.c',
						lines: [5],
						breakpoints: [{ line: 5, condition: 'ready' }]
					}
				],
				debugSteppingOptions: { skipLibraryCode: true }
			};
			sandbox.prepare(options);
			if (edited) await sandbox.setBreakpoints([3, 6], '/workspace/src/main.c');
			breakpoints[0].condition = 'mutated';
			const run = sandbox.start(options);
			const session = sessions[0];
			expect(session.options.sourceBreakpoints).toEqual([
				{
					sourcePath: '/workspace/src/main.c',
					lines: edited ? [3, 6] : [3],
					breakpoints: [
						{
							line: 3,
							condition: 'n > 1',
							hitCondition: '2',
							logMessage: 'n={n}',
							...(edited ? { enabled: true } : {})
						},
						edited ? { line: 6 } : { line: 4, enabled: false }
					]
				},
				{
					sourcePath: '/workspace/helper.c',
					lines: [5],
					breakpoints: [{ line: 5, condition: 'ready' }]
				}
			]);
			expect(session.options.debugSteppingOptions).toEqual({ skipLibraryCode: true });
			session.finish();
			await run;
			sandbox.prepare({ breakpoints: [2] });
			const next = sandbox.start({});
			expect(sessions[1].options.sourceBreakpoints).toEqual([
				{ sourcePath: '/workspace/main.c', lines: [2] }
			]);
			sessions[1].finish();
			await next;
		}
	);

	it('forwards qualified live operations and preserves session rejections', async () => {
		const sandbox = new Fixture();
		sandbox.prepare({ debugPath: 'src/main.c' });
		const run = sandbox.start({});
		const session = sessions[0];
		await sandbox.setSourceBreakpoints([{ line: 7, condition: 'ready' }]);
		expect(session.setSourceBreakpoints).toHaveBeenCalledWith(
			[{ line: 7, condition: 'ready' }],
			'/workspace/src/main.c'
		);
		await sandbox.setBreakpoints([9], 'helper.c');
		expect(session.setBreakpoints).toHaveBeenCalledWith([9], '/workspace/helper.c');
		await sandbox.debugSetSteppingOptions({ skipLibraryCode: false });
		expect(session.setSteppingOptions).toHaveBeenCalledWith({ skipLibraryCode: false });
		await expect(
			sandbox.debugEvaluateValue('n', { frameId: 21, context: 'hover' })
		).resolves.toEqual({ result: '42', variablesReference: 9, type: 'int' });
		expect(session.evaluateValue).toHaveBeenCalledWith('n', { frameId: 21, context: 'hover' });
		session.setSourceBreakpoints.mockRejectedValueOnce(
			new Error('Conditional breakpoints unsupported')
		);
		await expect(
			sandbox.setSourceBreakpoints([{ line: 7, condition: 'ready' }])
		).rejects.toThrow('Conditional breakpoints unsupported');
		session.finish();
		await run;
		await expect(sandbox.debugSetSteppingOptions({ skipLibraryCode: true })).rejects.toThrow(
			'LLDB session'
		);
		await expect(sandbox.debugEvaluateValue('n')).rejects.toThrow('LLDB is not running');
	});

	it('publishes one stop immediately while explicit disconnect is still pending', async () => {
		const sandbox = new Fixture();
		const events: DebugSessionEvent[] = [];
		sandbox.ondebug = (event) => events.push(event);
		sandbox.prepare({});
		const run = sandbox.start({});
		const session = sessions[0];
		let finishDisposal!: () => void;
		session.disconnect.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishDisposal = () => {
						session.finish();
						resolve();
					};
				})
		);

		const stopping = sandbox.stop();
		expect(events).toEqual([{ type: 'stop' }]);
		expect(sandbox.stop()).toBeUndefined();
		expect(session.disconnect).toHaveBeenCalledOnce();
		session.options.onDebugEvent({ type: 'resume', command: 'continue' });
		session.options.onDebugEvent({ type: 'stop' });
		expect(events).toEqual([{ type: 'stop' }]);
		finishDisposal();
		await stopping;
		await run;
		expect(events).toEqual([{ type: 'stop' }]);
	});

	it('publishes a natural stop once and ignores completed session events', async () => {
		const sandbox = new Fixture();
		const events: DebugSessionEvent[] = [];
		sandbox.ondebug = (event) => events.push(event);
		sandbox.prepare({});
		const run = sandbox.start({});
		const session = sessions[0];
		session.finish();
		session.options.onDebugEvent({ type: 'stop' });
		session.options.onDebugEvent({ type: 'resume', command: 'continue' });
		await run;
		expect(sandbox.stop()).toBeUndefined();
		expect(session.disconnect).not.toHaveBeenCalled();
		expect(events).toEqual([{ type: 'stop' }]);
	});

	it('does not deliver an old session stop or clear its replacement during delayed disposal', async () => {
		const sandbox = new Fixture();
		const events: DebugSessionEvent[] = [];
		sandbox.ondebug = (event) => events.push(event);
		sandbox.prepare({});
		const firstRun = sandbox.start({});
		const firstSession = sessions[0];
		let finishDisposal!: () => void;
		firstSession.disconnect.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishDisposal = resolve;
				})
		);
		const stopping = sandbox.stop();
		sandbox.prepare({});
		const secondRun = sandbox.start({});
		const secondSession = sessions[1];
		firstSession.options.onDebugEvent({ type: 'resume', command: 'continue' });
		firstSession.finish();
		finishDisposal();
		await stopping;
		await firstRun;
		secondSession.options.onDebugEvent({ type: 'resume', command: 'continue' });
		sandbox.debugCommand('nextLine');
		expect(secondSession.debugCommand).toHaveBeenCalledWith('nextLine');
		expect(events).toEqual([{ type: 'stop' }, { type: 'resume', command: 'continue' }]);
		secondSession.finish();
		await secondRun;
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(2);
	});

	it('finishes disconnect when a stop listener reenters, starts a replacement, and throws', async () => {
		const sandbox = new Fixture();
		const events: DebugSessionEvent[] = [];
		let secondRun: Promise<true> | undefined;
		sandbox.ondebug = (event) => {
			events.push(event);
			if (event.type === 'stop' && !secondRun) {
				expect(sandbox.stop()).toBeUndefined();
				sandbox.prepare({});
				secondRun = sandbox.start({});
				throw new Error('stop listener failed');
			}
		};
		sandbox.prepare({});
		const firstRun = sandbox.start({});
		const firstSession = sessions[0];
		await expect(sandbox.stop()).resolves.toBeUndefined();
		await firstRun;
		expect(firstSession.disconnect).toHaveBeenCalledOnce();
		expect(secondRun).toBeDefined();
		const secondSession = sessions[1];
		firstSession.options.onDebugEvent({ type: 'stop' });
		sandbox.debugCommand('nextLine');
		expect(secondSession.debugCommand).toHaveBeenCalledWith('nextLine');
		expect(events).toEqual([{ type: 'stop' }]);
		secondSession.finish();
		await secondRun;
		expect(events).toEqual([{ type: 'stop' }, { type: 'stop' }]);
	});
});
