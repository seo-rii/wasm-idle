import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
		vi.useRealTimers();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '/wasm-of-js-of-ocaml/browser-native/src/index.js';
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL =
			'/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json';
		suppressAutoLoadAck = false;
		suppressAutoRunAck = false;
		runDispatchError = null;
	});

	afterEach(() => {
		vi.useRealTimers();
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

	it('reserves OCaml startup ownership before reading the signal getter', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/initial/');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace OCaml while reading the startup signal');
		let replacement: Promise<void> | undefined;
		let staleAssetReads = 0;
		const runtimeAssets = {
			get ocaml() {
				staleAssetReads += 1;
				return {
					moduleUrl: '/superseded/index.js',
					manifestUrl: '/superseded/manifest.json'
				};
			}
		};
		const options = {
			get signal() {
				sandbox.terminate(reason);
				replacement = sandbox.load({
					ocaml: {
						moduleUrl: '/replacement/index.js',
						manifestUrl: '/replacement/manifest.json'
					}
				});
				return undefined;
			}
		};

		const superseded = sandbox.load(runtimeAssets, '', true, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleAssetReads).toBe(0);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.moduleUrl).toBe('http://localhost:3000/replacement/index.js');
		expect(sandbox.manifestUrl).toBe('http://localhost:3000/replacement/manifest.json');
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('stops OCaml startup when the aborted getter replaces its operation', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/initial/');
		const reason = new Error('replace OCaml while reading startup aborted');
		let replacement: Promise<void> | undefined;
		let staleAssetReads = 0;
		const signal = {
			get aborted() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return false;
			},
			get reason() {
				throw new Error('stale OCaml startup reason was read');
			},
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as AbortSignal;
		const runtimeAssets = {
			get ocaml() {
				staleAssetReads += 1;
				return {
					moduleUrl: '/superseded/index.js',
					manifestUrl: '/superseded/manifest.json'
				};
			}
		};

		const superseded = sandbox.load(runtimeAssets, '', true, [], { signal });

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleAssetReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('stops snapshotting OCaml assets when a nested getter replaces the owner', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/initial/');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace OCaml while reading the module URL');
		let replacement: Promise<void> | undefined;
		let staleManifestReads = 0;
		const runtimeAssets = {
			ocaml: {
				get moduleUrl() {
					sandbox.terminate(reason);
					replacement = sandbox.load({
						ocaml: {
							moduleUrl: '/replacement/index.js',
							manifestUrl: '/replacement/manifest.json'
						}
					});
					return '/superseded/index.js';
				},
				get manifestUrl() {
					staleManifestReads += 1;
					return '/superseded/manifest.json';
				}
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleManifestReads).toBe(0);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.moduleUrl).toBe('http://localhost:3000/replacement/index.js');
		expect(sandbox.manifestUrl).toBe('http://localhost:3000/replacement/manifest.json');
	});

	it('does not read the OCaml asset root when both explicit URLs are configured', async () => {
		const sandbox = new Ocaml();
		let rootReads = 0;
		const runtimeAssets = {
			get rootUrl(): string {
				rootReads += 1;
				throw new Error('unused OCaml asset root was read');
			},
			ocaml: {
				moduleUrl: '/explicit/index.js',
				manifestUrl: '/explicit/manifest.json'
			}
		};

		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();

		expect(rootReads).toBe(0);
		expect(sandbox.moduleUrl).toBe('http://localhost:3000/explicit/index.js');
		expect(sandbox.manifestUrl).toBe('http://localhost:3000/explicit/manifest.json');
	});

	it('reads the OCaml asset root once when both URLs need the fallback', async () => {
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL = '';
		const sandbox = new Ocaml();
		let rootReads = 0;
		const runtimeAssets = {
			get rootUrl() {
				rootReads += 1;
				if (rootReads > 1) throw new Error('OCaml asset root was read more than once');
				return '/captured/';
			}
		};

		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();

		expect(rootReads).toBe(1);
		expect(sandbox.moduleUrl).toBe(
			'http://localhost:3000/captured/wasm-of-js-of-ocaml/browser-native/src/index.js'
		);
		expect(sandbox.manifestUrl).toBe(
			'http://localhost:3000/captured/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
		);
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

	it('reserves OCaml run ownership before option getters and preserves its replacement', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/initial/');
		const reason = new Error('replace OCaml while reading the execution backend');
		let replacement: Promise<void> | undefined;
		let staleModeReads = 0;
		let staleStdinReads = 0;
		const options = {
			get ocamlBackend() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return 'js' as const;
			},
			get ocamlWasmBinaryenMode() {
				staleModeReads += 1;
				return 'full' as const;
			},
			get stdin() {
				staleStdinReads += 1;
				return 'superseded input\n';
			}
		};

		const superseded = sandbox.run('let () = ()', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleModeReads).toBe(0);
		expect(staleStdinReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('keeps the first OCaml cancellation when the signal reason getter replaces the run', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/initial/');
		const firstReason = new Error('first OCaml cancellation');
		const laterReason = new Error('later OCaml signal reason');
		let replacement: Promise<void> | undefined;
		let staleBackendReads = 0;
		const signal = {
			aborted: true,
			get reason() {
				sandbox.terminate(firstReason);
				replacement = sandbox.load('/replacement/');
				return laterReason;
			},
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as AbortSignal;
		const options = {
			signal,
			get ocamlBackend() {
				staleBackendReads += 1;
				return 'js' as const;
			}
		};

		const superseded = sandbox.run('let () = ()', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(firstReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleBackendReads).toBe(0);
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('snapshots explicit OCaml stdin once before dispatch', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		let stdinReads = 0;
		const options = {
			get stdin() {
				stdinReads += 1;
				if (stdinReads > 1) throw new Error('OCaml stdin was read more than once');
				return 'captured input\n';
			}
		};

		await expect(
			sandbox.run('let () = ignore (read_line ())', false, true, undefined, [], options)
		).resolves.toBe(true);

		expect(stdinReads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'captured input\n' })
		);
	});

	it('validates and forwards a canonical multi-file OCaml workspace', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const code = 'let () = Helper.print_message ()';

		await expect(
			sandbox.run(code, true, true, undefined, [], {
				activePath: 'src/main.ml',
				workspaceFiles: [
					{
						path: 'src\\helper.ml',
						content: 'let print_message () = print_endline "ok"'
					},
					{ path: 'src/main.ml', content: 'stale active source' }
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				code,
				activePath: 'src/main.ml',
				workspaceFiles: [
					{
						path: 'src/helper.ml',
						content: 'let print_message () = print_endline "ok"'
					}
				]
			})
		);
	});

	it('rejects an unsafe OCaml workspace before mutating the loaded worker', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		await expect(
			sandbox.run('let () = ()', false, true, undefined, [], {
				workspaceFiles: [{ path: '../outside.ml', content: 'let escaped = true' }]
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'invalid-path',
			path: '../outside.ml'
		});

		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('clamps OCaml workspace overrides to the execution byte ceiling', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		await expect(
			sandbox.run('ab', false, true, undefined, [], {
				limits: { maxWorkspaceBytes: 3 },
				workspaceLimits: { maxFileBytes: 100, maxTotalBytes: 100 },
				workspaceFiles: [{ path: 'helper.ml', content: 'cd' }]
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'total-size-limit',
			limit: 3,
			actual: 4
		});

		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
	});

	it('stops reading OCaml workspace entries after a getter replaces the run', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/initial/');
		const reason = new Error('replace OCaml while reading a workspace path');
		let replacement: Promise<void> | undefined;
		let staleContentReads = 0;
		const workspaceFile = {
			get path() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return 'superseded.ml';
			},
			get content() {
				staleContentReads += 1;
				return 'let stale = true';
			}
		};

		const superseded = sandbox.run('let () = ()', false, true, undefined, [], {
			workspaceFiles: [workspaceFile]
		});

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleContentReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('stops reading OCaml limits after a getter replaces startup ownership', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/initial/');
		const reason = new Error('replace OCaml while reading startup limits');
		let replacement: Promise<void> | undefined;
		let staleLimitReads = 0;
		const limits = {
			get assetTimeoutMs() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return 5;
			},
			get startupTimeoutMs() {
				staleLimitReads += 1;
				return 7;
			}
		};

		const superseded = sandbox.load('/superseded/', '', true, [], { limits });

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleLimitReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('preserves an OCaml replacement started during signal listener cleanup', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		let replacement: Promise<boolean | string> | undefined;
		let removeCalls = 0;
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener() {
				removeCalls += 1;
				if (removeCalls !== 1) return;
				replacement = sandbox.run('let () = ignore (read_line ())', false);
				sandbox.write('replacement input\n');
				sandbox.eof();
			}
		} as unknown as AbortSignal;
		const completed = sandbox.run('let () = ()', false, true, undefined, [], { signal });
		const completedHandler = worker.onmessage;

		completedHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(completed).resolves.toBe(true);
		expect(removeCalls).toBe(1);
		const replacementHandler = worker.onmessage;
		replacementHandler?.({ data: { buffer: true } } as MessageEvent<any>);
		expect(readBufferedStdin(sandbox.buffer)).toBe('replacement input\n');
		replacementHandler?.({ data: { results: true } } as MessageEvent<any>);

		await expect(replacement).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('stops reading an OCaml worker message after a getter replaces the run', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const oldWorker = workerInstances[0];
		const reason = new Error('replace OCaml while reading worker output');
		let replacement: Promise<void> | undefined;
		let staleResultReads = 0;
		const running = sandbox.run('let () = ()', false);
		const staleHandler = oldWorker.onmessage;
		const message = {
			get output() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return 'superseded output\n';
			},
			get results() {
				staleResultReads += 1;
				return true;
			}
		};

		staleHandler?.({ data: message } as MessageEvent<any>);

		await expect(running).rejects.toBe(reason);
		await vi.dynamicImportSettled();
		await expect(replacement).resolves.toBeUndefined();
		expect(staleResultReads).toBe(0);
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('enforces the OCaml output byte limit without an output callback', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('let () = ()', false, true, undefined, [], {
			limits: { maxOutputBytes: 2 }
		});
		const staleHandler = retiredWorker.onmessage;

		staleHandler?.({ data: { output: 'é' } } as MessageEvent<any>);
		staleHandler?.({ data: { output: 'é', results: true } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'OCAML',
			limit: 2,
			actual: 4
		});
		expect(sandbox.output).toBeNull();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { results: true } } as MessageEvent<any>);
		suppressAutoRunAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('suppresses the OCaml output chunk that crosses the byte limit', async () => {
		const sandbox = new Ocaml();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const running = sandbox.run('let () = ()', false, true, undefined, [], {
			limits: { maxOutputBytes: 2 }
		});
		const handler = worker.onmessage;

		handler?.({ data: { output: 'ok' } } as MessageEvent<any>);
		handler?.({ data: { output: '💥', results: true } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			limit: 2,
			actual: 6
		});
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('ok');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('enforces the OCaml diagnostic limit without a diagnostic callback', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const running = sandbox.run('let () = ()', true, true, undefined, [], {
			limits: { maxDiagnostics: 1 }
		});
		const handler = worker.onmessage;
		const diagnostic = {
			fileName: 'main.ml',
			lineNumber: 1,
			severity: 'warning',
			message: 'unused value'
		};

		handler?.({ data: { diagnostic } } as MessageEvent<any>);
		handler?.({ data: { diagnostic, results: true } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'OCAML',
			limit: 1,
			actual: 2
		});
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
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

	it('enforces the aggregate OCaml startup deadline and ignores stale readiness', async () => {
		vi.useFakeTimers();
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'OCAML',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('enforces the aggregate OCaml execution deadline and permits a clean retry', async () => {
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		suppressAutoRunAck = true;
		vi.useFakeTimers();
		const running = sandbox.run('let () = ()', false, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'OCAML',
			timeoutMs: 10
		});
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale output', results: true } } as MessageEvent<any>);
		suppressAutoRunAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('let () = ()', false)).resolves.toBe(true);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('clears settled OCaml deadlines before they can retire an idle worker', async () => {
		vi.useFakeTimers();
		const sandbox = new Ocaml();
		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const worker = workerInstances[0];
		await expect(
			sandbox.run('let () = ()', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);

		await vi.advanceTimersByTimeAsync(10);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
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

	it('keeps clear reusable but disposes an idle OCaml runtime exactly once', async () => {
		const sandbox = new Ocaml();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		sandbox.write('stale before clear\n');
		sandbox.eof();
		await sandbox.clear();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		await expect(sandbox.run('let reusable = true', false)).resolves.toBe(true);
		sandbox.write('queued input\n');
		sandbox.eof();

		let cleanupSnapshot: Record<string, unknown> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		worker.terminate.mockImplementationOnce(() => {
			cleanupSnapshot = {
				worker: sandbox.worker,
				moduleUrl: sandbox.moduleUrl,
				manifestUrl: sandbox.manifestUrl,
				output: sandbox.output,
				diagnostic: sandbox.oncompilerdiagnostic,
				pendingInput: [...sandbox.pendingInput],
				waitingForInput: sandbox.waitingForInput,
				pendingEof: sandbox.pendingEof,
				bufferedInput: readBufferedStdin(sandbox.buffer),
				onmessage: worker.onmessage,
				onerror: worker.onerror,
				onmessageerror: worker.onmessageerror
			};
			reentrantLoad = sandbox.load('/reentrant/');
			reentrantRun = sandbox.run('let reentrant = true', false);
			void reentrantLoad.catch(() => undefined);
			void reentrantRun.catch(() => undefined);
			reentrantDisposal = sandbox.dispose();
		});

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		expect(reentrantDisposal).toBe(firstDisposal);
		await firstDisposal;

		expect(cleanupSnapshot).toEqual({
			worker: undefined,
			moduleUrl: '',
			manifestUrl: '',
			output: undefined,
			diagnostic: undefined,
			pendingInput: [],
			waitingForInput: false,
			pendingEof: false,
			bufferedInput: '',
			onmessage: null,
			onerror: null,
			onmessageerror: null
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'OCAML'
		});
		await expect(reentrantRun).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'OCAML'
		});
		await expect(sandbox.load('/replacement/')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'OCAML'
		});
		await expect(sandbox.run('let later = true', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'OCAML'
		});
		const uidAfterDisposal = sandbox.uid;
		sandbox.write('ignored input\n');
		sandbox.eof();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		sandbox.kill();
		expect(sandbox.uid).toBe(uidAfterDisposal);
		expect(worker.terminate).toHaveBeenCalledOnce();
		await sandbox.clear();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles pending OCaml startup with one disposal cancellation', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const racingReason = new Error('OCaml external abort raced terminal disposal');
		let reentrantLoad: Promise<void> | undefined;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		const outcome = loading.catch((error) => error);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;
		const progressCallsBeforeDisposal = progress.set.mock.calls.length;
		worker.terminate.mockImplementationOnce(() => {
			controller.abort(racingReason);
			reentrantLoad = sandbox.load('/reentrant/');
			reentrantRun = sandbox.run('let reentrant = true', false);
			void reentrantLoad.catch(() => undefined);
			void reentrantRun.catch(() => undefined);
			reentrantDisposal = sandbox.dispose();
		});

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		expect(reentrantDisposal).toBe(firstDisposal);
		const cancellation = await outcome;
		await firstDisposal;

		expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'OCAML',
			recoverable: false
		});
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'OCAML'
		});
		await expect(reentrantRun).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'OCAML'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(progress.set).toHaveBeenCalledTimes(progressCallsBeforeDisposal);
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.manifestUrl).toBe('');
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active OCaml run, clears stdin, and ignores retained messages', async () => {
		const sandbox = new Ocaml();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		suppressAutoRunAck = true;
		const running = sandbox.run('let () = read_line () |> print_endline', false);
		const outcome = running.catch((error) => error);
		const staleHandler = worker.onmessage;
		staleHandler?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.write('42\n');
		sandbox.eof();
		expect(readBufferedStdin(sandbox.buffer)).toBe('42\n');
		expect(sandbox.pendingEof).toBe(true);

		await sandbox.dispose();
		const cancellation = await outcome;
		expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'OCAML',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.waitingForInput).toBe(false);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		staleHandler?.({
			data: {
				buffer: true,
				output: 'late output',
				diagnostic: { message: 'late diagnostic' },
				results: true
			}
		} as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();
		expect(diagnostic).not.toHaveBeenCalled();
		expect(sandbox.output).toBeUndefined();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();
		expect(sandbox.worker).toBeUndefined();
	});

	it('quarantines an OCaml replacement when worker retirement reenters disposal', async () => {
		const sandbox = new Ocaml();
		await sandbox.load({
			ocaml: { moduleUrl: '/first/module.js', manifestUrl: '/first/manifest.json' }
		});
		const retiredWorker = workerInstances[0];
		let reentrantDisposal: Promise<void> | undefined;
		let reentrantError: unknown;
		retiredWorker.terminate.mockImplementationOnce(() => {
			try {
				reentrantDisposal = sandbox.dispose();
			} catch (error) {
				reentrantError = error;
			}
		});
		suppressAutoLoadAck = true;

		const replacement = sandbox.load({
			ocaml: { moduleUrl: '/second/module.js', manifestUrl: '/second/manifest.json' }
		});
		const outcome = replacement.catch((error) => error);
		await vi.waitFor(() => expect(reentrantDisposal ?? reentrantError).toBeDefined());

		expect(reentrantError).toBeUndefined();
		const cancellation = await outcome;
		expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(sandbox.dispose()).toBe(reentrantDisposal);
		await reentrantDisposal;
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(replacementWorker.postMessage).not.toHaveBeenCalled();
		expect(replacementWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.manifestUrl).toBe('');
	});
});
