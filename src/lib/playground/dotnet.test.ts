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

	it('does not let a worker stdin waiter superseded by load consume replacement input', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Dotnet('CSHARP');
		const code = 'var input = Console.ReadLine();';
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const staleRun = sandbox.run(code, false);
		await vi.dynamicImportSettled();
		expect(worker?.postMessage).toHaveBeenCalledOnce();

		const reload = sandbox.load('/absproxy/5173');
		sandbox.write('fresh after reload\n');

		await expect(staleRun).rejects.toBe('Worker operation superseded');
		await expect(reload).resolves.toBeUndefined();
		expect(sandbox.pendingInput).toEqual(['fresh after reload\n']);
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(worker?.terminate).toHaveBeenCalledOnce();
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run(code, false);
		await vi.waitFor(() => expect(replacementWorker?.postMessage).toHaveBeenCalledTimes(2));
		expect(replacementWorker?.postMessage.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({ stdin: 'fresh after reload\n' })
		);
		replacementWorker?.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(retry).resolves.toBe(true);
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

			const staleReloadRun = sandbox.run(code, false);
			await Promise.resolve();
			expect(execute).toHaveBeenCalledTimes(3);
			const reload = sandbox.load({ dotnet: { moduleUrl } });
			sandbox.write('fresh after main-thread reload\n');
			await expect(staleReloadRun).resolves.toBe(false);
			await expect(reload).resolves.toBeUndefined();
			expect(sandbox.pendingInput).toEqual(['fresh after main-thread reload\n']);

			const reloadRetry = sandbox.run(code, false);
			await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
			expect(execute.mock.calls[3]?.[1]).toEqual(
				expect.objectContaining({ stdin: 'fresh after main-thread reload\n' })
			);
			await expect(reloadRetry).resolves.toBe(true);
		} finally {
			releaseExecution();
			delete (globalThis as any)[fixtureKey];
		}
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
