import { beforeEach, describe, expect, it, vi } from 'vitest';
const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_OCTAVE_BASE_URL: '',
		PUBLIC_WASM_OCTAVE_WORKER_URL: '',
		PUBLIC_WASM_OCTAVE_MANIFEST_URL: ''
	}
}));
let onPostMessage: ((worker: MockWorker, message: any) => void) | null = null;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (onPostMessage) {
			onPostMessage(this, message);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'factorial_plus_bonus=27\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor(public url: string) {
		workerInstances.push(this);
	}
}

vi.stubGlobal('Worker', MockWorker);

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Octave from './octave';

describe('Octave sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_OCTAVE_BASE_URL = '';
		publicEnv.PUBLIC_WASM_OCTAVE_WORKER_URL = '';
		publicEnv.PUBLIC_WASM_OCTAVE_MANIFEST_URL = '';
		onPostMessage = null;
	});

	it('loads Octave runtime urls and forwards run output to a classic worker', async () => {
		const sandbox = new Octave();
		const outputs: string[] = [];
		const code = 'printf("factorial_plus_bonus=27\\n");';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			octave: {
				baseUrl: '/wasm-octave/runtime/',
				workerUrl: '/wasm-octave/runner-worker.js?v=test',
				manifestUrl: '/wasm-octave/runtime/runtime-manifest.v1.json?v=test'
			}
		});
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['5'], {
				activePath: 'main.m',
				stdin: '4\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].url).toBe(
			'http://localhost:3000/wasm-octave/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-octave/runtime/',
				manifestUrl:
					'http://localhost:3000/wasm-octave/runtime/runtime-manifest.v1.json?v=test',
				code,
				args: ['5'],
				stdin: '4\n',
				activePath: 'main.m',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
	});

	it('collects queued terminal input before starting stdin-using Octave code', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		let runMessage: any;

		onPostMessage = (worker, message) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						results: true
					}
				} as MessageEvent<any>);
			});
		};

		const runPromise = sandbox.run('n = str2double(fgetl(stdin));', false);
		await Promise.resolve();
		expect(workerInstances).toHaveLength(0);
		sandbox.write('42\n');

		await expect(runPromise).resolves.toBe(true);
		expect(runMessage.stdin).toBe('42\n');
	});
});
