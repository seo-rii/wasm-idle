import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_WAT_MODULE_URL: ''
	}
}));
let suppressAutoLoadAck = false;
let suppressAutoRunAck = false;

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
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.wat',
							lineNumber: 1,
							columnNumber: 2,
							severity: 'warning',
							message: 'demo warning'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
			return;
		}
		if (suppressAutoRunAck) return;
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'answer=45\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/wat?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Wat from './wat';

describe('WAT sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_WAT_MODULE_URL = '/wasm-wat/index.js';
		suppressAutoLoadAck = false;
		suppressAutoRunAck = false;
	});

	it('loads the WAT worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Wat();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = '(module (func (export "answer") (result i32) i32.const 45))';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['alpha'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-wat\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.wat',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				activePath: 'main.wat',
				log: true
			})
		);
		expect(outputs).toContain('answer=45\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.wat',
				lineNumber: 1,
				columnNumber: 2,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('rejects load when no WAT module url is configured', async () => {
		publicEnv.PUBLIC_WASM_WAT_MODULE_URL = '';
		const sandbox = new Wat();

		await expect(sandbox.load({})).rejects.toContain('WAT runtime is not configured');
	});

	it('rejects load when the WAT worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Wat();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/wat.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'WAT worker script error: worker script error (/worker/wat.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');

		const runPromise = sandbox.run(
			'(module (import "env" "readByte" (func $readByte (result i32))))',
			false
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const runMessage = worker.postMessage.mock.calls.at(-1)?.[0];

		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.write('42\n');

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(runPromise).resolves.toBe(true);
	});

	it('writes EOF when the worker requests stdin after eof is signaled', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');

		const runPromise = sandbox.run(
			'(module (import "env" "readByte" (func $readByte (result i32))))',
			false
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const runMessage = worker.postMessage.mock.calls.at(-1)?.[0];

		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.eof();

		expect(readBufferedStdin(runMessage.buffer)).toBeNull();
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(runPromise).resolves.toBe(true);
	});
});
