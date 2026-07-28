import {
	DEFAULT_EXECUTION_LIMITS,
	createPlaygroundBinding,
	type ExecutionResult,
	type Sandbox
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

function createSandbox(overrides: Partial<Sandbox> = {}): Sandbox {
	return {
		constructor: Object,
		eof: vi.fn(),
		load: vi.fn(async () => undefined),
		run: vi.fn(async () => true),
		terminate: vi.fn(),
		clear: vi.fn(async () => undefined),
		...overrides
	};
}

const completedResult: ExecutionResult = {
	ok: true,
	exitCode: 0,
	stdout: '',
	stderr: '',
	diagnostics: [],
	artifacts: [],
	timings: { assetMs: 0, startupMs: 0, compileMs: 0, executeMs: 0, totalMs: 0 },
	terminationReason: 'completed',
	runtime: {
		languageId: 'C',
		implementationId: 'clang',
		version: '22.1.8',
		protocolVersion: 1
	}
};

describe('core execution boundary', () => {
	it('resolves execution limits and applies their workspace ceiling to legacy runs', async () => {
		const run = vi.fn(async () => true);
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ run }));
		const sandbox = await binding.load('C');

		await sandbox.run('int main() {}', false, false, undefined, [], {
			limits: { runTimeoutMs: 1234, maxWorkspaceBytes: 1024 },
			workspaceLimits: { maxTotalBytes: 4096 }
		});

		expect(run).toHaveBeenCalledWith(
			'int main() {}',
			false,
			false,
			undefined,
			[],
			expect.objectContaining({
				limits: {
					...DEFAULT_EXECUTION_LIMITS,
					runTimeoutMs: 1234,
					maxWorkspaceBytes: 1024
				},
				workspaceLimits: expect.objectContaining({ maxTotalBytes: 1024 })
			})
		);
	});

	it('rejects a pre-aborted operation before invoking a sandbox', async () => {
		const run = vi.fn(async () => true);
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ run }));
		const sandbox = await binding.load('C');
		const controller = new AbortController();
		controller.abort('user cancelled');

		await expect(
			sandbox.run('int main() {}', false, false, undefined, [], {
				signal: controller.signal
			})
		).rejects.toMatchObject({ code: 'cancelled', phase: 'execute' });
		expect(run).not.toHaveBeenCalled();
	});

	it('normalizes structured requests before forwarding execute', async () => {
		const execute = vi.fn(async () => completedResult);
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ execute }));
		const sandbox = await binding.load('C');

		await expect(
			sandbox.execute?.({
				code: 'int helper();',
				activePath: 'src\\main.c',
				workspaceFiles: [{ path: 'src\\helper.c', content: 'int helper() { return 1; }' }],
				limits: { compileTimeoutMs: 4321 }
			})
		).resolves.toBe(completedResult);
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				activePath: 'src/main.c',
				workspaceFiles: [{ path: 'src/helper.c', content: 'int helper() { return 1; }' }],
				limits: { ...DEFAULT_EXECUTION_LIMITS, compileTimeoutMs: 4321 }
			})
		);
	});
});
