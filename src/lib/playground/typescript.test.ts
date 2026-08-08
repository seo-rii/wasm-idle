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
				workspaceFiles: [],
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

	describe.each([
		{ language: 'TYPESCRIPT' as const, extension: 'ts' },
		{ language: 'JAVASCRIPT' as const, extension: 'js' }
	])('$language workspace boundary', ({ language, extension }) => {
		it('normalizes valid paths before worker dispatch', async () => {
			const sandbox = new TypeScriptSandbox(language);
			await sandbox.load('/absproxy/5173');

			await expect(
				sandbox.run('main()', false, true, undefined, [], {
					activePath: `nested\\main.${extension}`,
					workspaceFiles: [
						{ path: `fixtures\\helper.${extension}`, content: 'export {}' }
					]
				})
			).resolves.toBe(true);

			expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					activePath: `nested/main.${extension}`,
					workspaceFiles: [{ path: `fixtures/helper.${extension}`, content: 'export {}' }]
				})
			);
		});

		it.each([
			{
				name: 'traversal path',
				code: 'A',
				options: { activePath: `../main.${extension}` },
				expected: { code: 'invalid-path', path: `../main.${extension}` }
			},
			{
				name: 'absolute path',
				code: 'A',
				options: { activePath: `/tmp/main.${extension}` },
				expected: { code: 'invalid-path', path: `/tmp/main.${extension}` }
			},
			{
				name: 'NUL path',
				code: 'A',
				options: { activePath: `bad\0.${extension}` },
				expected: { code: 'invalid-path', path: `bad\0.${extension}` }
			},
			{
				name: 'duplicate path',
				code: 'A',
				options: {
					workspaceFiles: [
						{ path: `data/module.${extension}`, content: 'A' },
						{ path: `data/module.${extension}`, content: 'B' }
					]
				},
				expected: { code: 'duplicate-path', path: `data/module.${extension}` }
			},
			{
				name: 'case-colliding path',
				code: 'A',
				options: {
					workspaceFiles: [
						{ path: `DATA/module.${extension}`, content: 'A' },
						{ path: `data/module.${extension}`, content: 'B' }
					]
				},
				expected: { code: 'case-collision', path: `data/module.${extension}` }
			},
			{
				name: 'file count overflow',
				code: 'A',
				options: {
					workspaceFiles: [{ path: `data/module.${extension}`, content: 'B' }],
					workspaceLimits: { maxFiles: 1 }
				},
				expected: { code: 'file-count-limit', limit: 1, actual: 2 }
			},
			{
				name: 'per-file overflow clamped to execution limits',
				code: '12345',
				options: {
					limits: { maxWorkspaceBytes: 4 },
					workspaceLimits: { maxFileBytes: 100 }
				},
				expected: { code: 'file-size-limit', limit: 4, actual: 5 }
			},
			{
				name: 'aggregate overflow clamped to execution limits',
				code: '123',
				options: {
					limits: { maxWorkspaceBytes: 4 },
					workspaceFiles: [{ path: `data/module.${extension}`, content: '45' }],
					workspaceLimits: { maxTotalBytes: 100 }
				},
				expected: { code: 'total-size-limit', limit: 4, actual: 5 }
			}
		])('rejects $name before changing execution state', async ({ code, options, expected }) => {
			const sandbox = new TypeScriptSandbox(language);
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledTimes(1);
			expect(worker.onmessage).toBe(loadHandler);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);
		});
	});

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'rejects an overlapping %s run without disturbing the active execution',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;

			const firstRun = sandbox.run('first()', false);
			const firstHandler = worker.onmessage;
			await expect(sandbox.run('second()', false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: language
			});

			expect(worker.postMessage).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBe(firstHandler);
			expect(worker.terminate).not.toHaveBeenCalled();

			firstHandler?.({ data: { results: true } } as MessageEvent<any>);
			await expect(firstRun).resolves.toBe(true);

			worker.postMessage.mockImplementationOnce(() => {
				queueMicrotask(() => {
					worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
				});
			});
			await expect(sandbox.run('retry()', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
		}
	);

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'rejects a pre-aborted %s run without changing worker state',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			const worker = new MockWorker();
			const originalHandler = vi.fn();
			worker.onmessage = originalHandler;
			sandbox.worker = worker as unknown as Worker;
			const controller = new AbortController();
			const reason = new Error(`${language} pre-aborted`);
			controller.abort(reason);

			await expect(
				sandbox.run('cancelled()', false, true, undefined, [], {
					signal: controller.signal
				})
			).rejects.toBe(reason);

			expect(worker.postMessage).not.toHaveBeenCalled();
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(worker.onmessage).toBe(originalHandler);
			expect(sandbox.worker).toBe(worker);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);

			await expect(sandbox.run('retry()', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledOnce();
		}
	);

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'aborts an active %s run with its exact reason and permits a clean retry',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			const outputs: string[] = [];
			sandbox.output = (chunk: string) => outputs.push(chunk);
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const reason = new Error(`${language} active abort`);

			const running = sandbox.run('pending()', false, true, undefined, [], {
				signal: controller.signal
			});
			const lateHandler = worker.onmessage;
			controller.abort(reason);

			await expect(running).rejects.toBe(reason);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.exit).toBe(true);

			lateHandler?.({
				data: { output: 'late\n', results: true }
			} as MessageEvent<any>);
			expect(outputs).toEqual([]);

			await sandbox.load('/absproxy/5173');
			const retryWorker = workerInstances.at(-1)!;
			const settledController = new AbortController();
			await expect(
				sandbox.run('retry()', false, true, undefined, [], {
					signal: settledController.signal
				})
			).resolves.toBe(true);
			expect(retryWorker.terminate).not.toHaveBeenCalled();

			settledController.abort(new Error('late abort'));
			expect(retryWorker.terminate).not.toHaveBeenCalled();
		}
	);

	it('rejects load when no wasm-typescript module url is configured', async () => {
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '';
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');

		await expect(sandbox.load({})).rejects.toContain('TypeScript runtime is not configured');
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

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'rejects a pre-aborted %s startup without changing an existing worker',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			worker.postMessage.mockClear();
			const progress = { set: vi.fn() };
			const controller = new AbortController();
			const reason = new Error(`${language} startup pre-aborted`);
			controller.abort(reason);

			await expect(
				sandbox.load(
					'/absproxy/5173',
					'',
					true,
					[],
					{ signal: controller.signal },
					progress
				)
			).rejects.toBe(reason);

			expect(sandbox.worker).toBe(worker);
			expect(worker.postMessage).not.toHaveBeenCalled();
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(progress.set).not.toHaveBeenCalled();
		}
	);

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'aborts an active %s startup and ignores stale completion',
		async (language) => {
			suppressAutoLoadAck = true;
			const sandbox = new TypeScriptSandbox(language);
			const progress = { set: vi.fn() };
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const reason = new Error(`${language} startup aborted`);
			const loading = sandbox.load(
				'/absproxy/5173',
				'',
				true,
				[],
				{ signal: controller.signal },
				progress
			);
			await vi.dynamicImportSettled();
			const worker = workerInstances[0];
			const staleHandler = worker.onmessage;

			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: language
			});
			await expect(sandbox.run('tooSoon()', false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: language
			});
			expect(worker.postMessage).toHaveBeenCalledOnce();

			controller.abort(reason);
			await expect(loading).rejects.toBe(reason);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();

			staleHandler?.({ data: { load: true } } as MessageEvent<any>);
			expect(progress.set).not.toHaveBeenCalled();

			suppressAutoLoadAck = false;
			const settledController = new AbortController();
			await sandbox.load('/absproxy/5173', '', true, [], {
				signal: settledController.signal
			});
			const retryWorker = workerInstances.at(-1)!;
			expect(retryWorker.terminate).not.toHaveBeenCalled();

			settledController.abort(new Error('late startup abort'));
			expect(retryWorker.terminate).not.toHaveBeenCalled();
		}
	);

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'retires the %s worker when the ready progress callback throws',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			const callbackError = new Error(`${language} startup progress failed`);
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

			await expect(
				sandbox.load(
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
				)
			).rejects.toBe(callbackError);

			expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();
			controller.abort(new Error('late failed startup abort'));

			await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
			expect(workerInstances).toHaveLength(2);
		}
	);

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'keeps the active %s operation while callbacks attempt reentrant work',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			let reentrantRun: Promise<boolean | string> | undefined;
			let reentrantLoad: Promise<void> | undefined;
			sandbox.output = () => {
				reentrantRun = sandbox.run('reentrant()', false);
				reentrantLoad = sandbox.load('/replacement/');
			};

			const running = sandbox.run('first()', false);
			const handler = worker.onmessage;
			handler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>);

			await expect(reentrantRun).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: language
			});
			await expect(reentrantLoad).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: language
			});
			await expect(running).resolves.toBe(true);
			expect(worker.onmessage).toBeNull();
			expect(worker.terminate).not.toHaveBeenCalled();
		}
	);

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'preserves a replacement after a %s callback terminates and throws',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			worker.postMessage.mockImplementation(() => undefined);
			const controller = new AbortController();
			const abortReason = new Error(`${language} callback abort`);
			const callbackError = new Error(`${language} callback throw after abort`);
			let replacement: Promise<void> | undefined;
			sandbox.output = () => {
				controller.abort(abortReason);
				replacement = sandbox.load('/replacement/');
				throw callbackError;
			};
			const running = sandbox.run('first()', false, true, undefined, [], {
				stdin: 'fixed\n',
				signal: controller.signal
			});
			const outcome = running.catch((error) => error);
			const staleHandler = worker.onmessage;

			expect(() =>
				staleHandler?.({
					data: { output: 'trigger\n', results: true }
				} as MessageEvent<any>)
			).not.toThrow();
			await expect(outcome).resolves.toBe(abortReason);
			await expect(replacement).resolves.toBeUndefined();
			const replacementWorker = workerInstances[1];
			const replacementHandler = replacementWorker.onmessage;
			sandbox.write('replacement input\n');
			sandbox.eof();

			staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
			expect(sandbox.worker).toBe(replacementWorker);
			expect(replacementWorker.onmessage).toBe(replacementHandler);
			expect(sandbox.pendingInput).toEqual(['replacement input\n']);
			expect(sandbox.pendingEof).toBe(true);
		}
	);

	it.each([
		{ language: 'TYPESCRIPT' as const, callbackKind: 'progress' as const },
		{ language: 'TYPESCRIPT' as const, callbackKind: 'output' as const },
		{ language: 'TYPESCRIPT' as const, callbackKind: 'diagnostic' as const },
		{ language: 'JAVASCRIPT' as const, callbackKind: 'progress' as const },
		{ language: 'JAVASCRIPT' as const, callbackKind: 'output' as const },
		{ language: 'JAVASCRIPT' as const, callbackKind: 'diagnostic' as const }
	])(
		'rejects and retires the $language worker when a $callbackKind callback throws',
		async ({ language, callbackKind }) => {
			const sandbox = new TypeScriptSandbox(language);
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			const callbackError = new Error(`${language} ${callbackKind} callback failed`);
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const progress = {
				set: vi.fn(() => {
					if (callbackKind === 'progress') throw callbackError;
				})
			};
			const output = vi.fn(() => {
				if (callbackKind === 'output') throw callbackError;
			});
			const diagnostic = vi.fn(() => {
				if (callbackKind === 'diagnostic') throw callbackError;
			});
			sandbox.output = output;
			sandbox.oncompilerdiagnostic = diagnostic;

			const running = sandbox.run('first()', false, true, progress, [], {
				stdin: 'fixed\n',
				signal: controller.signal
			});
			const handler = worker.onmessage;
			sandbox.write('discard after explicit stdin\n');
			expect(() =>
				handler?.({
					data: {
						progress: 0.5,
						output: 'callback output\n',
						diagnostic: { message: 'callback diagnostic' },
						results: true
					}
				} as MessageEvent<any>)
			).not.toThrow();

			await expect(running).rejects.toBe(callbackError);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBeNull();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			if (callbackKind === 'progress') {
				expect(output).not.toHaveBeenCalled();
				expect(diagnostic).not.toHaveBeenCalled();
			} else if (callbackKind === 'output') {
				expect(diagnostic).not.toHaveBeenCalled();
			}

			handler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
			sandbox.output = vi.fn();
			sandbox.oncompilerdiagnostic = vi.fn();
			await sandbox.load('/absproxy/5173');
			await expect(sandbox.run('retry()', false)).resolves.toBe(true);
			expect(workerInstances.at(-1)).not.toBe(worker);
		}
	);

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

	it('passes injected stdin to the worker', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run('console.log(1)', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);

		expect(runMessage.stdin).toBe('injected\n');
	});

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'does not stream terminal input into an explicit %s stdin run',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;

			const running = sandbox.run('first()', false, true, undefined, [], {
				stdin: 'authoritative\n'
			});
			const handler = worker.onmessage;
			sandbox.write('terminal input\n');
			handler?.({ data: { buffer: true } } as MessageEvent<any>);

			expect(readBufferedStdin(sandbox.buffer)).toBe('');
			expect(sandbox.pendingInput).toEqual(['terminal input\n']);
			handler?.({ data: { results: true } } as MessageEvent<any>);
			await expect(running).resolves.toBe(true);
			expect(sandbox.pendingInput).toEqual([]);
		}
	);

	it.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
		'clears queued input before an explicit %s stdin run',
		async (language) => {
			const sandbox = new TypeScriptSandbox(language);
			const worker = new MockWorker();
			const runMessages: any[] = [];
			const bufferedValues: Array<string | null> = [];

			sandbox.worker = worker as unknown as Worker;
			worker.postMessage.mockImplementation((message) => {
				runMessages.push(message);
				queueMicrotask(() => {
					worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
					bufferedValues.push(readBufferedStdin(message.buffer));
					if (runMessages.length === 1) {
						sandbox.write('during\n');
						sandbox.eof();
					}
					worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
				});
			});
			sandbox.write('stale\n');
			sandbox.eof();

			await expect(
				sandbox.run('explicit()', false, true, undefined, [], {
					stdin: 'injected\n'
				})
			).resolves.toBe(true);
			await expect(sandbox.run('buffered()', false)).resolves.toBe(true);

			expect(runMessages).toHaveLength(2);
			expect(runMessages[0].stdin).toBe('injected\n');
			expect(runMessages[1].stdin).toBeUndefined();
			expect(bufferedValues).toEqual(['', '']);
		}
	);
});
