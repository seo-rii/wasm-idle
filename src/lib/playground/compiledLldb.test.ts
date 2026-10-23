import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxExecutionOptions } from './options';
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
		}
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
});
