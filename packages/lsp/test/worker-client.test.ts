import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../src/worker-client.js';

afterEach(() => {
	vi.useRealTimers();
});

describe('createLanguageServerProgressReporter', () => {
	it('reports stage-aware fallback progress for non-numeric updates', () => {
		const statuses: LanguageServerStatus[] = [];
		const reporter = createLanguageServerProgressReporter((status) => {
			statuses.push(status);
		});

		reporter.loading();
		reporter.progress({ stage: 'load-pyodide' });
		reporter.progress({ stage: 'load-jedi' });
		reporter.ready();

		expect(statuses).toEqual([
			{ state: 'loading', stage: 'startup', loaded: 0, total: 1 },
			{ state: 'loading', stage: 'load-pyodide', loaded: 0.35, total: 1 },
			{ state: 'loading', stage: 'load-jedi', loaded: 0.72, total: 1 },
			{ state: 'ready' }
		]);
	});

	it('keeps explicit progress payloads and uses them as the monotonic baseline', () => {
		const statuses: LanguageServerStatus[] = [];
		const reporter = createLanguageServerProgressReporter((status) => {
			statuses.push(status);
		});

		reporter.loading();
		reporter.progress({ stage: 'download-clangd', loaded: 3, total: 6 });
		reporter.progress({ stage: 'load-clangd' });

		expect(statuses).toEqual([
			{ state: 'loading', stage: 'startup', loaded: 0, total: 1 },
			{ state: 'loading', stage: 'download-clangd', loaded: 3, total: 6 },
			{ state: 'loading', stage: 'load-clangd', loaded: 0.5, total: 1 }
		]);
	});
});

describe('createWorkerLanguageServerClient', () => {
	it('terminates a worker that does not finish startup before the deadline', async () => {
		vi.useFakeTimers();
		const worker = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			postMessage: vi.fn(),
			terminate: vi.fn()
		} as unknown as Worker;
		const statuses: LanguageServerStatus[] = [];
		const startup = createWorkerLanguageServerClient({
			createWorker: () => worker,
			onStatus: (status) => statuses.push(status),
			lifecycle: { startupTimeoutMs: 25 }
		});
		const rejection = expect(startup).rejects.toThrow(
			'Language server startup timed out after 25 ms'
		);

		await vi.advanceTimersByTimeAsync(25);
		await rejection;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(statuses.at(-1)).toEqual({
			state: 'error',
			message: 'Language server startup timed out after 25 ms'
		});
	});

	it('does not create a worker when startup is already cancelled', async () => {
		const controller = new AbortController();
		const createWorker = vi.fn();
		controller.abort(new Error('startup cancelled'));

		await expect(
			createWorkerLanguageServerClient({
				createWorker,
				lifecycle: { signal: controller.signal }
			})
		).rejects.toThrow('startup cancelled');
		expect(createWorker).not.toHaveBeenCalled();
	});
});
