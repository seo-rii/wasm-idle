import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_DOTNET_MODULE_URL: ''
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
