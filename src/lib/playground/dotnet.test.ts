import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_DOTNET_MODULE_URL: ''
	}
}));
let suppressAutoLoadAck = false;
let suppressAutoRunAck = false;
let runDispatchError: unknown;

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
							fileName: 'Program.fs',
							lineNumber: 3,
							columnNumber: 5,
							severity: 'warning',
							message: 'FS0025: incomplete pattern matches'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
			return;
		}
		if (runDispatchError) throw runDispatchError;
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

vi.mock('$lib/playground/worker/dotnet?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Dotnet from './dotnet';

describe('Dotnet sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_DOTNET_MODULE_URL = '/wasm-dotnet/index.js';
		suppressAutoLoadAck = false;
		suppressAutoRunAck = false;
		runDispatchError = undefined;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('loads the dotnet worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Dotnet();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = 'printfn "hello"';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		sandbox.write('5\n');
		await expect(sandbox.run(code, false, true, undefined, ['4'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-dotnet\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				language: 'fsharp',
				args: [],
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				language: 'fsharp',
				args: ['4'],
				stdin: '5\n',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'Program.fs',
				lineNumber: 3,
				columnNumber: 5,
				severity: 'warning',
				message: 'FS0025: incomplete pattern matches'
			}
		]);
	});

	it('forwards C# compile requests to the dotnet worker', async () => {
		const sandbox = new Dotnet('CSHARP');
		const code = 'Console.WriteLine("hello");';

		await sandbox.load('/absproxy/5173');
		sandbox.write('7\n');
		await expect(sandbox.run(code, false, true, undefined, ['7'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: false,
				code,
				language: 'csharp',
				args: ['7'],
				stdin: '7\n',
				log: true
			})
		);
	});

	it('keeps C# execution in the worker when SharedArrayBuffer is available', async () => {
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('SharedArrayBuffer', class SharedArrayBuffer {});
		const sandbox = new Dotnet('CSHARP');

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('Console.WriteLine("hello");', false)).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				language: 'csharp'
			})
		);
	});

	it('forwards VB.NET compile requests to the dotnet worker', async () => {
		const sandbox = new Dotnet('VBNET');
		const code = `Imports System
Module Program
    Sub Main(args As String())
        Console.WriteLine("hello")
    End Sub
End Module`;

		await sandbox.load('/absproxy/5173');
		sandbox.write('7\n');
		await expect(sandbox.run(code, false, true, undefined, ['7'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: false,
				code,
				language: 'vbnet',
				args: ['7'],
				stdin: '7\n',
				log: true
			})
		);
	});

	it('rejects pre-aborted startup and execution without changing dotnet state', async () => {
		const sandbox = new Dotnet('CSHARP');
		const startupController = new AbortController();
		startupController.abort(null);
		sandbox.write('queued before abort\n');

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: startupController.signal })
		).rejects.toBeNull();
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.pendingInput).toEqual(['queued before abort\n']);
		expect(sandbox.uid).toBe(0);

		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const fallbackSignal = {
			aborted: true,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as AbortSignal;
		await expect(
			sandbox.run('Console.WriteLine("never dispatched");', false, true, undefined, [], {
				signal: fallbackSignal
			})
		).rejects.toMatchObject({
			name: 'AbortError',
			message: 'C# execution aborted'
		});
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(worker?.terminate).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual(['queued before abort\n']);
		expect(sandbox.uid).toBe(0);
		await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
	});

	it('aborts before scheduled worker startup can create a dotnet worker', async () => {
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		const reason = new Error('cancel dotnet before worker import');
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		const outcome = loading.catch((error) => error);

		controller.abort(reason);
		await expect(outcome).resolves.toBe(reason);
		await vi.dynamicImportSettled();
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.moduleUrl).toBe('');
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
	});

	it('aborts stalled worker startup and quarantines its stale readiness handler', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('cancel stalled dotnet startup');
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		const outcome = loading.catch((error) => error);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const staleHandler = worker?.onmessage;
		const registration = addEventListener.mock.calls.find(([type]) => type === 'abort');

		controller.abort(reason);
		await expect(outcome).resolves.toBe(reason);
		expect(removeEventListener).toHaveBeenCalledWith('abort', registration?.[1]);
		expect(worker?.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		suppressAutoLoadAck = false;
		const retry = sandbox.load('/absproxy/5173');
		await expect(retry).resolves.toBeUndefined();
		const replacement = workerInstances[1];
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacement);
		expect(replacement?.terminate).not.toHaveBeenCalled();
	});

	it('keeps the abort reason and replacement stdin when an output callback throws', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('abort dotnet output callback');
		const callbackError = new Error('throw after dotnet abort');
		sandbox.output = () => {
			controller.abort(reason);
			sandbox.write('fresh after abort\n');
			sandbox.eof();
			throw callbackError;
		};
		const running = sandbox.run('var input = Console.ReadLine();', false, true, undefined, [], {
			stdin: '',
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(2));
		const staleHandler = worker?.onmessage;
		sandbox.write('discard with explicit stdin\n');

		staleHandler?.({ data: { output: 'trigger abort\n' } } as MessageEvent<any>);
		await expect(outcome).resolves.toBe(reason);
		expect(worker?.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.pendingInput).toEqual(['fresh after abort\n']);
		expect(sandbox.pendingEof).toBe(true);

		sandbox.output = vi.fn();
		await sandbox.load('/absproxy/5173');
		const replacement = workerInstances[1];
		const retry = sandbox.run('var input = Console.ReadLine();', false);
		await vi.waitFor(() => expect(replacement?.postMessage).toHaveBeenCalledTimes(2));
		expect(replacement?.postMessage.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({ stdin: 'fresh after abort\n' })
		);
		const replacementHandler = replacement?.onmessage;
		staleHandler?.({ data: { results: true } } as MessageEvent<any>);
		expect(replacement?.onmessage).toBe(replacementHandler);
		replacement?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(retry).resolves.toBe(true);
	});

	it('removes settled dotnet listeners and keeps late aborts inert', async () => {
		const sandbox = new Dotnet('CSHARP');
		const loadController = new AbortController();
		const loadRemoveEventListener = vi.spyOn(loadController.signal, 'removeEventListener');
		await sandbox.load('/absproxy/5173', '', true, [], { signal: loadController.signal });
		const worker = workerInstances[0];
		expect(loadRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

		loadController.abort(new Error('late dotnet startup abort'));
		expect(worker?.terminate).not.toHaveBeenCalled();

		const runController = new AbortController();
		const runRemoveEventListener = vi.spyOn(runController.signal, 'removeEventListener');
		await sandbox.run('Console.WriteLine("done");', false, true, undefined, [], {
			signal: runController.signal
		});
		expect(runRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

		runController.abort(new Error('late dotnet execution abort'));
		expect(worker?.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
	});

	it('rejects run and load calls while worker startup remains active', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Dotnet('CSHARP');
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;

		await expect(sandbox.run('Console.WriteLine("hello");', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'CSHARP',
			recoverable: true
		});
		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'CSHARP',
			recoverable: true
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		worker.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
		suppressAutoLoadAck = false;
		await expect(sandbox.run('Console.WriteLine("hello");', false)).resolves.toBe(true);
	});

	it('releases the startup gate when a worker load callback throws', async () => {
		const sandbox = new Dotnet('CSHARP');
		const progressError = new Error('dotnet load progress failed');
		const progress = {
			set: vi.fn(() => {
				throw progressError;
			})
		};

		await expect(sandbox.load('/absproxy/5173', '', true, [], {}, progress)).rejects.toBe(
			progressError
		);
		expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('rejects overlapping and reentrant worker runs without replacing the handler', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		let reentrantRun: Promise<boolean | string> | undefined;
		sandbox.output = () => {
			reentrantRun = sandbox.run('Console.WriteLine("reentrant");', false);
		};
		const firstRun = sandbox.run('Console.WriteLine("first");', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const firstHandler = worker.onmessage;
		const firstUid = sandbox.uid;

		await expect(sandbox.run('Console.WriteLine("overlap");', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'CSHARP',
			recoverable: true
		});
		worker.onmessage?.({ data: { output: 'trigger reentry\n' } } as MessageEvent<any>);
		await expect(reentrantRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'CSHARP'
		});
		expect(worker.onmessage).toBe(firstHandler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(firstUid);
		expect(sandbox.exit).toBe(false);

		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);
		const retry = sandbox.run('Console.WriteLine("retry");', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3));
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(retry).resolves.toBe(true);
	});

	it('disposes the worker and releases its gate when an output callback throws', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		const outputError = new Error('dotnet output callback failed');
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		sandbox.output = () => {
			throw outputError;
		};

		const firstRun = sandbox.run('Console.WriteLine("first");', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const staleHandler = worker.onmessage;
		staleHandler?.({ data: { output: 'first output\n' } } as MessageEvent<any>);
		await expect(firstRun).rejects.toBe(outputError);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).toHaveBeenCalledOnce();

		sandbox.output = vi.fn();
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		const retry = sandbox.run('Console.WriteLine("retry");', false);
		const retryWorker = workerInstances[1];
		await vi.waitFor(() => expect(retryWorker?.postMessage).toHaveBeenCalledTimes(2));
		const retryHandler = retryWorker?.onmessage;
		staleHandler?.({ data: { results: true } } as MessageEvent<any>);
		await Promise.resolve();
		expect(retryWorker?.onmessage).toBe(retryHandler);
		expect(sandbox.exit).toBe(false);
		retryWorker?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(retry).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('collects stdin submitted immediately after a cached run starts', async () => {
		const sandbox = new Dotnet();
		const code = 'let input = System.Console.ReadLine()';

		await sandbox.load('/absproxy/5173');
		const runPromise = sandbox.run(code, false);
		await vi.dynamicImportSettled();
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		sandbox.write('9\n');
		await expect(runPromise).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: false,
				code,
				language: 'fsharp',
				stdin: '9\n'
			})
		);
	});

	it('runs non-stdin programs without waiting for terminal input', async () => {
		const sandbox = new Dotnet();
		const code = 'printfn "hello"';

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, false)).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: false,
				code,
				language: 'fsharp',
				stdin: ''
			})
		);
	});

	it('uses EOF to release console stdin waits without input text', async () => {
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';

		await sandbox.load('/absproxy/5173');
		const runPromise = sandbox.run(code, false);
		await vi.dynamicImportSettled();
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		sandbox.eof();
		await expect(runPromise).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: false,
				code,
				language: 'csharp',
				stdin: ''
			})
		);
	});

	it('isolates empty explicit stdin from worker terminal input', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		sandbox.write('stale\n');
		sandbox.eof();

		const explicitRun = sandbox.run(code, false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(2));
		const explicitMessage = worker?.postMessage.mock.calls[1]?.[0];
		expect(explicitMessage.stdin).toBe('');
		sandbox.write('during\n');
		sandbox.eof();

		worker?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(explicitRun).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);

		const bufferedRun = sandbox.run(code, false);
		await Promise.resolve();
		expect(worker?.postMessage).toHaveBeenCalledTimes(2);
		sandbox.write('fresh\n');
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(3));
		expect(worker?.postMessage.mock.calls[2]?.[0]).toEqual(
			expect.objectContaining({ stdin: 'fresh\n' })
		);
		worker?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(bufferedRun).resolves.toBe(true);
	});

	it('clears explicit worker stdin after execution and dispatch failures', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const workerError = new Error('dotnet worker execution failed');
		const failedRun = sandbox.run(code, false, true, undefined, [], {
			stdin: 'fixed\n'
		});
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(2));
		sandbox.write('discard after worker failure\n');
		sandbox.eof();

		worker?.onmessage?.({ data: { error: workerError } } as MessageEvent<any>);
		await expect(failedRun).rejects.toBe(workerError);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);

		const dispatchError = new Error('dotnet worker dispatch failed');
		runDispatchError = dispatchError;
		sandbox.write('stale before dispatch failure\n');
		sandbox.eof();
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).rejects.toBe(
			dispatchError
		);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		runDispatchError = undefined;
		suppressAutoRunAck = false;
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(worker?.terminate).not.toHaveBeenCalled();
	});

	it('clears an explicit worker stdin run on termination without stale cleanup', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';
		await sandbox.load('/absproxy/5173');
		const running = sandbox.run(code, false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(workerInstances[0]?.postMessage).toHaveBeenCalledTimes(2));
		sandbox.write('discard on terminate\n');
		sandbox.eof();

		sandbox.terminate();
		sandbox.write('fresh after terminate\n');

		await expect(running).rejects.toBe('Process terminated');
		expect(sandbox.pendingInput).toEqual(['fresh after terminate\n']);
		expect(sandbox.pendingEof).toBe(false);
		suppressAutoLoadAck = false;
		await sandbox.load('/absproxy/5173');
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run(code, false);
		await vi.waitFor(() => expect(replacementWorker?.postMessage).toHaveBeenCalledTimes(2));
		expect(replacementWorker?.postMessage.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({ stdin: 'fresh after terminate\n' })
		);
		replacementWorker?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(retry).resolves.toBe(true);
	});

	it('does not let a terminated worker stdin waiter consume replacement input', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';
		await sandbox.load('/absproxy/5173');
		const staleRun = sandbox.run(code, false);
		await vi.dynamicImportSettled();
		expect(workerInstances[0]?.postMessage).toHaveBeenCalledOnce();

		sandbox.terminate();
		sandbox.write('fresh after waiter termination\n');

		await expect(staleRun).rejects.toBe('Process terminated');
		expect(sandbox.pendingInput).toEqual(['fresh after waiter termination\n']);
		await sandbox.load('/absproxy/5173');
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run(code, false);
		await vi.waitFor(() => expect(replacementWorker?.postMessage).toHaveBeenCalledTimes(2));
		expect(replacementWorker?.postMessage.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({ stdin: 'fresh after waiter termination\n' })
		);
		replacementWorker?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(retry).resolves.toBe(true);
	});

	it('rejects reload while a worker stdin run remains active', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const activeRun = sandbox.run(code, false);
		await vi.dynamicImportSettled();
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		const runHandler = worker?.onmessage;
		const runUid = sandbox.uid;

		const reload = sandbox.load('/absproxy/5173');
		await expect(reload).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'CSHARP',
			recoverable: true
		});
		expect(sandbox.uid).toBe(runUid);
		expect(worker?.onmessage).toBe(runHandler);
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(worker?.terminate).not.toHaveBeenCalled();

		sandbox.write('input for active run\n');
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(2));
		expect(worker?.postMessage.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({ stdin: 'input for active run\n' })
		);
		worker?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(activeRun).resolves.toBe(true);
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
	});

	it('isolates explicit stdin on the main-thread dotnet runtime', async () => {
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
		const fixtureKey = '__wasm_idle_dotnet_explicit_stdin_fixture';
		let markExecutionStarted!: () => void;
		const executionStarted = new Promise<void>((resolve) => {
			markExecutionStarted = resolve;
		});
		let releaseExecution!: () => void;
		const executionGate = new Promise<void>((resolve) => {
			releaseExecution = resolve;
		});
		const compile = vi.fn(async () => ({ success: true, artifact: { id: 'fixture' } }));
		const execute = vi
			.fn()
			.mockImplementationOnce(async () => {
				markExecutionStarted();
				await executionGate;
				return { exitCode: 0, stdout: '', stderr: '' };
			})
			.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
		(globalThis as any)[fixtureKey] = { compile, execute };
		const moduleSource = `
const fixture = globalThis[${JSON.stringify(fixtureKey)}];
export function createDotnetCompiler() {
  return { compile: (request) => fixture.compile(request) };
}
export function executeBrowserDotnetArtifact(artifact, options) {
  return fixture.execute(artifact, options);
}
`;
		const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';

		try {
			await sandbox.load({ dotnet: { moduleUrl } });
			expect(workerInstances).toHaveLength(0);
			sandbox.write('stale\n');
			sandbox.eof();
			const explicitRun = sandbox.run(code, false, true, undefined, [], { stdin: '' });
			await executionStarted;
			expect(execute.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ stdin: '' }));
			await expect(sandbox.run(code, false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				phase: 'execute',
				runtimeId: 'CSHARP',
				recoverable: true
			});
			await expect(sandbox.load({ dotnet: { moduleUrl } })).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				phase: 'execute',
				runtimeId: 'CSHARP',
				recoverable: true
			});
			expect(execute).toHaveBeenCalledOnce();
			sandbox.write('during\n');
			sandbox.eof();
			releaseExecution();

			await expect(explicitRun).resolves.toBe(true);
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			const bufferedRun = sandbox.run(code, false);
			await Promise.resolve();
			expect(execute).toHaveBeenCalledOnce();
			sandbox.write('fresh\n');
			await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
			expect(execute.mock.calls[1]?.[1]).toEqual(
				expect.objectContaining({ stdin: 'fresh\n' })
			);
			await expect(bufferedRun).resolves.toBe(true);

			const staleRun = sandbox.run(code, false);
			await Promise.resolve();
			expect(execute).toHaveBeenCalledTimes(2);
			sandbox.terminate();
			sandbox.write('fresh after main-thread termination\n');
			await expect(staleRun).resolves.toBe(false);
			expect(sandbox.pendingInput).toEqual(['fresh after main-thread termination\n']);

			const retry = sandbox.run(code, false);
			await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
			expect(execute.mock.calls[2]?.[1]).toEqual(
				expect.objectContaining({ stdin: 'fresh after main-thread termination\n' })
			);
			await expect(retry).resolves.toBe(true);

			const activeReloadRun = sandbox.run(code, false);
			await Promise.resolve();
			expect(execute).toHaveBeenCalledTimes(3);
			const reload = sandbox.load({ dotnet: { moduleUrl } });
			await expect(reload).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				phase: 'execute',
				runtimeId: 'CSHARP',
				recoverable: true
			});
			expect(execute).toHaveBeenCalledTimes(3);
			sandbox.write('input for active main-thread run\n');
			await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
			expect(execute.mock.calls[3]?.[1]).toEqual(
				expect.objectContaining({ stdin: 'input for active main-thread run\n' })
			);
			await expect(activeReloadRun).resolves.toBe(true);
			await expect(sandbox.load({ dotnet: { moduleUrl } })).resolves.toBeUndefined();
		} finally {
			releaseExecution();
			delete (globalThis as any)[fixtureKey];
		}
	});

	it('releases the main-thread gate after compile failure and rejects output reentry', async () => {
		const sandbox = new Dotnet('CSHARP');
		const compileError = new Error('dotnet compiler failed synchronously');
		const compile = vi
			.fn()
			.mockImplementationOnce(() => {
				throw compileError;
			})
			.mockResolvedValue({ success: true, artifact: { id: 'retry-artifact' } });
		let reentrantLoad: Promise<void> | undefined;
		const execute = vi.fn(
			async (_artifact: unknown, options?: { stdout?: (output: string) => void }) => {
				options?.stdout?.('main-thread output\n');
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		);
		const runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.runtimeModule = runtimeModule;
		sandbox.compiler = { compile };
		sandbox.output = () => {
			reentrantLoad = sandbox.load('/absproxy/5173');
		};

		await expect(sandbox.run('Console.WriteLine("first");', false)).rejects.toBe(compileError);
		expect(sandbox.exit).toBe(true);
		await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'CSHARP'
		});
		expect(compile).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenCalledOnce();
		expect(sandbox.exit).toBe(true);
	});

	it('keeps the previous main-thread runtime when a replacement factory fails', async () => {
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
		const fixtureKey = '__wasm_idle_dotnet_factory_retry_fixture';
		const factoryError = new Error('dotnet compiler factory failed');
		const compileA = vi.fn(async () => ({ success: true, artifact: { id: 'runtime-a' } }));
		const compileB = vi.fn(async () => ({ success: true, artifact: { id: 'runtime-b' } }));
		const createA = vi.fn(() => ({ compile: compileA }));
		const createB = vi
			.fn()
			.mockImplementationOnce(() => {
				throw factoryError;
			})
			.mockReturnValue({ compile: compileB });
		(globalThis as any)[fixtureKey] = { createA, createB };
		const moduleSourceA = `
const fixture = globalThis[${JSON.stringify(fixtureKey)}];
export function createDotnetCompiler() {
	return fixture.createA();
}
export async function executeBrowserDotnetArtifact() {
	return { exitCode: 0, stdout: '', stderr: '' };
}
`;
		const moduleSourceB = `
const fixture = globalThis[${JSON.stringify(fixtureKey)}];
export function createDotnetCompiler() {
	return fixture.createB();
}
export async function executeBrowserDotnetArtifact() {
	return { exitCode: 0, stdout: '', stderr: '' };
}
`;
		const moduleUrlA = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSourceA)}`;
		const moduleUrlB = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSourceB)}`;
		const sandbox = new Dotnet('CSHARP');

		try {
			await expect(
				sandbox.load({ dotnet: { moduleUrl: moduleUrlA } })
			).resolves.toBeUndefined();
			await expect(sandbox.run('Console.WriteLine("runtime a");', true)).resolves.toBe(true);
			const runtimeA = sandbox.runtimeModule;
			const compilerA = sandbox.compiler;
			const artifactA = sandbox.compiledArtifact;
			const cacheKeyA = sandbox.compiledCacheKey;

			await expect(sandbox.load({ dotnet: { moduleUrl: moduleUrlB } })).rejects.toBe(
				factoryError.message
			);
			expect(sandbox.moduleUrl).toBe(moduleUrlA);
			expect(sandbox.runtimeModule).toBe(runtimeA);
			expect(sandbox.compiler).toBe(compilerA);
			expect(sandbox.compiledArtifact).toBe(artifactA);
			expect(sandbox.compiledCacheKey).toBe(cacheKeyA);

			await expect(
				sandbox.load({ dotnet: { moduleUrl: moduleUrlB } })
			).resolves.toBeUndefined();
			expect(sandbox.moduleUrl).toBe(moduleUrlB);
			expect(sandbox.runtimeModule).not.toBe(runtimeA);
			expect(sandbox.compiler).not.toBe(compilerA);
			expect(sandbox.compiledArtifact).toBeNull();
			expect(sandbox.compiledCacheKey).toBe('');
			expect(createA).toHaveBeenCalledOnce();
			expect(createB).toHaveBeenCalledTimes(2);
			expect(compileA).toHaveBeenCalledOnce();
			expect(compileB).not.toHaveBeenCalled();
		} finally {
			delete (globalThis as any)[fixtureKey];
		}
	});

	it('does not commit a main-thread runtime terminated during compiler creation', async () => {
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
		const fixtureKey = '__wasm_idle_dotnet_factory_terminate_fixture';
		const compile = vi.fn(async () => ({ success: true, artifact: { id: 'fixture' } }));
		const fixture = {
			terminateOnCreate: true,
			sandbox: null as Dotnet | null,
			create: vi.fn(() => {
				if (fixture.terminateOnCreate) fixture.sandbox?.terminate();
				return { compile };
			})
		};
		(globalThis as any)[fixtureKey] = fixture;
		const moduleSource = `
const fixture = globalThis[${JSON.stringify(fixtureKey)}];
export function createDotnetCompiler() {
	return fixture.create();
}
export async function executeBrowserDotnetArtifact() {
	return { exitCode: 0, stdout: '', stderr: '' };
}
`;
		const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
		const sandbox = new Dotnet('CSHARP');
		fixture.sandbox = sandbox;

		try {
			await expect(sandbox.load({ dotnet: { moduleUrl } })).rejects.toBe(
				'Process terminated'
			);
			expect(sandbox.moduleUrl).toBe('');
			expect(sandbox.runtimeModule).toBeNull();
			expect(sandbox.compiler).toBeNull();

			fixture.terminateOnCreate = false;
			await expect(sandbox.load({ dotnet: { moduleUrl } })).resolves.toBeUndefined();
			expect(sandbox.moduleUrl).toBe(moduleUrl);
			expect(sandbox.runtimeModule).not.toBeNull();
			expect(sandbox.compiler).not.toBeNull();
			expect(fixture.create).toHaveBeenCalledTimes(2);
		} finally {
			delete (globalThis as any)[fixtureKey];
		}
	});

	it('aborts main-thread startup during compiler creation without committing candidates', async () => {
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
		const fixtureKey = '__wasm_idle_dotnet_factory_abort_fixture';
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('abort dotnet compiler factory');
		const compile = vi.fn(async () => ({ success: true, artifact: { id: 'fixture' } }));
		const fixture = {
			abortOnCreate: true,
			create: vi.fn(() => {
				if (fixture.abortOnCreate) controller.abort(reason);
				return { compile };
			})
		};
		(globalThis as any)[fixtureKey] = fixture;
		const moduleSource = `
const fixture = globalThis[${JSON.stringify(fixtureKey)}];
export function createDotnetCompiler() {
	return fixture.create();
}
export async function executeBrowserDotnetArtifact() {
	return { exitCode: 0, stdout: '', stderr: '' };
}
`;
		const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
		const sandbox = new Dotnet('CSHARP');

		try {
			await expect(
				sandbox.load({ dotnet: { moduleUrl } }, '', true, [], { signal: controller.signal })
			).rejects.toBe(reason);
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.moduleUrl).toBe('');
			expect(sandbox.runtimeModule).toBeNull();
			expect(sandbox.compiler).toBeNull();

			fixture.abortOnCreate = false;
			await expect(sandbox.load({ dotnet: { moduleUrl } })).resolves.toBeUndefined();
			expect(sandbox.moduleUrl).toBe(moduleUrl);
			expect(sandbox.runtimeModule).not.toBeNull();
			expect(sandbox.compiler).not.toBeNull();
			expect(fixture.create).toHaveBeenCalledTimes(2);
		} finally {
			delete (globalThis as any)[fixtureKey];
		}
	});

	it('rejects main-thread compilation abort promptly but holds Busy until compile settles', async () => {
		const sandbox = new Dotnet('CSHARP');
		let markCompileStarted!: () => void;
		const compileStarted = new Promise<void>((resolve) => {
			markCompileStarted = resolve;
		});
		let releaseCompile!: () => void;
		const compileGate = new Promise<void>((resolve) => {
			releaseCompile = resolve;
		});
		const diagnostic = {
			fileName: 'Program.cs',
			lineNumber: 1,
			severity: 'warning' as const,
			message: 'late diagnostic'
		};
		const compile = vi
			.fn()
			.mockImplementationOnce(
				async (request: {
					onProgress?: (progress: { percent: number; stage: string }) => void;
				}) => {
					markCompileStarted();
					await compileGate;
					request.onProgress?.({ percent: 0.9, stage: 'late-compile' });
					return {
						success: true,
						artifact: { id: 'cancelled-artifact' },
						diagnostics: [diagnostic],
						logs: ['late log'],
						stdout: 'late stdout'
					};
				}
			)
			.mockResolvedValue({ success: true, artifact: { id: 'retry-artifact' } });
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const progress = { set: vi.fn() };
		const output = vi.fn();
		const oncompilerdiagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = oncompilerdiagnostic;
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('abort dotnet main-thread compile');
		const running = sandbox.run('Console.WriteLine("compile");', true, true, progress, [], {
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		await compileStarted;

		controller.abort(reason);
		await expect(outcome).resolves.toBe(reason);
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		await expect(sandbox.run('Console.WriteLine("busy");', true)).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute',
			runtimeId: 'CSHARP'
		});

		releaseCompile();
		await vi.waitFor(() => expect((sandbox as any).activeOperation).toBeNull());
		expect(progress.set).not.toHaveBeenCalled();
		expect(output).not.toHaveBeenCalled();
		expect(oncompilerdiagnostic).not.toHaveBeenCalled();
		expect(sandbox.compiledArtifact).toBeNull();
		expect(sandbox.compiledCacheKey).toBe('');
		await expect(sandbox.run('Console.WriteLine("compile");', true)).resolves.toBe(true);
		expect(compile).toHaveBeenCalledTimes(2);
		expect(execute).not.toHaveBeenCalled();
	});

	it('suppresses late main-thread execution output and preserves replacement stdin after abort', async () => {
		const sandbox = new Dotnet('CSHARP');
		const code = 'Console.WriteLine("execute");';
		const compile = vi.fn(async () => ({ success: true, artifact: { id: 'artifact' } }));
		let markExecutionStarted!: () => void;
		const executionStarted = new Promise<void>((resolve) => {
			markExecutionStarted = resolve;
		});
		let releaseExecution!: () => void;
		const executionGate = new Promise<void>((resolve) => {
			releaseExecution = resolve;
		});
		let cancelledOptions:
			| { stdin?: string; stdout?: (chunk: string) => void; stderr?: (chunk: string) => void }
			| undefined;
		const execute = vi
			.fn()
			.mockImplementationOnce(
				async (
					_artifact: unknown,
					options?: {
						stdin?: string;
						stdout?: (chunk: string) => void;
						stderr?: (chunk: string) => void;
					}
				) => {
					cancelledOptions = options;
					markExecutionStarted();
					await executionGate;
					return { exitCode: 0, stdout: '', stderr: '' };
				}
			)
			.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const output = vi.fn();
		sandbox.output = output;
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('abort dotnet main-thread execution');
		const running = sandbox.run(code, false, true, undefined, [], {
			stdin: '',
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		await executionStarted;

		controller.abort(reason);
		sandbox.write('fresh after main-thread abort\n');
		sandbox.eof();
		cancelledOptions?.stdout?.('late stdout');
		cancelledOptions?.stderr?.('late stderr');
		await expect(outcome).resolves.toBe(reason);
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(output).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual(['fresh after main-thread abort\n']);
		expect(sandbox.pendingEof).toBe(true);
		await expect(sandbox.run(code, false)).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute'
		});

		releaseExecution();
		await vi.waitFor(() => expect((sandbox as any).activeOperation).toBeNull());
		expect(sandbox.pendingInput).toEqual(['fresh after main-thread abort\n']);
		expect(sandbox.pendingEof).toBe(true);
		await expect(sandbox.run(code, false)).resolves.toBe(true);
		expect(execute.mock.calls[1]?.[1]).toEqual(
			expect.objectContaining({ stdin: 'fresh after main-thread abort\n' })
		);
		expect(compile).toHaveBeenCalledOnce();
	});

	it('wakes an aborted main-thread stdin waiter without consuming replacement input', async () => {
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';
		const compile = vi.fn(async () => ({ success: true, artifact: { id: 'artifact' } }));
		const execute = vi.fn(
			async (
				_artifact: unknown,
				_options?: {
					stdin?: string;
					stdout?: (chunk: string) => void;
					stderr?: (chunk: string) => void;
				}
			) => ({ exitCode: 0, stdout: '', stderr: '' })
		);
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const controller = new AbortController();
		const reason = new Error('abort dotnet main-thread stdin wait');
		const running = sandbox.run(code, false, true, undefined, [], {
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(execute).not.toHaveBeenCalled();

		controller.abort(reason);
		sandbox.write('replacement main-thread input\n');
		await expect(outcome).resolves.toBe(reason);
		await vi.waitFor(() => expect((sandbox as any).activeOperation).toBeNull());
		expect(sandbox.pendingInput).toEqual(['replacement main-thread input\n']);
		expect(execute).not.toHaveBeenCalled();

		await expect(sandbox.run(code, false)).resolves.toBe(true);
		expect(execute).toHaveBeenCalledOnce();
		expect(execute.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({ stdin: 'replacement main-thread input\n' })
		);
	});

	it('keeps a cancelled main-thread operation busy until compilation settles', async () => {
		const sandbox = new Dotnet('CSHARP');
		let markCompileStarted!: () => void;
		const compileStarted = new Promise<void>((resolve) => {
			markCompileStarted = resolve;
		});
		let releaseCompile!: () => void;
		const compileGate = new Promise<void>((resolve) => {
			releaseCompile = resolve;
		});
		const compile = vi.fn(async () => {
			markCompileStarted();
			await compileGate;
			return { success: true, artifact: { id: 'compiled' } };
		});
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };

		const running = sandbox.run('Console.WriteLine("cancelled");', true);
		await compileStarted;
		sandbox.terminate();
		await expect(sandbox.run('Console.WriteLine("busy");', true)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'CSHARP'
		});
		releaseCompile();
		await expect(running).resolves.toBe(false);
		await expect(sandbox.run('Console.WriteLine("retry");', true)).resolves.toBe(true);
		expect(compile).toHaveBeenCalledTimes(2);
		expect(execute).not.toHaveBeenCalled();
	});

	it('rejects invalid explicit stdin before changing worker state', async () => {
		const sandbox = new Dotnet();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		sandbox.write('queued\n');

		await expect(
			sandbox.run('printfn "hello"', false, true, undefined, [], {
				stdin: null as never
			})
		).rejects.toThrow('stdin must be a string');
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(sandbox.exit).toBe(true);
	});

	it('rejects load when no dotnet runtime urls are configured', async () => {
		publicEnv.PUBLIC_WASM_DOTNET_MODULE_URL = '';
		const sandbox = new Dotnet();

		await expect(sandbox.load({})).rejects.toContain('F# runtime is not configured');
	});

	it('rejects load when the dotnet worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Dotnet();
		const loadPromise = sandbox.load({
			dotnet: {
				moduleUrl: '/wasm-dotnet/index.js'
			}
		});
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/dotnet.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'F# worker script error: worker script error (/worker/dotnet.js:88:24)'
		);
	});
});
