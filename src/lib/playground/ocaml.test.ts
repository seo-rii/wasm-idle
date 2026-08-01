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
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loadPromise = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
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
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
	});

	it('rejects load when the OCaml bundle URLs are missing', async () => {
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL = '';
		const sandbox = new Ocaml();

		await expect(sandbox.load({ rootUrl: '' })).rejects.toContain(
			'OCaml runtime is not configured'
		);
	});

	it('rejects a pre-aborted OCaml startup without creating a worker', async () => {
		const sandbox = new Ocaml();
		const controller = new AbortController();
		const reason = new Error('stop before OCaml startup');
		controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.manifestUrl).toBe('');

		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
	});

	it('preserves a null abort reason and supplies phase-specific fallback errors', async () => {
		const nullController = new AbortController();
		nullController.abort(null);
		await expect(
			new Ocaml().load('/absproxy/5173', '', true, [], { signal: nullController.signal })
		).rejects.toBeNull();

		const fallbackSignal = {
			aborted: true,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as AbortSignal;
		await expect(
			new Ocaml().load('/absproxy/5173', '', true, [], { signal: fallbackSignal })
		).rejects.toMatchObject({
			name: 'AbortError',
			message: 'OCaml runtime startup aborted'
		});

		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run('let () = ()', false, true, undefined, [], { signal: fallbackSignal })
		).rejects.toMatchObject({
			name: 'AbortError',
			message: 'OCaml execution aborted'
		});
		expect(workerInstances[0].postMessage).toHaveBeenCalledOnce();
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('rejects a pre-aborted OCaml execution without mutating worker or stdin state', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const uid = sandbox.uid;
		const controller = new AbortController();
		const reason = new Error('stop before OCaml execution');
		sandbox.write('preserved input\n');
		sandbox.eof();
		controller.abort(reason);

		await expect(
			sandbox.run('let () = ()', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBe(reason);
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual(['preserved input\n']);
		expect(sandbox.pendingEof).toBe(true);
	});

	it('aborts OCaml startup before worker import and permits a clean retry', async () => {
		const sandbox = new Ocaml();
		const controller = new AbortController();
		const reason = new Error('stop OCaml before worker import');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});

		controller.abort(reason);

		await expect(loading).rejects.toBe(reason);
		await vi.dynamicImportSettled();
		expect(workerInstances).toHaveLength(0);
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
	});

	it('aborts a stalled OCaml startup without letting stale listeners affect its replacement', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const controller = new AbortController();
		const reason = new Error('stop stalled OCaml startup');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		const loadingResult = loading.catch((error) => error);
		await vi.dynamicImportSettled();
		const oldWorker = workerInstances[0];
		const staleHandler = oldWorker.onmessage;
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		const staleAbort = abortRegistration?.[1] as (() => void) | undefined;

		controller.abort(reason);
		const replacementLoad = sandbox.load('/absproxy/5173');

		await vi.dynamicImportSettled();
		await expect(loadingResult).resolves.toBe(reason);
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		staleAbort?.();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();

		replacementWorker.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(replacementLoad).resolves.toBeUndefined();
	});

	it('ignores an abort fired immediately after successful OCaml readiness', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		controller.abort(new Error('late successful OCaml startup abort'));

		await expect(loading).resolves.toBeUndefined();
		expect(worker.terminate).not.toHaveBeenCalled();
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
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

	it('isolates empty explicit stdin from queued terminal input across runs', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		suppressAutoRunAck = true;
		sandbox.write('queued before explicit run\n');
		sandbox.eof();
		const explicitRun = sandbox.run(
			'let () = ignore (read_line ())',
			false,
			true,
			undefined,
			[],
			{
				stdin: ''
			}
		);

		expect(worker.postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ stdin: '' })
		);
		sandbox.write('queued during explicit run\n');
		sandbox.eof();
		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(explicitRun).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		const bufferedRun = sandbox.run('let () = ignore (read_line ())', false);
		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		expect(sandbox.waitingForInput).toBe(true);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		sandbox.write('fresh input\n');
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('fresh input\n');
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(bufferedRun).resolves.toBe(true);
	});

	it('preserves queued input when explicit stdin is rejected before dispatch', async () => {
		const sandbox = new Ocaml();
		sandbox.write('preserved input\n');
		sandbox.eof();

		await expect(
			sandbox.run('let () = ()', false, true, undefined, [], { stdin: '' })
		).rejects.toBe('Worker not loaded');

		expect(sandbox.pendingInput).toEqual(['preserved input\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
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

	it('releases a terminated startup before its rejection settles', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const firstLoad = sandbox.load('/absproxy/5173');
		const firstResult = firstLoad.catch((reason) => reason);
		await vi.dynamicImportSettled();
		const oldWorker = workerInstances[0];
		const staleHandler = oldWorker.onmessage;
		const reason = new Error('stop pending OCaml startup');

		sandbox.terminate(reason);
		const replacementLoad = sandbox.load('/absproxy/5173');

		await vi.dynamicImportSettled();
		await expect(firstResult).resolves.toBe(reason);
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'startup'
		});

		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		replacementWorker.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(replacementLoad).resolves.toBeUndefined();
	});

	it('commits runtime URLs only after a successful load callback', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const callbackError = new Error('progress callback failed');
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loadPromise = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
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
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

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

	it('releases a terminated run before its rejection settles', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const oldWorker = workerInstances[0];
		const firstRun = sandbox.run('let () = ()', false, true, undefined, [], {
			stdin: ''
		});
		const firstResult = firstRun.catch((reason) => reason);
		const staleHandler = oldWorker.onmessage;
		const reason = new Error('stop active OCaml run');
		suppressAutoLoadAck = true;
		sandbox.write('queued during terminated explicit run\n');
		sandbox.eof();

		sandbox.terminate(reason);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		const replacementLoad = sandbox.load('/absproxy/5173');

		await vi.dynamicImportSettled();
		await expect(firstResult).resolves.toBe(reason);
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		await expect(sandbox.run('let () = ()', false)).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'startup'
		});

		staleHandler?.({ data: { results: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		replacementWorker.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(replacementLoad).resolves.toBeUndefined();

		suppressAutoRunAck = false;
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('keeps input written after explicit-run termination', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const running = sandbox.run('let () = ()', false, true, undefined, [], {
			stdin: ''
		});
		const result = running.catch((reason) => reason);
		sandbox.write('discarded explicit-run input\n');
		const reason = new Error('stop explicit OCaml run');

		sandbox.terminate(reason);
		sandbox.write('replacement input\n');

		await expect(result).resolves.toBe(reason);
		expect(sandbox.pendingInput).toEqual(['replacement input\n']);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
	});

	it('aborts an active OCaml run and confines stale handlers and listeners to its worker', async () => {
		const sandbox = new Ocaml();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const oldWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('stop active OCaml execution');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const running = sandbox.run('let () = ()', false, true, undefined, [], {
			signal: controller.signal,
			stdin: ''
		});
		const staleHandler = oldWorker.onmessage;
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		const staleAbort = abortRegistration?.[1] as (() => void) | undefined;
		sandbox.write('discarded input\n');
		sandbox.eof();

		controller.abort(reason);
		sandbox.write('replacement input\n');

		await expect(running).rejects.toBe(reason);
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.pendingInput).toEqual(['replacement input\n']);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		suppressAutoLoadAck = true;
		const replacementLoad = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const replacementWorker = workerInstances[1];
		staleAbort?.();
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
		replacementWorker.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(replacementLoad).resolves.toBeUndefined();

		suppressAutoRunAck = false;
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it.each(['progress', 'output'])(
		'aborts an OCaml run reentrantly from its $kind callback',
		async (kind) => {
			const sandbox = new Ocaml();
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			const controller = new AbortController();
			const reason = new Error(`stop from OCaml ${kind}`);
			const progress = {
				set: vi.fn(() => {
					if (kind === 'progress') controller.abort(reason);
				})
			};
			sandbox.output = vi.fn(() => {
				if (kind === 'output') controller.abort(reason);
			});

			await expect(
				sandbox.run(
					'let () = print_endline "stop"',
					kind === 'progress',
					true,
					progress,
					[],
					{
						signal: controller.signal
					}
				)
			).rejects.toBe(reason);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
			if (kind === 'progress') {
				expect(progress.set).toHaveBeenCalledWith(0.35, 'compile-ready');
			} else {
				expect(sandbox.output).toHaveBeenCalledWith('hello from ocaml wasm\n');
			}

			await sandbox.load('/absproxy/5173');
			await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
		}
	);

	it('preserves replacement input when an aborting output callback subsequently throws', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const controller = new AbortController();
		const abortReason = new Error('stop before replacement OCaml input');
		const callbackError = new Error('throw after OCaml abort');
		sandbox.output = () => {
			controller.abort(abortReason);
			sandbox.write('replacement input\n');
			sandbox.eof();
			throw callbackError;
		};

		await expect(
			sandbox.run('let () = print_endline "stop"', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBe(abortReason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual(['replacement input\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
	});

	it('ignores an abort fired immediately after a successful OCaml result', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const running = sandbox.run('let () = ()', false, true, undefined, [], {
			signal: controller.signal
		});

		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		controller.abort(new Error('late successful OCaml result abort'));

		await expect(running).resolves.toBe(true);
		expect(worker.terminate).not.toHaveBeenCalled();
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

		suppressAutoRunAck = false;
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('cancels a run reentrantly without accepting the rest of the worker message', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		sandbox.output = () => sandbox.terminate('stopped from output');
		sandbox.write('queued before cancelled explicit run\n');
		const running = sandbox.run('let () = print_endline "stop"', false, true, undefined, [], {
			stdin: ''
		});
		sandbox.write('queued during cancelled explicit run\n');
		sandbox.eof();

		await expect(running).rejects.toBe('stopped from output');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		sandbox.output = vi.fn();
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('quarantines a worker when an execution callback throws', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const callbackError = new Error('output callback failed');
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		sandbox.output = () => {
			throw callbackError;
		};
		sandbox.write('queued before callback failure\n');
		const running = sandbox.run('let () = print_endline "fail"', false, true, undefined, [], {
			signal: controller.signal,
			stdin: ''
		});
		sandbox.write('queued during callback failure\n');
		sandbox.eof();

		await expect(running).rejects.toBe(callbackError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

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
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		runDispatchError = dispatchError;
		sandbox.write('queued before failed explicit dispatch\n');
		sandbox.eof();

		await expect(
			sandbox.run('let () = ()', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBe(dispatchError);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

		runDispatchError = null;
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('clears explicit stdin state after a worker execution error', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const running = sandbox.run('let () = ()', false, true, undefined, [], {
			signal: controller.signal,
			stdin: 'explicit input\n'
		});
		sandbox.write('queued during failed explicit run\n');
		sandbox.eof();

		worker.onmessage?.({ data: { error: 'OCaml execution failed' } } as MessageEvent<any>);

		await expect(running).rejects.toBe('OCaml execution failed');
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		const abortRegistration = addEventListener.mock.calls.find((call) => call[0] === 'abort');
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

		suppressAutoRunAck = false;
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

	it.each(['script error', 'message error'])(
		'ignores a stale run handler after a worker $kind and allows a clean retry',
		async (kind) => {
			const sandbox = new Ocaml();
			const output = vi.fn();
			const controller = new AbortController();
			const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			sandbox.output = output;
			await sandbox.load('/absproxy/5173');
			suppressAutoRunAck = true;
			const worker = workerInstances[0];
			const runPromise = sandbox.run('let () = ()', false, true, undefined, [], {
				signal: controller.signal,
				stdin: 'explicit input\n'
			});
			const staleHandler = worker.onmessage;
			sandbox.write('queued during crashed explicit run\n');
			sandbox.eof();

			if (kind === 'script error') {
				worker.onerror?.({
					message: 'worker crashed',
					filename: '/worker/ocaml.js',
					lineno: 12,
					colno: 8
				} as ErrorEvent);
			} else {
				worker.onmessageerror?.({ data: null } as MessageEvent<any>);
			}

			await expect(runPromise).rejects.toContain(
				kind === 'script error'
					? 'OCaml worker script error: worker crashed (/worker/ocaml.js:12:8)'
					: 'OCaml worker message deserialization failed'
			);
			staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
			expect(output).not.toHaveBeenCalled();
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect(sandbox.waitingForInput).toBe(false);
			expect(readBufferedStdin(sandbox.buffer)).toBe('');
			const abortRegistration = addEventListener.mock.calls.find(
				(call) => call[0] === 'abort'
			);
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

			suppressAutoRunAck = false;
			await sandbox.load('/absproxy/5173');
			controller.abort(new Error('late failed OCaml run abort'));
			expect(workerInstances[1].terminate).not.toHaveBeenCalled();
			await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
			expect(workerInstances).toHaveLength(2);
		}
	);
});
