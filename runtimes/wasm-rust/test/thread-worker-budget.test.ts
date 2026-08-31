import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	acquireThreadWorkerPermit,
	createBudgetedThreadWorker,
	createThreadWorkerBudgetBuffer,
	inspectThreadWorkerBudget
} from '../src/thread-worker-budget.js';

const mockedWorkerModulePaths = [
	'../src/module-worker.js',
	'../src/runtime-asset.js',
	'../src/runtime-asset-store.js',
	'../src/runtime-manifest.js',
	'../src/rustc-runtime.js'
] as const;

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	for (const modulePath of mockedWorkerModulePaths) {
		vi.doUnmock(modulePath);
	}
	await vi.resetModules();
});

describe('helper thread worker budget', () => {
	it('fails closed before a helper worker can exceed maxThreads', () => {
		const buffer = createThreadWorkerBudgetBuffer(2);
		const first = acquireThreadWorkerPermit(buffer);
		acquireThreadWorkerPermit(buffer);

		expect(inspectThreadWorkerBudget(buffer)).toEqual({ used: 2, limit: 2 });
		expect(() => acquireThreadWorkerPermit(buffer)).toThrow(
			'wasm-rust helper thread limit exhausted (maxThreads=2)'
		);

		first.release();
		expect(inspectThreadWorkerBudget(buffer)).toEqual({ used: 1, limit: 2 });
		expect(() => acquireThreadWorkerPermit(buffer)).not.toThrow();
	});

	it('makes permit rollback idempotent after worker construction fails', () => {
		const buffer = createThreadWorkerBudgetBuffer(1);
		const permit = acquireThreadWorkerPermit(buffer);

		permit.release();
		permit.release();

		expect(inspectThreadWorkerBudget(buffer)).toEqual({ used: 0, limit: 1 });
		expect(() => acquireThreadWorkerPermit(buffer)).not.toThrow();
	});

	it('checks the shared limit before constructing another worker', () => {
		const buffer = createThreadWorkerBudgetBuffer(2);
		let constructions = 0;
		const createWorker = () => ({ id: ++constructions });

		expect(createBudgetedThreadWorker(buffer, createWorker).worker).toEqual({ id: 1 });
		expect(createBudgetedThreadWorker(buffer, createWorker).worker).toEqual({ id: 2 });
		expect(() => createBudgetedThreadWorker(buffer, createWorker)).toThrow(
			'wasm-rust helper thread limit exhausted (maxThreads=2)'
		);
		expect(constructions).toBe(2);
	});

	it('rolls the permit back when the Worker constructor throws', () => {
		const buffer = createThreadWorkerBudgetBuffer(1);

		expect(() =>
			createBudgetedThreadWorker(buffer, () => {
				throw new Error('constructor failed');
			})
		).toThrow('constructor failed');
		expect(inspectThreadWorkerBudget(buffer)).toEqual({ used: 0, limit: 1 });
		expect(() => createBudgetedThreadWorker(buffer, () => ({ ready: true }))).not.toThrow();
	});

	it('rolls back a compiler pool permit when its worker dispatch fails', async () => {
		let compileMessageListener: ((event: MessageEvent<any>) => void) | undefined;
		let capturedBudgetBuffer: SharedArrayBuffer | undefined;
		const worker = {
			addEventListener: vi.fn(),
			terminate: vi.fn(),
			postMessage: vi.fn((message: { threadWorkerBudgetBuffer?: SharedArrayBuffer }) => {
				capturedBudgetBuffer = message.threadWorkerBudgetBuffer;
				throw new Error('compiler pool dispatch failed');
			})
		};
		const createModuleWorker = vi.fn(() => worker);
		const workerPostMessage = vi.fn();
		vi.stubGlobal('location', { href: 'https://example.test/compiler-worker.js' });
		vi.stubGlobal(
			'addEventListener',
			vi.fn((type: string, listener: (event: MessageEvent<any>) => void) => {
				if (type === 'message') compileMessageListener = listener;
			})
		);
		vi.stubGlobal('postMessage', workerPostMessage);
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		vi.doMock('../src/module-worker.js', () => ({ createModuleWorker }));
		vi.doMock('../src/runtime-asset.js', () => ({
			fetchRuntimeAssetBytes: vi.fn(async () => new Uint8Array([0]))
		}));
		vi.doMock('../src/runtime-asset-store.js', () => ({
			loadRuntimePackEntries: vi.fn()
		}));
		vi.doMock('../src/runtime-manifest.js', () => ({
			configureVerifiedRuntimeExecutableModuleUrls: vi.fn(),
			isIntegratedCompilerOutput: vi.fn(() => true),
			registerRuntimeManifestAssetReceipts: vi.fn(),
			resolveTargetManifest: vi.fn(() => ({
				targetTriple: 'wasm32-wasip1',
				artifactFormat: 'core-wasm',
				sysrootFiles: [],
				compile: { kind: 'integrated-rustc' },
				execution: { kind: 'preview1' }
			}))
		}));
		vi.doMock('../src/rustc-runtime.js', () => ({
			buildPreopenedDirectories: vi.fn(async () => ({
				fds: [],
				stdout: { getText: () => '' },
				stderr: { getText: () => '' }
			})),
			instantiateRustcInstance: vi.fn()
		}));

		await vi.resetModules();
		await import('../src/compiler-worker.js');
		expect(compileMessageListener).toBeTypeOf('function');

		compileMessageListener!({
			data: {
				type: 'compile',
				compilerWorkerUrl: 'https://example.test/compiler-worker.js',
				runtimeBaseUrl: 'https://example.test/runtime/',
				manifest: {
					compiler: {
						rustcWasm: 'rustc/rustc.wasm',
						compileTimeoutMs: 1_000,
						rustcMemory: { initialPages: 1, maximumPages: 1 }
					}
				},
				request: {
					code: 'fn main() {}',
					targetTriple: 'wasm32-wasip1',
					workerLimits: { maxWorkers: 1, maxThreads: 1 }
				},
				sharedBitcodeBuffer: new SharedArrayBuffer(16),
				sharedWorkspaceBuffer: new SharedArrayBuffer(16),
				sharedStatusBuffer: new SharedArrayBuffer(32)
			}
		} as MessageEvent<any>);

		await vi.waitFor(() =>
			expect(workerPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					message: 'compiler pool dispatch failed'
				})
			)
		);
		expect(createModuleWorker).toHaveBeenCalledOnce();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(capturedBudgetBuffer).toBeInstanceOf(SharedArrayBuffer);
		expect(inspectThreadWorkerBudget(capturedBudgetBuffer!)).toEqual({ used: 0, limit: 1 });
	});

	it('shares one recursive worker budget across dispatch rollback and exhaustion', async () => {
		let threadMessageListener: ((event: MessageEvent<any>) => void) | undefined;
		const workerPostMessage = vi.fn();
		const budgetBuffer = createThreadWorkerBudgetBuffer(2);
		acquireThreadWorkerPermit(budgetBuffer);
		const nestedMessages: any[] = [];
		const nestedWorkers: Array<{
			addEventListener: ReturnType<typeof vi.fn>;
			postMessage: ReturnType<typeof vi.fn>;
			terminate: ReturnType<typeof vi.fn>;
		}> = [];
		const createModuleWorker = vi.fn(() => {
			const workerIndex = nestedWorkers.length;
			const worker = {
				addEventListener: vi.fn(),
				terminate: vi.fn(),
				postMessage: vi.fn((message: any) => {
					nestedMessages.push(message);
					if (workerIndex === 0) throw new Error('recursive worker dispatch failed');
					const readyState = new Int32Array(message.readyBuffer);
					Atomics.store(readyState, 0, 3);
					Atomics.notify(readyState, 0);
				})
			};
			nestedWorkers.push(worker);
			return worker;
		});
		let dispatchFailure: unknown;
		let exhaustionFailure: unknown;
		const instantiateRustcInstance = vi.fn(
			(options: { threadSpawner: (arg: number) => number }) => {
				try {
					options.threadSpawner(11);
				} catch (error) {
					dispatchFailure = error;
				}
				options.threadSpawner(22);
				try {
					options.threadSpawner(33);
				} catch (error) {
					exhaustionFailure = error;
				}
				return {
					instance: {
						exports: { wasi_thread_start: vi.fn() }
					}
				};
			}
		);
		vi.stubGlobal('location', { href: 'https://example.test/rustc-thread-worker.js' });
		vi.stubGlobal(
			'addEventListener',
			vi.fn((type: string, listener: (event: MessageEvent<any>) => void) => {
				if (type === 'message') threadMessageListener = listener;
			})
		);
		vi.stubGlobal('postMessage', workerPostMessage);
		vi.doMock('../src/module-worker.js', () => ({ createModuleWorker }));
		vi.doMock('../src/rustc-runtime.js', () => ({
			buildPreopenedDirectories: vi.fn(async () => ({ fds: [] })),
			instantiateRustcInstance
		}));

		await vi.resetModules();
		await import('../src/rustc-thread-worker.js');
		expect(threadMessageListener).toBeTypeOf('function');
		const readyBuffer = new SharedArrayBuffer(4);
		threadMessageListener!({
			data: {
				type: 'thread-start',
				rustcThreadWorkerUrl: 'https://example.test/rustc-thread-worker.js',
				runtimeBaseUrl: 'https://example.test/runtime/',
				manifest: {},
				sourceCode: 'fn main() {}',
				log: false,
				sharedBitcodeBuffer: new SharedArrayBuffer(16),
				sharedWorkspaceBuffer: new SharedArrayBuffer(16),
				sharedStatusBuffer: new SharedArrayBuffer(32),
				threadCounterBuffer: new SharedArrayBuffer(4),
				sysrootAssets: [],
				rustcModule: {} as WebAssembly.Module,
				memory: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }),
				args: [],
				threadId: 1,
				startArg: 0,
				readyBuffer,
				threadWorkerBudgetBuffer: budgetBuffer
			}
		} as MessageEvent<any>);

		await vi.waitFor(() => expect(Atomics.load(new Int32Array(readyBuffer), 0)).toBe(3));
		expect(dispatchFailure).toMatchObject({ message: 'recursive worker dispatch failed' });
		expect(exhaustionFailure).toMatchObject({
			message: 'wasm-rust helper thread limit exhausted (maxThreads=2)'
		});
		expect(createModuleWorker).toHaveBeenCalledTimes(2);
		expect(nestedWorkers[0].terminate).toHaveBeenCalledOnce();
		expect(nestedWorkers[1].terminate).not.toHaveBeenCalled();
		expect(nestedMessages[1].threadWorkerBudgetBuffer).toBe(budgetBuffer);
		expect(inspectThreadWorkerBudget(budgetBuffer)).toEqual({ used: 2, limit: 2 });
	});

	it('rejects malformed shared descriptors', () => {
		expect(() => inspectThreadWorkerBudget(new SharedArrayBuffer(16))).toThrow(
			'wasm-rust helper thread budget descriptor is invalid'
		);
		expect(() => inspectThreadWorkerBudget(new SharedArrayBuffer(4))).toThrow(
			'wasm-rust helper thread budget buffer is invalid'
		);
	});
});
