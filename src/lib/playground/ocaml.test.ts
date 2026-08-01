import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusyError, ProtocolError } from '@wasm-idle/core';

import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_OCAML_MODULE_URL: '',
		PUBLIC_WASM_OCAML_MANIFEST_URL: ''
	}
}));
let suppressAutoLoadAck = false;
let suppressAutoRunAck = false;
let runDispatchError: unknown = null;

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
		if (runDispatchError !== null) throw runDispatchError;
		if (suppressAutoRunAck) return;
		if (message.prepare) {
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						progress: {
							stage: 'compile-ready',
							percent: 35
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.ml',
							lineNumber: 1,
							columnNumber: 5,
							severity: 'warning',
							message: 'unused value'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: {
					output:
						message.target === 'js'
							? 'hello from ocaml js\n'
							: 'hello from ocaml wasm\n',
					results: true
				}
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/ocaml?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Ocaml from './ocaml';

describe('OCaml sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '/wasm-of-js-of-ocaml/browser-native/src/index.js';
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL =
			'/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json';
		suppressAutoLoadAck = false;
		suppressAutoRunAck = false;
		runDispatchError = null;
	});

	it('loads the OCaml worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Ocaml();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const values: number[] = [];
		const code = `let () = print_endline "hello"`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run(code, true, true, {
				set(value: number) {
					values.push(value);
				}
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, [], {
				ocamlBackend: 'js',
				stdin: 'line one\n'
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, [], {
				ocamlBackend: 'wasm',
				ocamlWasmBinaryenMode: 'full'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(
					/\/wasm-of-js-of-ocaml\/browser-native\/src\/index\.js$/
				),
				manifestUrl: expect.stringMatching(
					/\/wasm-of-js-of-ocaml\/browser-native-bundle\/browser-native-manifest\.v1\.json$/
				)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				target: 'wasm',
				wasmBinaryenMode: 'fast',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				target: 'js',
				wasmBinaryenMode: 'fast',
				log: true,
				buffer: expect.any(SharedArrayBuffer),
				stdin: 'line one\n'
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({
				prepare: false,
				code,
				target: 'wasm',
				wasmBinaryenMode: 'full',
				log: true,
				buffer: expect.any(SharedArrayBuffer)
			})
		);
		expect(outputs).toContain('hello from ocaml js\n');
		expect(outputs).toContain('hello from ocaml wasm\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.ml',
				lineNumber: 1,
				columnNumber: 5,
				severity: 'warning',
				message: 'unused value'
			}
		]);
		expect(values).toEqual([0.35]);
	});

	it('rejects load when the OCaml worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/ocaml.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'OCaml worker script error: worker script error (/worker/ocaml.js:88:24)'
		);
	});

	it('rejects load when the OCaml bundle URLs are missing', async () => {
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL = '';
		const sandbox = new Ocaml();

		await expect(sandbox.load({ rootUrl: '' })).rejects.toContain(
			'OCaml runtime is not configured'
		);
	});

	it('writes queued terminal input when the OCaml worker requests stdin', async () => {
		const sandbox = new Ocaml();
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

		await expect(sandbox.run('let () = print_endline (read_line ())', false)).resolves.toBe(
			true
		);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('writes EOF when the OCaml worker requests stdin after eof is signaled', async () => {
		const sandbox = new Ocaml();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.eof();
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run(
				'let () = print_endline (try read_line () with End_of_file -> "eof")',
				false
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBeNull();
	});

	it('rejects overlapping startup and execution while load is pending', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const firstLoad = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup'
		});
		await expect(sandbox.run('let () = ()', false)).rejects.toBeInstanceOf(BusyError);

		worker.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(firstLoad).resolves.toBeUndefined();
	});

	it('commits runtime URLs only after a successful load callback', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const callbackError = new Error('progress callback failed');
		const loadPromise = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{},
			{
				set() {
					throw callbackError;
				}
			}
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onmessage?.({ data: { load: true } } as MessageEvent<any>);

		await expect(loadPromise).rejects.toBe(callbackError);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.manifestUrl).toBe('');
		expect(worker.terminate).toHaveBeenCalledOnce();

		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('rejects overlapping runs and loads until the active run settles', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const firstRun = sandbox.run('let () = ()', false);
		const handler = worker.onmessage;

		await expect(sandbox.run('let () = ()', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute'
		});
		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute'
		});

		handler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);

		suppressAutoRunAck = false;
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('cancels a run reentrantly without accepting the rest of the worker message', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		sandbox.output = () => sandbox.terminate('stopped from output');

		await expect(sandbox.run('let () = print_endline "stop"', false)).rejects.toBe(
			'stopped from output'
		);
		expect(worker.terminate).toHaveBeenCalledOnce();

		sandbox.output = vi.fn();
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('quarantines a worker when an execution callback throws', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const callbackError = new Error('output callback failed');
		sandbox.output = () => {
			throw callbackError;
		};

		await expect(sandbox.run('let () = print_endline "fail"', false)).rejects.toBe(
			callbackError
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		sandbox.output = vi.fn();
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('keeps the loaded worker reusable after a synchronous run dispatch failure', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const dispatchError = new Error('postMessage failed');
		runDispatchError = dispatchError;

		await expect(sandbox.run('let () = ()', false)).rejects.toBe(dispatchError);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);

		runDispatchError = null;
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('fails closed on the removed page-runtime protocol without patching globals', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const originalConsole = window.console;
		const originalFetch = window.fetch;
		const originalInstantiate = WebAssembly.instantiate;
		const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
		const runPromise = sandbox.run('let () = ()', false);
		const handler = worker.onmessage;

		handler?.({
			data: {
				runtime: {
					programSource: 'globalThis.__ocamlLegacyRuntimeExecuted = true'
				}
			}
		} as MessageEvent<any>);
		const error = await runPromise.catch((reason) => reason);

		expect(error).toBeInstanceOf(ProtocolError);
		expect(error).toMatchObject({
			name: 'ProtocolError',
			code: 'protocol',
			phase: 'execute',
			runtimeId: 'OCAML'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(window.console).toBe(originalConsole);
		expect(window.fetch).toBe(originalFetch);
		expect(WebAssembly.instantiate).toBe(originalInstantiate);
		expect(WebAssembly.instantiateStreaming).toBe(originalInstantiateStreaming);
		expect(
			(globalThis as typeof globalThis & { __ocamlLegacyRuntimeExecuted?: boolean })
				.__ocamlLegacyRuntimeExecuted
		).toBeUndefined();

		suppressAutoRunAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('ignores a stale run handler after a worker error and allows a clean retry', async () => {
		const sandbox = new Ocaml();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const runPromise = sandbox.run('let () = ()', false);
		const staleHandler = worker.onmessage;

		worker.onerror?.({
			message: 'worker crashed',
			filename: '/worker/ocaml.js',
			lineno: 12,
			colno: 8
		} as ErrorEvent);

		await expect(runPromise).rejects.toContain(
			'OCaml worker script error: worker crashed (/worker/ocaml.js:12:8)'
		);
		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		suppressAutoRunAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});
});
