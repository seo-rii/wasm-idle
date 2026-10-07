import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
let suppressAutoLoadAck = false;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			if (suppressAutoLoadAck) return;
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		if (message.prepare) {
			queueMicrotask(() =>
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'result\nfactorial_plus_bonus=27\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/postgresql?worker', () => ({
	default: MockWorker
}));

import PostgreSQL from './postgresql';

describe('PostgreSQL sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		suppressAutoLoadAck = false;
	});

	it('loads the PostgreSQL worker and forwards run output', async () => {
		const sandbox = new PostgreSQL();
		const outputs: string[] = [];
		const code = 'select 27 as factorial_plus_bonus;';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'main.sql',
				stdin: '5\n',
				workspaceFiles: [{ path: 'data.csv', content: 'n\n5\n' }]
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-postgresql\/runtime\.mjs$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.sql',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				activePath: 'main.sql',
				stdin: '5\n',
				workspaceFiles: [{ path: 'data.csv', content: 'n\n5\n' }],
				log: true
			})
		);
		expect(outputs).toContain('result\nfactorial_plus_bonus=27\n');
	});

	it('rejects load when the PostgreSQL worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new PostgreSQL();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/postgresql.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'PostgreSQL worker script error: worker script error (/worker/postgresql.js:8:2)'
		);
	});
});
