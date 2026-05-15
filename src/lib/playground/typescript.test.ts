import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_TYPESCRIPT_MODULE_URL: ''
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
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.ts',
							lineNumber: 1,
							columnNumber: 7,
							severity: 'warning',
							message: 'demo warning'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true, buffer: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'hi\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/typescript?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import TypeScriptSandbox from './typescript';

describe('TypeScript sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '/wasm-typescript/index.js';
		suppressAutoLoadAck = false;
	});

	it('loads the wasm-typescript worker and forwards diagnostics plus run output', async () => {
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = `const value: number = 1;
console.log(value);`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				activePath: 'src/main.ts',
				workspaceFiles: [{ path: 'src/main.ts', content: code }]
			})
		).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['one'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-typescript\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				language: 'typescript',
				activePath: 'src/main.ts',
				workspaceFiles: [{ path: 'src/main.ts', content: code }],
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one'],
				language: 'typescript',
				activePath: 'main.ts',
				log: true
			})
		);
		expect(outputs).toContain('hi\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.ts',
				lineNumber: 1,
				columnNumber: 7,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('uses JavaScript mode when constructed for JavaScript', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('console.log(1)', false)).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				language: 'javascript',
				activePath: 'main.js'
			})
		);
	});

	it('rejects load when no wasm-typescript module url is configured', async () => {
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '';
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');

		await expect(sandbox.load({})).rejects.toContain(
			'TypeScript runtime is not configured'
		);
	});

	it('rejects load when the worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/typescript.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'TypeScript worker script error: worker script error (/worker/typescript.js:88:24)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('42\n');
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('console.log(1)', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
