import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HY_WHEEL_RECEIPTS } from '../../../scripts/sync-wasm-hy.mjs';
import { WASM_HY_VERSION, WASM_HY_WHEELS } from './wasmHyVersion';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		queueMicrotask(() =>
			this.onmessage?.({
				data: message.load ? { load: true } : { output: 'main=hy\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/python?worker', () => ({ default: MockWorker }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import Hy from './hy';
import Python from './python';

describe('Hy sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('pins committed wheels by size and SHA-256 in the runtime and sync script', () => {
		expect(WASM_HY_WHEELS.map((wheel) => ({ ...wheel }))).toEqual(HY_WHEEL_RECEIPTS);
		expect(WASM_HY_WHEELS.map((wheel) => wheel.fileName)).toEqual([
			'funcparserlib-1.0.1-py2.py3-none-any.whl',
			`hy-${WASM_HY_VERSION}-py3-none-any.whl`
		]);
		for (const wheel of WASM_HY_WHEELS) {
			const bytes = readFileSync(path.join(repoRoot, 'static/wasm-hy', wheel.fileName));
			expect({
				bytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex')
			}).toEqual({ bytes: wheel.bytes, sha256: wheel.sha256 });
		}
	});

	it('loads the shared Pyodide worker with local Hy wheel receipts and runs Hy source', async () => {
		const sandbox = new Hy();
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({ rootUrl: 'https://idle.example.test/app' });
		const loadMessage = workerInstances[0].postMessage.mock.calls[0][0];
		expect(loadMessage).toMatchObject({
			load: true,
			assets: { baseUrl: 'https://idle.example.test/app/pyodide/' },
			extension: {
				language: 'hy',
				version: WASM_HY_VERSION,
				wheels: WASM_HY_WHEELS.map((wheel) => ({
					...wheel,
					url: `https://idle.example.test/app/wasm-hy/${wheel.fileName}`
				}))
			}
		});

		const code = '(print (+ "main=" (input)))';
		await expect(
			sandbox.run(code, false, true, undefined, [], { stdin: 'hy\n' })
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage.mock.calls[1][0]).toMatchObject({
			code,
			language: 'hy',
			stdin: 'hy\n',
			prepare: false
		});
		expect(outputs).toEqual(['main=hy\n']);
		await sandbox.dispose();
	});

	it('honors a configured Hy wheel base URL and recreates the worker when it changes', async () => {
		const sandbox = new Hy();
		await sandbox.load({ rootUrl: '/', hy: { baseUrl: 'https://cdn.example.test/hy' } });
		expect(workerInstances[0].postMessage.mock.calls[0][0].extension.wheels[0].url).toBe(
			`https://cdn.example.test/hy/${WASM_HY_WHEELS[0].fileName}`
		);
		await sandbox.load({ rootUrl: '/', hy: { baseUrl: 'https://cdn.example.test/hy' } });
		expect(workerInstances).toHaveLength(1);
		await sandbox.load({ rootUrl: '/', hy: { baseUrl: 'https://mirror.example.test/hy/' } });
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		await sandbox.dispose();
	});

	it('keeps plain Python worker messages free of Hy configuration', async () => {
		const sandbox = new Python();
		sandbox.output = () => {};
		await sandbox.load('/');
		expect(workerInstances[0].postMessage.mock.calls[0][0]).not.toHaveProperty('extension');
		await sandbox.run('print(1)', false);
		expect(workerInstances[0].postMessage.mock.calls[1][0]).toMatchObject({
			language: 'python'
		});
		await sandbox.dispose();
	});
});
