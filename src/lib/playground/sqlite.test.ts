import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
		publicEnv: {
			PUBLIC_WASM_SQLITE_MODULE_URL: '',
			PUBLIC_WASM_SQLITE_WASM_URL: ''
	}
}));
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

vi.mock('$lib/playground/worker/sqlite?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Sqlite from './sqlite';

describe('SQLite sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_SQLITE_WASM_URL = '/sqlite/sql-wasm.wasm';
		publicEnv.PUBLIC_WASM_SQLITE_MODULE_URL = '';
		suppressAutoLoadAck = false;
	});

	it('loads the SQLite worker and forwards run output', async () => {
		const sandbox = new Sqlite();
		const outputs: string[] = [];
		const code = 'select 1 as result;';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'main.sql'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
				expect.objectContaining({
					load: true,
					moduleUrl: expect.stringMatching(/\/wasm-sqlite\/runtime\.mjs$/),
					wasmUrl: expect.stringMatching(/\/sqlite\/sql-wasm\.wasm$/)
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
				log: true
			})
		);
		expect(outputs).toContain('result\nfactorial_plus_bonus=27\n');
	});

	it('rejects load when the SQLite worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Sqlite();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/sqlite.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'SQLite worker script error: worker script error (/worker/sqlite.js:8:2)'
		);
	});
});
