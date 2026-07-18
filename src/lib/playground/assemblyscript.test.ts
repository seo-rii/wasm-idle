import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
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
							fileName: 'main.as.ts',
							lineNumber: 1,
							columnNumber: 1,
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
				data: { output: 'factorial_plus_bonus=27\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/assemblyscript?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import AssemblyScript from './assemblyscript';

describe('AssemblyScript sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		suppressAutoLoadAck = false;
		suppressAutoRunAck = false;
	});

	it('loads the AssemblyScript worker and forwards diagnostics plus run output', async () => {
		const sandbox = new AssemblyScript();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = 'export function factorial_plus_bonus(): i32 { return 27; }';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'main.as.ts'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
				expect.objectContaining({
					load: true,
					moduleUrl: expect.stringMatching(/\/wasm-assemblyscript\/runtime\.mjs$/),
					log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.as.ts',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				activePath: 'main.as.ts',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.as.ts',
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('rejects load when the AssemblyScript worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new AssemblyScript();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/assemblyscript.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'AssemblyScript worker script error: worker script error (/worker/assemblyscript.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		suppressAutoRunAck = true;
		const sandbox = new AssemblyScript();
		await sandbox.load('/absproxy/5173');

		const runPromise = sandbox.run(
			'@external("env", "readLine") declare function readLine(): string | null;',
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
		const sandbox = new AssemblyScript();
		await sandbox.load('/absproxy/5173');

		const runPromise = sandbox.run(
			'@external("env", "readAll") declare function readAll(): string;',
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
