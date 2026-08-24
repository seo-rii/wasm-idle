import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRubyRuntimeTestPreflightPayload } from './rubyTestPreflight';

const preflightMocks = vi.hoisted(() => ({
	preflightVerifiedRubyRuntimeAssets: vi.fn()
}));

vi.mock('$lib/playground/rubyAssets', async (importOriginal) => ({
	...(await importOriginal<typeof import('./rubyAssets')>()),
	preflightVerifiedRubyRuntimeAssets: preflightMocks.preflightVerifiedRubyRuntimeAssets
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		queueMicrotask(() => {
			if (message.load) {
				this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
				return;
			}
			this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/ruby?worker', () => ({
	default: MockWorker
}));

import type { SandboxExecutionOptions } from './options';
import Ruby from './ruby';

describe('Ruby workspace boundary', () => {
	beforeEach(() => {
		preflightMocks.preflightVerifiedRubyRuntimeAssets
			.mockReset()
			.mockImplementation(async () => createRubyRuntimeTestPreflightPayload());
		workerInstances.length = 0;
	});

	it('canonicalizes files and removes the auxiliary copy of the active source', async () => {
		const sandbox = new Ruby();
		const code = 'require_relative "helper"';
		await sandbox.load('/assets');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\main.rb',
				workspaceFiles: [
					{
						path: 'src\\helper.rb',
						content: 'VALUE = 42'
					},
					{
						path: 'src\\main.rb',
						content: 'raise "stale active source"'
					}
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				activePath: 'src/main.rb',
				workspaceFiles: [{ path: 'src/helper.rb', content: 'VALUE = 42' }]
			})
		);
	});

	it.each([
		{
			name: 'active path traversal',
			code: 'puts 1',
			options: { activePath: '../main.rb' },
			expected: { code: 'invalid-path', path: '../main.rb' }
		},
		{
			name: 'workspace path traversal',
			code: 'puts 1',
			options: { workspaceFiles: [{ path: 'src/../secret.rb', content: 'puts 2' }] },
			expected: { code: 'invalid-path', path: 'src/../secret.rb' }
		},
		{
			name: 'absolute path',
			code: 'puts 1',
			options: { activePath: '/tmp/main.rb' },
			expected: { code: 'invalid-path', path: '/tmp/main.rb' }
		},
		{
			name: 'NUL path',
			code: 'puts 1',
			options: { workspaceFiles: [{ path: 'src/bad\0.rb', content: 'puts 2' }] },
			expected: { code: 'invalid-path', path: 'src/bad\0.rb' }
		},
		{
			name: 'duplicate path',
			code: 'puts 1',
			options: {
				workspaceFiles: [
					{ path: 'src/helper.rb', content: 'puts 2' },
					{ path: 'src/helper.rb', content: 'puts 3' }
				]
			},
			expected: { code: 'duplicate-path', path: 'src/helper.rb' }
		},
		{
			name: 'case-colliding path',
			code: 'puts 1',
			options: {
				workspaceFiles: [
					{ path: 'SRC/helper.rb', content: 'puts 2' },
					{ path: 'src/helper.rb', content: 'puts 3' }
				]
			},
			expected: { code: 'case-collision', path: 'src/helper.rb' }
		},
		{
			name: 'file count overflow',
			code: 'puts 1',
			options: {
				workspaceFiles: [{ path: 'src/helper.rb', content: 'puts 2' }],
				workspaceLimits: { maxFiles: 1 }
			},
			expected: { code: 'file-count-limit', limit: 1, actual: 2 }
		},
		{
			name: 'per-file overflow clamped to execution limits',
			code: '12345',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceLimits: { maxFileBytes: 100 }
			},
			expected: { code: 'file-size-limit', limit: 4, actual: 5 }
		},
		{
			name: 'aggregate overflow clamped to execution limits',
			code: '123',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceFiles: [{ path: 'src/helper.rb', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a Ruby workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Ruby();
			await sandbox.load('/assets');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;
			const begin = sandbox.begin;
			sandbox.write('queued input\n');

			await expect(
				sandbox.run(code, false, true, undefined, [], options as SandboxExecutionOptions)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBe(loadHandler);
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(sandbox.uid).toBe(0);
			expect(sandbox.begin).toBe(begin);
			expect(sandbox.exit).toBe(true);
			expect(sandbox.pendingInput).toEqual(['queued input\n']);

			await expect(sandbox.run('puts 1', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ activePath: 'main.rb', workspaceFiles: [] })
			);
		}
	);
});
