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
		vi.useRealTimers();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_DOTNET_MODULE_URL = '/wasm-dotnet/index.js';
		suppressAutoLoadAck = false;
		suppressAutoRunAck = false;
		runDispatchError = undefined;
	});

	afterEach(() => {
		vi.useRealTimers();
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

	it.each([
		{
			name: 'traversal active path',
			code: 'A',
			options: { activePath: '../Program.cs' },
			expected: { code: 'invalid-path', path: '../Program.cs' }
		},
		{
			name: 'absolute active path',
			code: 'A',
			options: { activePath: '/tmp/Program.cs' },
			expected: { code: 'invalid-path', path: '/tmp/Program.cs' }
		},
		{
			name: 'null active path',
			code: 'A',
			options: { activePath: null as never },
			expected: { code: 'invalid-path', path: null }
		},
		{
			name: 'URL-style path',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'https://example.com/Helper.cs', content: 'B' }]
			},
			expected: { code: 'invalid-path', path: 'https://example.com/Helper.cs' }
		},
		{
			name: 'empty path segment',
			code: 'A',
			options: { workspaceFiles: [{ path: 'src//Helper.cs', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'src//Helper.cs' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { workspaceFiles: [{ path: 'bad\0.cs', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'bad\0.cs' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'src/Helper.cs', content: 'B' },
					{ path: 'src/Helper.cs', content: 'C' }
				]
			},
			expected: { code: 'duplicate-path', path: 'src/Helper.cs' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'SRC/Helper.cs', content: 'B' },
					{ path: 'src/Helper.cs', content: 'C' }
				]
			},
			expected: { code: 'case-collision', path: 'src/Helper.cs' }
		},
		{
			name: 'invalid file content',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'src/Helper.cs', content: null as never }]
			},
			expected: { code: 'invalid-content', path: 'src/Helper.cs' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'src/Helper.cs', content: 'B' }],
				workspaceLimits: { maxFiles: 1 }
			},
			expected: { code: 'file-count-limit', limit: 1, actual: 2 }
		},
		{
			name: 'active source overflow clamped to execution limits',
			code: '12345',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceLimits: { maxFileBytes: 100 }
			},
			expected: { code: 'file-size-limit', limit: 4, actual: 5 }
		},
		{
			name: 'active path byte overflow',
			code: 'A',
			options: { workspaceLimits: { maxPathBytes: 9 } },
			expected: { code: 'path-size-limit', path: 'Program.cs', limit: 9, actual: 10 }
		},
		{
			name: 'invalid infinite workspace limit',
			code: 'A',
			options: { workspaceLimits: { maxFileBytes: Number.POSITIVE_INFINITY } },
			expected: { code: 'invalid-limit' }
		},
		{
			name: 'invalid null workspace limit',
			code: 'A',
			options: { workspaceLimits: { maxFiles: null as never } },
			expected: { code: 'invalid-limit' }
		},
		{
			name: 'invalid case-sensitivity limit',
			code: 'A',
			options: { workspaceLimits: { caseSensitive: null as never } },
			expected: { code: 'invalid-limit' }
		},
		{
			name: 'aggregate overflow clamped to execution limits',
			code: '123',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceFiles: [{ path: 'src/Helper.cs', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a .NET workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Dotnet('CSHARP');
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker?.postMessage).toHaveBeenCalledOnce();
			expect(worker?.terminate).not.toHaveBeenCalled();
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);

			await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
			expect(worker?.postMessage).toHaveBeenCalledTimes(2);
		}
	);

	it('rejects a non-array .NET workspace before changing execution state', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		await expect(
			sandbox.run('Console.WriteLine("invalid");', false, true, undefined, [], {
				workspaceFiles: null as never
			})
		).rejects.toThrow('C# workspace files must be an array');
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(worker?.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
	});

	it('enforces .NET maxFiles before reading any workspace array element', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const workspaceFiles = new Array<{ path: string; content: string }>(2);
		let indexReads = 0;
		Object.defineProperty(workspaceFiles, 0, {
			configurable: true,
			get() {
				indexReads += 1;
				throw new Error('workspace index must not be read');
			}
		});

		await expect(
			sandbox.run('Console.WriteLine("bounded");', false, true, undefined, [], {
				workspaceFiles,
				workspaceLimits: { maxFiles: 1 }
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'file-count-limit',
			limit: 1,
			actual: 2
		});
		expect(indexReads).toBe(0);
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(worker?.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
	});

	it('rejects a non-object .NET workspace limit set before changing execution state', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		await expect(
			sandbox.run('Console.WriteLine("invalid");', false, true, undefined, [], {
				workspaceLimits: null as never
			})
		).rejects.toThrow('C# workspace limits must be an object');
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(worker?.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
	});

	it.each([false, true])(
		'rejects unsupported auxiliary .NET files instead of silently ignoring them (prepare=%s)',
		async (prepare) => {
			const sandbox = new Dotnet('CSHARP');
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			sandbox.write('queued before workspace rejection\n');

			await expect(
				sandbox.run('Console.WriteLine("main");', prepare, true, undefined, [], {
					activePath: 'src/Program.cs',
					workspaceFiles: [{ path: 'src/Helper.cs', content: 'class Helper {}' }]
				})
			).rejects.toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				phase: 'execute',
				runtimeId: 'CSHARP'
			});
			expect(worker?.postMessage).toHaveBeenCalledOnce();
			expect(worker?.terminate).not.toHaveBeenCalled();
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);
			expect(sandbox.pendingInput).toEqual(['queued before workspace rejection\n']);

			await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
		}
	);

	it.each([
		['FSHARP' as const, 'Program.fs', 'printfn "canonical"'],
		['CSHARP' as const, 'Program.cs', 'Console.WriteLine("canonical");'],
		[
			'VBNET' as const,
			'Program.vb',
			'Module Program\nSub Main()\nConsole.WriteLine("canonical")\nEnd Sub\nEnd Module'
		]
	])(
		'uses %s default active path %s as the authoritative source',
		async (language, path, code) => {
			const sandbox = new Dotnet(language);
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];

			await expect(
				sandbox.run(code, false, true, undefined, [], {
					workspaceFiles: [{ path, content: 'stale source' }],
					workspaceLimits: { maxFiles: 1 }
				})
			).resolves.toBe(true);
			expect(worker?.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ code })
			);
		}
	);

	it('accepts one canonical active .NET source without treating its stale copy as auxiliary', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const code = 'Console.WriteLine("canonical");';

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\Program.cs',
				workspaceFiles: [{ path: 'src/Program.cs', content: 'stale source' }],
				workspaceLimits: { maxFiles: 1 }
			})
		).resolves.toBe(true);
		expect(worker?.postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ code, language: 'csharp' })
		);
	});

	it('stops reading a .NET workspace file after its path getter replaces the owner', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const originalWorker = workerInstances[0];
		const reason = new Error('terminate dotnet workspace path snapshot');
		const laterFailure = new Error('late dotnet workspace content getter failure');
		let replacement: Promise<void> | undefined;
		let contentReads = 0;
		const workspaceFile = {} as { path: string; content: string };
		Object.defineProperty(workspaceFile, 'path', {
			configurable: true,
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				return 'src/Helper.cs';
			}
		});
		Object.defineProperty(workspaceFile, 'content', {
			configurable: true,
			get() {
				contentReads += 1;
				sandbox.terminate(laterFailure);
				throw laterFailure;
			}
		});

		await expect(
			sandbox.run('Console.WriteLine("snapshot");', false, true, undefined, [], {
				workspaceFiles: [workspaceFile]
			})
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(contentReads).toBe(0);
		expect(originalWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('stops reading .NET workspace limits after the first getter replaces the owner', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const originalWorker = workerInstances[0];
		const reason = new Error('terminate dotnet workspace limit snapshot');
		const laterFailure = new Error('late dotnet workspace limit getter failure');
		let replacement: Promise<void> | undefined;
		let laterReads = 0;
		const workspaceLimits = {} as {
			maxFiles: number;
			maxFileBytes: number;
		};
		Object.defineProperty(workspaceLimits, 'maxFiles', {
			configurable: true,
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				return 1;
			}
		});
		Object.defineProperty(workspaceLimits, 'maxFileBytes', {
			configurable: true,
			get() {
				laterReads += 1;
				sandbox.terminate(laterFailure);
				throw laterFailure;
			}
		});

		await expect(
			sandbox.run('Console.WriteLine("snapshot");', false, true, undefined, [], {
				workspaceLimits
			})
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(laterReads).toBe(0);
		expect(originalWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
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

	it('snapshots a pre-aborted reason once and preserves falsy values', async () => {
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		controller.abort(new Error('internal reason'));
		let reasonReads = 0;
		Object.defineProperty(controller.signal, 'reason', {
			configurable: true,
			get() {
				reasonReads += 1;
				return reasonReads === 1 ? false : new Error('replacement reason');
			}
		});

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(false);
		expect(reasonReads).toBe(1);
		expect(workerInstances).toHaveLength(0);
	});

	it('keeps a replacement load when the abort reason getter terminates its owner', async () => {
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		controller.abort(new Error('internal reason'));
		const reason = new Error('terminate dotnet reason snapshot');
		const laterFailure = new Error('late dotnet reason getter failure');
		let replacement: Promise<void> | undefined;
		Object.defineProperty(controller.signal, 'reason', {
			configurable: true,
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				throw laterFailure;
			}
		});

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0]?.terminate).not.toHaveBeenCalled();
	});

	it('preserves an abort raised before signal listener registration throws', async () => {
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		const reason = new Error('abort while binding dotnet signal');
		const laterFailure = new Error('dotnet listener registration failed afterward');
		vi.spyOn(controller.signal, 'addEventListener').mockImplementation(() => {
			controller.abort(reason);
			throw laterFailure;
		});

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(0);
	});

	it('does not inspect signal state after listener registration loses its owner', async () => {
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		const reason = new Error('terminate dotnet listener registration owner');
		let replacement: Promise<void> | undefined;
		let abortedReads = 0;
		vi.spyOn(controller.signal, 'addEventListener').mockImplementation(() => {
			sandbox.terminate(reason);
			replacement = sandbox.load('/absproxy/5173');
		});
		Object.defineProperty(controller.signal, 'aborted', {
			configurable: true,
			get() {
				abortedReads += 1;
				throw new Error('stale dotnet binding inspected signal state');
			}
		});

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(abortedReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0]?.terminate).not.toHaveBeenCalled();
	});

	it('preserves an abort raised while observing the bound signal state', async () => {
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		const reason = new Error('abort while observing dotnet signal');
		const laterFailure = new Error('dotnet aborted getter failed afterward');
		Object.defineProperty(controller.signal, 'aborted', {
			configurable: true,
			get() {
				controller.abort(reason);
				throw laterFailure;
			}
		});

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(0);
	});

	it('returns a rejected load promise when the signal getter throws', async () => {
		const sandbox = new Dotnet('CSHARP');
		const reason = new Error('dotnet signal getter failed');
		const options = {};
		Object.defineProperty(options, 'signal', {
			get() {
				throw reason;
			}
		});
		let loading: Promise<void> | undefined;

		expect(() => {
			loading = sandbox.load('/absproxy/5173', '', true, [], options);
		}).not.toThrow();
		await expect(loading).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(0);
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
		const loadAddEventListener = vi.spyOn(loadController.signal, 'addEventListener');
		const loadRemoveEventListener = vi.spyOn(loadController.signal, 'removeEventListener');
		await sandbox.load('/absproxy/5173', '', true, [], { signal: loadController.signal });
		const worker = workerInstances[0];
		expect(loadAddEventListener).toHaveBeenCalledTimes(1);
		expect(loadRemoveEventListener).toHaveBeenCalledTimes(1);
		expect(loadRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

		loadController.abort(new Error('late dotnet startup abort'));
		expect(worker?.terminate).not.toHaveBeenCalled();

		const runController = new AbortController();
		const runAddEventListener = vi.spyOn(runController.signal, 'addEventListener');
		const runRemoveEventListener = vi.spyOn(runController.signal, 'removeEventListener');
		await sandbox.run('Console.WriteLine("done");', false, true, undefined, [], {
			signal: runController.signal
		});
		expect(runAddEventListener).toHaveBeenCalledTimes(1);
		expect(runRemoveEventListener).toHaveBeenCalledTimes(1);
		expect(runRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

		runController.abort(new Error('late dotnet execution abort'));
		expect(worker?.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
	});

	it('settles startup before listener removal can abort and start a replacement', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Dotnet('CSHARP');
		const controller = new AbortController();
		const abortAtCleanup = new Error('abort during dotnet listener cleanup');
		const cleanupFailure = new Error('dotnet listener cleanup failed afterward');
		let replacement: Promise<void> | undefined;
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			controller.abort(abortAtCleanup);
			replacement = sandbox.load('/absproxy/5173');
			throw cleanupFailure;
		});
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker?.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
		expect(worker?.terminate).not.toHaveBeenCalled();
	});

	it('does not let termination cleanup retire a replacement worker', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const originalWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('terminate dotnet before listener cleanup');
		let replacement: Promise<void> | undefined;
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			replacement = sandbox.load('/absproxy/5173');
			throw new Error('dotnet termination listener cleanup failed');
		});
		const running = sandbox.run('Console.WriteLine("pending");', false, true, undefined, [], {
			signal: controller.signal
		});
		await vi.waitFor(() => expect(originalWorker?.postMessage).toHaveBeenCalledTimes(2));

		sandbox.terminate(reason);
		await expect(running).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(originalWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('enforces the aggregate dotnet startup deadline and ignores stale readiness', async () => {
		vi.useFakeTimers();
		suppressAutoLoadAck = true;
		const sandbox = new Dotnet('CSHARP');
		const progress = { set: vi.fn() };
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 } },
			progress
		);
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'CSHARP',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker?.onmessage;

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(progress.set).not.toHaveBeenCalled();
		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('times out main-thread startup without committing a late runtime module', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
		const fixtureKey = '__wasm_idle_dotnet_startup_timeout_fixture';
		let releaseImport!: () => void;
		const importGate = new Promise<void>((resolve) => {
			releaseImport = resolve;
		});
		(globalThis as any)[fixtureKey] = { importGate };
		const moduleSource = `
await globalThis[${JSON.stringify(fixtureKey)}].importGate;
export function createDotnetCompiler() {
	return { compile: async () => ({ success: true, artifact: {} }) };
}
export async function executeBrowserDotnetArtifact() {
	return { exitCode: 0, stdout: '', stderr: '' };
}
`;
		const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
		const sandbox = new Dotnet('CSHARP');

		try {
			const loading = sandbox.load({ dotnet: { moduleUrl } }, '', true, [], {
				limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
			});
			const rejected = expect(loading).rejects.toMatchObject({
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'startup',
				runtimeId: 'CSHARP',
				timeoutMs: 12
			});

			await vi.advanceTimersByTimeAsync(12);
			await rejected;
			expect(sandbox.moduleUrl).toBe('');
			expect(sandbox.runtimeModule).toBeNull();
			expect(sandbox.compiler).toBeNull();

			releaseImport();
			vi.useRealTimers();
			await vi.dynamicImportSettled();
			expect(sandbox.moduleUrl).toBe('');
			expect(sandbox.runtimeModule).toBeNull();
			await expect(sandbox.load({ dotnet: { moduleUrl } })).resolves.toBeUndefined();
			expect(sandbox.runtimeModule).not.toBeNull();
			expect(workerInstances).toHaveLength(0);
		} finally {
			releaseImport();
			delete (globalThis as any)[fixtureKey];
		}
	});

	it('enforces the aggregate dotnet execution deadline and permits a clean retry', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		suppressAutoRunAck = true;
		const output = vi.fn();
		const progress = { set: vi.fn() };
		sandbox.output = output;
		vi.useFakeTimers();
		const running = sandbox.run('Console.WriteLine("timeout");', false, true, progress, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'CSHARP',
			timeoutMs: 10
		});
		await Promise.resolve();
		const staleHandler = retiredWorker?.onmessage;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({
			data: { output: 'stale output', progress: 0.5, results: true }
		} as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
		suppressAutoRunAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('clears settled dotnet deadlines before they can retire an idle worker', async () => {
		vi.useFakeTimers();
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const worker = workerInstances[0];
		await expect(
			sandbox.run('Console.WriteLine("settled");', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);

		await vi.advanceTimersByTimeAsync(10);
		expect(worker?.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
	});

	it('rejects run and load calls while worker startup remains active', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Dotnet('CSHARP');
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;
		let signalReads = 0;
		const hostileOptions = {};
		Object.defineProperty(hostileOptions, 'signal', {
			get() {
				signalReads += 1;
				throw new Error('busy calls must not inspect their signal');
			}
		});

		await expect(
			sandbox.run('Console.WriteLine("hello");', false, true, undefined, [], hostileOptions)
		).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'CSHARP',
			recoverable: true
		});
		await expect(
			sandbox.load('/absproxy/5173', '', true, [], hostileOptions)
		).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'CSHARP',
			recoverable: true
		});
		expect(signalReads).toBe(0);
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

	it('keeps a replacement load when a runtime asset getter terminates the snapshot owner', async () => {
		const sandbox = new Dotnet('CSHARP');
		const reason = new Error('terminate dotnet runtime asset snapshot');
		const laterFailure = new Error('late dotnet module URL getter failure');
		let replacement: Promise<void> | undefined;
		const runtimeAssets = {};
		Object.defineProperty(runtimeAssets, 'dotnet', {
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				return {
					get moduleUrl() {
						throw laterFailure;
					}
				};
			}
		});

		await expect(sandbox.load(runtimeAssets)).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0]?.terminate).not.toHaveBeenCalled();
	});

	it('does not read startup limit fields after their snapshot owner is replaced', async () => {
		const sandbox = new Dotnet('CSHARP');
		const reason = new Error('terminate dotnet startup limits snapshot');
		const laterFailure = new Error('late dotnet startup limit property failure');
		let replacement: Promise<void> | undefined;
		let lateLimitReads = 0;
		const limits = {};
		Object.defineProperty(limits, 'assetTimeoutMs', {
			enumerable: true,
			get() {
				lateLimitReads += 1;
				sandbox.terminate(laterFailure);
				throw laterFailure;
			}
		});
		const options = {};
		Object.defineProperty(options, 'limits', {
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				return limits;
			}
		});

		await expect(sandbox.load('/absproxy/5173', '', true, [], options)).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(lateLimitReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0]?.terminate).not.toHaveBeenCalled();
	});

	it('keeps a replacement load when a program argument getter terminates a run snapshot', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const originalWorker = workerInstances[0];
		const reason = new Error('terminate dotnet argument snapshot');
		const laterFailure = new Error('late dotnet argument getter failure');
		let replacement: Promise<void> | undefined;
		const programArgs: string[] = [];
		Object.defineProperty(programArgs, '0', {
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				throw laterFailure;
			}
		});
		programArgs.length = 1;

		await expect(
			sandbox.run('Console.WriteLine("snapshot");', false, true, undefined, [], {
				programArgs
			})
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(originalWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('keeps a replacement load when the stdin getter terminates a run snapshot', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const originalWorker = workerInstances[0];
		const reason = new Error('terminate dotnet stdin snapshot');
		const laterFailure = new Error('late dotnet stdin getter failure');
		let replacement: Promise<void> | undefined;
		const options = {};
		Object.defineProperty(options, 'stdin', {
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				throw laterFailure;
			}
		});

		await expect(
			sandbox.run('Console.WriteLine("snapshot");', false, true, undefined, [], options)
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(originalWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('keeps a replacement load when the limits getter terminates a run snapshot', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const originalWorker = workerInstances[0];
		const reason = new Error('terminate dotnet limits snapshot');
		const laterFailure = new Error('late dotnet limit property failure');
		let replacement: Promise<void> | undefined;
		let lateLimitReads = 0;
		const limits = {};
		Object.defineProperty(limits, 'assetTimeoutMs', {
			enumerable: true,
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				return 5;
			}
		});
		Object.defineProperty(limits, 'startupTimeoutMs', {
			enumerable: true,
			get() {
				lateLimitReads += 1;
				sandbox.terminate(laterFailure);
				throw laterFailure;
			}
		});
		const options = { limits };

		await expect(
			sandbox.run('Console.WriteLine("snapshot");', false, true, undefined, [], options)
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(lateLimitReads).toBe(0);
		expect(originalWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('does not read a later callback slot after the output owner is replaced', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		const originalWorker = workerInstances[0];
		const reason = new Error('terminate dotnet output callback snapshot');
		const laterFailure = new Error('late dotnet diagnostic callback getter failure');
		let replacement: Promise<void> | undefined;
		let diagnosticReads = 0;
		Object.defineProperty(sandbox, 'output', {
			configurable: true,
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				return vi.fn();
			}
		});
		Object.defineProperty(sandbox, 'oncompilerdiagnostic', {
			configurable: true,
			get() {
				diagnosticReads += 1;
				sandbox.terminate(laterFailure);
				throw laterFailure;
			}
		});

		await expect(sandbox.run('Console.WriteLine("snapshot");', false)).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(diagnosticReads).toBe(0);
		expect(originalWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('keeps worker callbacks bound to the run that captured them', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];
		const firstOutput = vi.fn();
		const secondOutput = vi.fn();
		const firstDiagnostic = vi.fn();
		const secondDiagnostic = vi.fn();
		sandbox.output = firstOutput;
		sandbox.oncompilerdiagnostic = firstDiagnostic;
		const running = sandbox.run('Console.WriteLine("callbacks");', false);
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(2));
		const handler = worker?.onmessage;

		sandbox.output = secondOutput;
		sandbox.oncompilerdiagnostic = secondDiagnostic;
		handler?.({ data: { output: 'captured output\n' } } as MessageEvent<any>);
		handler?.({
			data: { diagnostic: { message: 'captured diagnostic' } }
		} as MessageEvent<any>);
		handler?.({ data: { results: true } } as MessageEvent<any>);

		await expect(running).resolves.toBe(true);
		expect(firstOutput).toHaveBeenCalledWith('captured output\n');
		expect(firstDiagnostic).toHaveBeenCalledWith({ message: 'captured diagnostic' });
		expect(firstOutput.mock.contexts).toEqual([sandbox]);
		expect(firstDiagnostic.mock.contexts).toEqual([sandbox]);
		expect(secondOutput).not.toHaveBeenCalled();
		expect(secondDiagnostic).not.toHaveBeenCalled();
	});

	it('treats false results and empty errors as terminal worker payloads', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		suppressAutoRunAck = true;
		const worker = workerInstances[0];

		const falseResult = sandbox.run('Console.WriteLine("false result");', false);
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(2));
		worker?.onmessage?.({ data: { results: false } } as MessageEvent<any>);
		await expect(falseResult).resolves.toBe(false);
		expect((sandbox as any).activeOperation).toBeNull();
		expect(sandbox.exit).toBe(true);

		const emptyError = sandbox.run('Console.WriteLine("empty error");', false);
		const rejected = expect(emptyError).rejects.toBe('');
		await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(3));
		worker?.onmessage?.({ data: { error: '' } } as MessageEvent<any>);
		await rejected;
		expect((sandbox as any).activeOperation).toBeNull();
		expect(sandbox.exit).toBe(true);
		expect(worker?.terminate).not.toHaveBeenCalled();

		suppressAutoRunAck = false;
		await expect(sandbox.run('Console.WriteLine("retry");', false)).resolves.toBe(true);
	});

	it('does not read irrelevant compile arguments for a dotnet execution', async () => {
		const sandbox = new Dotnet('CSHARP');
		await sandbox.load('/absproxy/5173');
		let compileArgReads = 0;
		const options = { stdin: '' };
		Object.defineProperty(options, 'compileArgs', {
			get() {
				compileArgReads += 1;
				throw new Error('dotnet does not consume compile arguments');
			}
		});

		await expect(
			sandbox.run('Console.WriteLine("snapshot");', false, true, undefined, ['one'], options)
		).resolves.toBe(true);
		expect(compileArgReads).toBe(0);
		expect(workerInstances[0]?.postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ args: ['one'], stdin: '' })
		);
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

	it('uses detached args and stdin after main-thread compilation yields', async () => {
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
			return { success: true, artifact: { id: 'snapshot-artifact' } };
		});
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const args = ['original-arg'];
		const options = { stdin: 'original-stdin' };
		const running = sandbox.run(
			'var input = Console.ReadLine();',
			false,
			true,
			undefined,
			args,
			options
		);
		await compileStarted;

		args[0] = 'mutated-arg';
		options.stdin = 'mutated-stdin';
		releaseCompile();

		await expect(running).resolves.toBe(true);
		expect(execute).toHaveBeenCalledWith(
			{ id: 'snapshot-artifact' },
			expect.objectContaining({ args: ['original-arg'], stdin: 'original-stdin' })
		);
	});

	it('preserves the main-thread cache and stdin when a workspace is rejected', async () => {
		const sandbox = new Dotnet('CSHARP');
		const artifact = { id: 'cached-before-workspace-rejection' };
		const compile = vi.fn(async () => ({ success: true, artifact }));
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		const compiler = { compile };
		const runtimeModule = {
			createDotnetCompiler: () => compiler,
			executeBrowserDotnetArtifact: execute
		};
		sandbox.runtimeModule = runtimeModule;
		sandbox.compiler = compiler;
		const code = 'Console.WriteLine("cache");';
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		const cacheKey = sandbox.compiledCacheKey;
		const uid = sandbox.uid;
		sandbox.write('queued before main-thread workspace rejection\n');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				workspaceFiles: [{ path: 'Helper.cs', content: 'class Helper {}' }]
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'execute',
			runtimeId: 'CSHARP'
		});
		expect(compile).toHaveBeenCalledOnce();
		expect(execute).not.toHaveBeenCalled();
		expect(sandbox.compiledArtifact).toBe(artifact);
		expect(sandbox.compiledCacheKey).toBe(cacheKey);
		expect(sandbox.compiledRuntimeModule).toBe(runtimeModule);
		expect(sandbox.compiledCompiler).toBe(compiler);
		expect(sandbox.compiledCompile).toBe(compile);
		expect(sandbox.compiledExecute).toBe(execute);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual(['queued before main-thread workspace rejection\n']);

		await expect(sandbox.run(code, false)).resolves.toBe(true);
		expect(compile).toHaveBeenCalledOnce();
		expect(execute).toHaveBeenCalledWith(
			artifact,
			expect.objectContaining({ stdin: 'queued before main-thread workspace rejection\n' })
		);
	});

	it('keeps main-thread backends and callbacks bound to their captured run', async () => {
		const sandbox = new Dotnet('CSHARP');
		let markCompileStarted!: () => void;
		const compileStarted = new Promise<void>((resolve) => {
			markCompileStarted = resolve;
		});
		let releaseCompile!: () => void;
		const compileGate = new Promise<void>((resolve) => {
			releaseCompile = resolve;
		});
		const diagnosticA = {
			lineNumber: 1,
			severity: 'warning' as const,
			message: 'runtime a diagnostic'
		};
		const diagnosticB = {
			lineNumber: 1,
			severity: 'warning' as const,
			message: 'runtime b diagnostic'
		};
		const compileA = vi.fn(async () => {
			markCompileStarted();
			await compileGate;
			return {
				success: true,
				artifact: { id: 'runtime-a-artifact' },
				diagnostics: [diagnosticA],
				logs: ['runtime a log']
			};
		});
		const compileB = vi.fn(async () => ({
			success: true,
			artifact: { id: 'runtime-b-artifact' },
			diagnostics: [diagnosticB],
			logs: ['runtime b log']
		}));
		const executeA = vi.fn(
			async (_artifact: unknown, options?: { stdout?: (output: string) => void }) => {
				options?.stdout?.('runtime a output\n');
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		);
		const executeB = vi.fn(
			async (_artifact: unknown, options?: { stdout?: (output: string) => void }) => {
				options?.stdout?.('runtime b output\n');
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		);
		const compilerA = { compile: compileA };
		const compilerB = { compile: compileB };
		const runtimeA = {
			createDotnetCompiler: () => compilerA,
			executeBrowserDotnetArtifact: executeA
		};
		const runtimeB = {
			createDotnetCompiler: () => compilerB,
			executeBrowserDotnetArtifact: executeB
		};
		const outputA = vi.fn();
		const outputB = vi.fn();
		const onDiagnosticA = vi.fn();
		const onDiagnosticB = vi.fn();
		sandbox.runtimeModule = runtimeA;
		sandbox.compiler = compilerA;
		sandbox.output = outputA;
		sandbox.oncompilerdiagnostic = onDiagnosticA;
		const code = 'Console.WriteLine("backend snapshot");';
		const running = sandbox.run(code, false, true, undefined, [], { stdin: '' });
		await compileStarted;

		sandbox.runtimeModule = runtimeB;
		sandbox.compiler = compilerB;
		sandbox.output = outputB;
		sandbox.oncompilerdiagnostic = onDiagnosticB;
		releaseCompile();

		await expect(running).resolves.toBe(true);
		expect(compileA).toHaveBeenCalledOnce();
		expect(executeA).toHaveBeenCalledWith({ id: 'runtime-a-artifact' }, expect.any(Object));
		expect(compileA.mock.contexts).toEqual([compilerA]);
		expect(executeA.mock.contexts).toEqual([runtimeA]);
		expect(compileB).not.toHaveBeenCalled();
		expect(executeB).not.toHaveBeenCalled();
		expect(outputA).toHaveBeenCalledWith('runtime a log\n');
		expect(outputA).toHaveBeenCalledWith('runtime a output\n');
		expect(onDiagnosticA).toHaveBeenCalledWith(diagnosticA);
		expect(outputA.mock.contexts.every((context) => context === sandbox)).toBe(true);
		expect(onDiagnosticA.mock.contexts).toEqual([sandbox]);
		expect(outputB).not.toHaveBeenCalled();
		expect(onDiagnosticB).not.toHaveBeenCalled();

		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(compileB).toHaveBeenCalledOnce();
		expect(executeB).toHaveBeenCalledWith({ id: 'runtime-b-artifact' }, expect.any(Object));
		expect(compileB.mock.contexts).toEqual([compilerB]);
		expect(executeB.mock.contexts).toEqual([runtimeB]);
		expect(outputB).toHaveBeenCalledWith('runtime b log\n');
		expect(outputB).toHaveBeenCalledWith('runtime b output\n');
		expect(onDiagnosticB).toHaveBeenCalledWith(diagnosticB);
		expect(outputB.mock.contexts.every((context) => context === sandbox)).toBe(true);
		expect(onDiagnosticB.mock.contexts).toEqual([sandbox]);
	});

	it('invalidates the main-thread cache when backend objects change independently', async () => {
		const sandbox = new Dotnet('CSHARP');
		const compileA = vi.fn(async () => ({
			success: true,
			artifact: { id: 'compiler-a-artifact' }
		}));
		const compileB = vi.fn(async () => ({
			success: true,
			artifact: { id: 'compiler-b-artifact' }
		}));
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		const compilerA = { compile: compileA };
		const compilerB = { compile: compileB };
		const runtimeA = {
			createDotnetCompiler: () => compilerA,
			executeBrowserDotnetArtifact: execute
		};
		const runtimeB = {
			createDotnetCompiler: () => compilerB,
			executeBrowserDotnetArtifact: execute
		};
		sandbox.runtimeModule = runtimeA;
		sandbox.compiler = compilerA;
		const code = 'Console.WriteLine("object identity");';

		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(compileA).toHaveBeenCalledOnce();

		sandbox.compiler = compilerB;
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(compileB).toHaveBeenCalledOnce();

		sandbox.runtimeModule = runtimeB;
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(compileB).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenCalledTimes(3);
	});

	it('invalidates the main-thread cache when captured backend methods change in place', async () => {
		const sandbox = new Dotnet('CSHARP');
		const compileA = vi.fn(async () => ({
			success: true,
			artifact: { id: 'compile-a-artifact' }
		}));
		const compileB = vi.fn(async () => ({
			success: true,
			artifact: { id: 'compile-b-artifact' }
		}));
		const executeA = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		const executeB = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		const compiler = { compile: compileA };
		const runtimeModule = {
			createDotnetCompiler: () => compiler,
			executeBrowserDotnetArtifact: executeA
		};
		sandbox.runtimeModule = runtimeModule;
		sandbox.compiler = compiler;
		const code = 'Console.WriteLine("method identity");';

		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(compileA).toHaveBeenCalledOnce();
		expect(executeA).toHaveBeenLastCalledWith({ id: 'compile-a-artifact' }, expect.any(Object));

		compiler.compile = compileB;
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(compileB).toHaveBeenCalledOnce();
		expect(executeA).toHaveBeenLastCalledWith({ id: 'compile-b-artifact' }, expect.any(Object));

		runtimeModule.executeBrowserDotnetArtifact = executeB;
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(compileB).toHaveBeenCalledTimes(2);
		expect(executeB).toHaveBeenCalledWith({ id: 'compile-b-artifact' }, expect.any(Object));
	});

	it('does not read a later main-thread method after its owner is replaced', async () => {
		const sandbox = new Dotnet('CSHARP');
		const reason = new Error('terminate dotnet backend method snapshot');
		const laterFailure = new Error('late dotnet execute getter failure');
		let replacement: Promise<void> | undefined;
		let executeReads = 0;
		const compiler = {} as { compile: (request: unknown) => Promise<unknown> };
		Object.defineProperty(compiler, 'compile', {
			configurable: true,
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/absproxy/5173');
				return vi.fn();
			}
		});
		const runtimeModule = {
			createDotnetCompiler: () => compiler
		} as {
			createDotnetCompiler: () => typeof compiler;
			executeBrowserDotnetArtifact: (
				artifact: unknown,
				options?: unknown
			) => Promise<unknown>;
		};
		Object.defineProperty(runtimeModule, 'executeBrowserDotnetArtifact', {
			configurable: true,
			get() {
				executeReads += 1;
				sandbox.terminate(laterFailure);
				throw laterFailure;
			}
		});
		sandbox.runtimeModule = runtimeModule as never;
		sandbox.compiler = compiler as never;

		await expect(sandbox.run('Console.WriteLine("snapshot");', false)).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(executeReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0]?.terminate).not.toHaveBeenCalled();
	});

	it('binds one signal listener across a main-thread execution', async () => {
		const sandbox = new Dotnet('CSHARP');
		const compile = vi.fn(async () => ({
			success: true,
			artifact: { id: 'single-listener-artifact' }
		}));
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		let abortedReads = 0;
		Object.defineProperty(controller.signal, 'aborted', {
			configurable: true,
			get() {
				abortedReads += 1;
				return false;
			}
		});

		await expect(
			sandbox.run('Console.WriteLine("single listener");', false, true, undefined, [], {
				signal: controller.signal
			})
		).resolves.toBe(true);
		expect(abortedReads).toBe(1);
		expect(addEventListener).toHaveBeenCalledTimes(1);
		expect(removeEventListener).toHaveBeenCalledTimes(1);
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

	it('rejects a main-thread execution deadline promptly but holds Busy until compile settles', async () => {
		vi.useFakeTimers();
		const sandbox = new Dotnet('CSHARP');
		let markCompileStarted!: () => void;
		const compileStarted = new Promise<void>((resolve) => {
			markCompileStarted = resolve;
		});
		let releaseCompile!: () => void;
		const compileGate = new Promise<void>((resolve) => {
			releaseCompile = resolve;
		});
		const compile = vi
			.fn()
			.mockImplementationOnce(async () => {
				markCompileStarted();
				await compileGate;
				return { success: true, artifact: { id: 'timed-out-artifact' } };
			})
			.mockResolvedValue({ success: true, artifact: { id: 'retry-artifact' } });
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const running = sandbox.run('Console.WriteLine("timeout");', true, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'CSHARP',
			timeoutMs: 10
		});
		await compileStarted;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		await expect(sandbox.run('Console.WriteLine("busy");', true)).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute',
			runtimeId: 'CSHARP'
		});

		vi.useRealTimers();
		releaseCompile();
		await vi.waitFor(() => expect((sandbox as any).activeOperation).toBeNull());
		expect(sandbox.compiledArtifact).toBeNull();
		expect(execute).not.toHaveBeenCalled();
		await expect(sandbox.run('Console.WriteLine("retry");', true)).resolves.toBe(true);
		expect(compile).toHaveBeenCalledTimes(2);
	});

	it('settles main-thread setup when timer registration terminates its owner', async () => {
		const sandbox = new Dotnet('CSHARP');
		const compile = vi.fn(async () => ({
			success: true,
			artifact: { id: 'timer-registration-artifact' }
		}));
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const reason = new Error('terminate dotnet timer registration owner');
		const timeoutHandle = 1_234_567;
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((() => {
			sandbox.terminate(reason);
			return timeoutHandle;
		}) as unknown as typeof setTimeout);
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

		await expect(sandbox.run('Console.WriteLine("never starts");', true)).rejects.toBe(reason);
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
		expect((sandbox as any).activeOperation).toBeNull();
		expect(compile).not.toHaveBeenCalled();

		setTimeoutSpy.mockRestore();
		clearTimeoutSpy.mockRestore();
		await expect(sandbox.run('Console.WriteLine("retry");', true)).resolves.toBe(true);
		expect(compile).toHaveBeenCalledOnce();
	});

	it('settles a main-thread abort when its reason getter terminates the operation', async () => {
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
			return { success: true, artifact: { id: 'reason-getter-artifact' } };
		});
		const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
		sandbox.runtimeModule = {
			createDotnetCompiler: () => ({ compile }),
			executeBrowserDotnetArtifact: execute
		};
		sandbox.compiler = { compile };
		const controller = new AbortController();
		const reason = new Error('terminate dotnet main-thread reason snapshot');
		const laterFailure = new Error('late dotnet main-thread reason getter failure');
		let reasonReads = 0;
		Object.defineProperty(controller.signal, 'reason', {
			configurable: true,
			get() {
				reasonReads += 1;
				sandbox.terminate(reason);
				throw laterFailure;
			}
		});
		const running = sandbox.run(
			'Console.WriteLine("reason getter");',
			true,
			true,
			undefined,
			[],
			{
				signal: controller.signal
			}
		);
		const outcome = running.catch((error) => error);
		await compileStarted;

		controller.abort(new Error('internal abort reason'));
		await expect(outcome).resolves.toBe(reason);
		expect(reasonReads).toBe(1);
		await expect(sandbox.run('Console.WriteLine("busy");', true)).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute',
			runtimeId: 'CSHARP'
		});

		releaseCompile();
		await vi.waitFor(() => expect((sandbox as any).activeOperation).toBeNull());
		expect(execute).not.toHaveBeenCalled();
		await expect(sandbox.run('Console.WriteLine("retry");', true)).resolves.toBe(true);
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
