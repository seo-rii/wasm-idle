import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_ELIXIR_BUNDLE_URL: '',
		PUBLIC_WASM_ERLANG_BUNDLE_URL: ''
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
			queueMicrotask(() =>
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() => {
			this.onmessage?.({
				data: { output: 'factorial_plus_bonus=27\n' }
			} as MessageEvent<any>);
			this.onmessage?.({ data: { results: ':ok' } } as MessageEvent<any>);
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/elixir?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Elixir from './elixir';
import { readBufferedStdin } from './stdinBuffer';
import { WASM_ELIXIR_ASSET_RECEIPTS } from './wasmElixirVersion';

describe('Elixir sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_ELIXIR_BUNDLE_URL = '';
		publicEnv.PUBLIC_WASM_ERLANG_BUNDLE_URL = '';
		suppressAutoLoadAck = false;
		history.replaceState({}, '', '/editor');
	});

	it('loads the elixir worker once, preserves it across prepare, and prints the evaluated result', async () => {
		const sandbox = new Elixir();
		const output = vi.fn();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		sandbox.output = output;

		await sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			},
			'IO.puts("hello")',
			true,
			[],
			{ signal: controller.signal },
			progress
		);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				bundleUrl: expect.stringMatching(/\/runtime\/elixir\/bundle\.avm$/),
				assetReceipts: WASM_ELIXIR_ASSET_RECEIPTS,
				log: true
			})
		);
		expect(progress.set).toHaveBeenCalledWith(1);
		const abortRegistrations = addEventListener.mock.calls.filter(
			(registration: unknown[]) => registration[0] === 'abort'
		);
		expect(abortRegistrations).toHaveLength(1);
		for (const registration of abortRegistrations) {
			expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
		}
		controller.abort(new Error('late successful Elixir load abort'));
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();

		await expect(sandbox.run('IO.puts("hello")', true, true, progress)).resolves.toBe(true);
		await sandbox.clear();
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();

		await sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			},
			'IO.puts("hello")'
		);
		expect(workerInstances).toHaveLength(1);

		await expect(
			sandbox.run('IO.puts("hello")', false, true, undefined, [], {
				stdin: 'hello from stdin\n'
			})
		).resolves.toBe(':ok');
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(2, {
			code: 'IO.puts("hello")',
			prepare: true,
			buffer: expect.any(SharedArrayBuffer),
			language: 'ELIXIR',
			log: true,
			stdin: undefined
		});
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(3, {
			code: 'IO.puts("hello")',
			prepare: false,
			buffer: expect.any(SharedArrayBuffer),
			language: 'ELIXIR',
			log: true,
			stdin: 'hello from stdin\n'
		});
		expect(output).toHaveBeenCalledWith('factorial_plus_bonus=27\n');
		expect(output).toHaveBeenCalledWith('=> :ok\n');

		await sandbox.clear();
		expect(workerInstances[0].terminate).toHaveBeenCalledTimes(1);
	});

	it('loads Erlang through the shared Popcorn worker and marks run messages as Erlang', async () => {
		const sandbox = new Elixir('ERLANG');
		const progress = { set: vi.fn() };

		await sandbox.load(
			{
				erlang: {
					bundleUrl: '/runtime/erlang/bundle.avm'
				}
			},
			'io:format("hello~n").',
			true,
			[],
			{},
			progress
		);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				bundleUrl: expect.stringMatching(/\/runtime\/erlang\/bundle\.avm$/),
				assetReceipts: WASM_ELIXIR_ASSET_RECEIPTS,
				log: true
			})
		);

		await expect(sandbox.run('io:format("hello~n").', false)).resolves.toBe(':ok');
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(2, {
			code: 'io:format("hello~n").',
			prepare: false,
			buffer: expect.any(SharedArrayBuffer),
			language: 'ERLANG',
			log: true
		});
	});

	it('snapshots custom receipts and replaces the worker when the trust root changes', async () => {
		const sandbox = new Elixir();
		const firstBundleReceipt = {
			...WASM_ELIXIR_ASSET_RECEIPTS['bundle.avm'],
			uncompressedSha256: 'a'.repeat(64)
		};
		const firstIntegrity = {
			...WASM_ELIXIR_ASSET_RECEIPTS,
			'bundle.avm': firstBundleReceipt
		};

		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm',
				integrity: firstIntegrity
			}
		});
		const firstWorker = workerInstances[0];
		const firstMessage = firstWorker.postMessage.mock.calls[0]?.[0];
		firstBundleReceipt.uncompressedSha256 = 'b'.repeat(64);

		expect(firstMessage.assetReceipts['bundle.avm'].uncompressedSha256).toBe('a'.repeat(64));
		expect(firstMessage.assetReceipts).not.toBe(firstIntegrity);
		expect(Object.isFrozen(firstMessage.assetReceipts)).toBe(true);

		const replacementIntegrity = {
			...WASM_ELIXIR_ASSET_RECEIPTS,
			'bundle.avm': {
				...WASM_ELIXIR_ASSET_RECEIPTS['bundle.avm'],
				uncompressedSha256: 'c'.repeat(64)
			}
		};
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm',
				integrity: replacementIntegrity
			}
		});

		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ assetReceipts: replacementIntegrity })
		);
	});

	it('rejects malformed receipts before creating a worker', async () => {
		const sandbox = new Elixir();

		await expect(
			sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm',
					integrity: {
						'bundle.avm': WASM_ELIXIR_ASSET_RECEIPTS['bundle.avm']
					} as never
				}
			})
		).rejects.toThrow('requires exactly three asset receipts');
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects load when no Elixir bundle is configured', async () => {
		const sandbox = new Elixir();

		await expect(sandbox.load({})).rejects.toBe(
			'Elixir runtime is not configured. Set PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl.'
		);
		expect(workerInstances).toHaveLength(0);
	});

	it('rejects load when the Elixir worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Elixir();
		const loadPromise = sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/elixir.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Elixir worker script error: worker script error (/worker/elixir.js:88:24)'
		);
	});

	it('does not create an Elixir worker for a pre-aborted load', async () => {
		const sandbox = new Elixir();
		const controller = new AbortController();
		const reason = new Error('stop before Elixir startup');
		const progress = { set: vi.fn() };
		controller.abort(reason);

		await expect(
			sandbox.load(
				{
					elixir: {
						bundleUrl: '/runtime/elixir/bundle.avm'
					}
				},
				'',
				true,
				[],
				{ signal: controller.signal },
				progress
			)
		).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(0);
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('owns the Elixir worker before startup progress can abort the load', async () => {
		const sandbox = new Elixir();
		const controller = new AbortController();
		const reason = new Error('stop from Elixir startup progress');
		const progress = {
			set: vi.fn((value: number) => {
				if (value === 0.5) controller.abort(reason);
			})
		};

		try {
			await expect(
				sandbox.load(
					{
						elixir: {
							bundleUrl: '/runtime/elixir/bundle.avm'
						}
					},
					'',
					true,
					[],
					{ signal: controller.signal },
					progress
				)
			).rejects.toBe(reason);

			expect(workerInstances).toHaveLength(1);
			expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
			expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		} finally {
			sandbox.terminate();
		}
	});

	it('rejects startup when the ready progress callback throws and permits a clean retry', async () => {
		const sandbox = new Elixir();
		const callbackError = new Error('Elixir ready progress failed');
		const progress = {
			set: vi.fn((value: number) => {
				if (value === 1) throw callbackError;
			})
		};

		await expect(
			sandbox.load(
				{
					elixir: {
						bundleUrl: '/runtime/elixir/bundle.avm'
					}
				},
				'',
				true,
				[],
				{},
				progress
			)
		).rejects.toBe(callbackError);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		await expect(
			sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			})
		).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('aborts a stalled Elixir worker load and permits a clean retry', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Elixir();
		const controller = new AbortController();
		const reason = new Error('stop active Elixir startup');
		const progress = { set: vi.fn() };
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loadPromise = sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			},
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const lateHandler = worker.onmessage;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			controller.abort(reason);
			const outcome = await Promise.race([
				loadPromise.then(
					() => ({ status: 'resolved' as const }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'rejected', reason });
			expect(worker.terminate).toHaveBeenCalledOnce();
			const abortRegistrations = addEventListener.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(abortRegistrations).toHaveLength(1);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}

			lateHandler?.({ data: { load: true } } as MessageEvent<any>);
			expect(progress.set).not.toHaveBeenCalledWith(1);

			suppressAutoLoadAck = false;
			await expect(
				sandbox.load({
					elixir: {
						bundleUrl: '/runtime/elixir/bundle.avm'
					}
				})
			).resolves.toBeUndefined();
			expect(workerInstances).toHaveLength(2);
		} finally {
			if (timeout) clearTimeout(timeout);
			sandbox.terminate();
			await loadPromise.catch(() => {});
		}
	});

	it('rejects operations that overlap a pending Elixir load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Elixir();
		const firstLoad = sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;
		const bundleUrl = sandbox.bundleUrl;

		try {
			await expect(
				sandbox.load({
					elixir: {
						bundleUrl: '/runtime/elixir/other.avm'
					}
				})
			).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'ELIXIR',
				phase: 'startup'
			});
			await expect(sandbox.run('IO.puts("busy")', false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'ELIXIR',
				phase: 'startup'
			});
			expect(workerInstances).toHaveLength(1);
			expect(worker.postMessage).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBe(loadHandler);
			expect(sandbox.bundleUrl).toBe(bundleUrl);
			expect(worker.terminate).not.toHaveBeenCalled();

			loadHandler?.({ data: { load: true } } as MessageEvent<any>);
			await expect(firstLoad).resolves.toBeUndefined();

			suppressAutoLoadAck = false;
			await expect(
				sandbox.load({
					elixir: {
						bundleUrl: '/runtime/elixir/bundle.avm'
					}
				})
			).resolves.toBeUndefined();
		} finally {
			sandbox.terminate();
			await firstLoad.catch(() => {});
		}
	});

	it('rejects operations that overlap an active Elixir run', async () => {
		const sandbox = new Elixir();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const firstRun = sandbox.run('IO.puts("first")', false);
		const firstHandler = worker.onmessage;

		try {
			await expect(sandbox.run('IO.puts("second")', false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'ELIXIR',
				phase: 'execute'
			});
			await expect(
				sandbox.load({
					elixir: {
						bundleUrl: '/runtime/elixir/other.avm'
					}
				})
			).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'ELIXIR',
				phase: 'execute'
			});
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.onmessage).toBe(firstHandler);
			expect(worker.terminate).not.toHaveBeenCalled();

			firstHandler?.({
				data: { output: 'first\n', results: ':first' }
			} as MessageEvent<any>);
			await expect(firstRun).resolves.toBe(':first');
			expect(output).toHaveBeenCalledWith('first\n');

			const secondRun = sandbox.run('IO.puts("second")', false);
			const secondHandler = worker.onmessage;
			firstHandler?.({ data: { output: 'stale\n', results: ':stale' } } as MessageEvent<any>);
			expect(worker.onmessage).toBe(secondHandler);
			expect(output).not.toHaveBeenCalledWith('stale\n');
			await expect(secondRun).resolves.toBe(':ok');
		} finally {
			sandbox.terminate();
			await firstRun.catch(() => {});
		}
	});

	it('keeps Elixir idle when run is called without a loaded worker', async () => {
		const sandbox = new Elixir();
		sandbox.write('preserved input\n');
		sandbox.eof();

		await expect(
			sandbox.run('IO.puts("missing")', false, true, undefined, [], { stdin: '' })
		).rejects.toBe('Worker not loaded');
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.prepared).toBe(false);
		expect(sandbox.hasExecuted).toBe(false);
		expect(sandbox.pendingInput).toEqual(['preserved input\n']);
		expect(sandbox.pendingEof).toBe(true);
	});

	it('releases Elixir operation ownership after synchronous dispatch failure', async () => {
		const sandbox = new Elixir();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		const dispatchError = new Error('Elixir dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchError;
		});
		sandbox.write('queued before explicit dispatch\n');
		sandbox.eof();

		await expect(
			sandbox.run('IO.puts("fail")', false, true, undefined, [], { stdin: '' })
		).rejects.toBe(dispatchError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		await expect(
			sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			})
		).resolves.toBeUndefined();
		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
		expect(workerInstances).toHaveLength(2);
	});

	it('clears explicit stdin state after a worker execution error', async () => {
		const sandbox = new Elixir();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('IO.puts("fail")', false, true, undefined, [], {
			stdin: 'explicit input\n'
		});
		sandbox.write('queued during failed explicit run\n');
		sandbox.eof();

		worker.onmessage?.({ data: { error: 'Elixir execution failed' } } as MessageEvent<any>);

		await expect(running).rejects.toBe('Elixir execution failed');
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
	});

	it.each(['script error', 'message error'])(
		'clears explicit stdin state after an Elixir worker $kind',
		async (kind) => {
			const sandbox = new Elixir();
			const output = vi.fn();
			sandbox.output = output;
			await sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			});
			const worker = workerInstances[0];
			worker.postMessage.mockImplementationOnce(() => undefined);
			const running = sandbox.run('IO.puts("fail")', false, true, undefined, [], {
				stdin: 'explicit input\n'
			});
			const staleHandler = worker.onmessage;
			sandbox.write('queued during failed explicit run\n');
			sandbox.eof();

			if (kind === 'script error') {
				worker.onerror?.({
					message: 'run crashed',
					filename: '/worker/elixir.js',
					lineno: 12,
					colno: 8
				} as ErrorEvent);
			} else {
				worker.onmessageerror?.({ data: null } as MessageEvent<any>);
			}

			await expect(running).rejects.toContain(
				kind === 'script error'
					? 'Elixir worker script error: run crashed (/worker/elixir.js:12:8)'
					: 'Elixir worker message deserialization failed'
			);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect(sandbox.waitingForInput).toBe(false);
			expect(readBufferedStdin(sandbox.buffer)).toBe('');
			staleHandler?.({ data: { output: 'stale\n', results: ':stale' } } as MessageEvent<any>);
			expect(output).not.toHaveBeenCalled();

			await sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			});
			await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
			expect(workerInstances).toHaveLength(2);
		}
	);

	it('rejects a run when the streaming output callback throws and permits a clean retry', async () => {
		const sandbox = new Elixir();
		const callbackError = new Error('Elixir streaming output failed');
		const failedOutput = vi.fn((output: string) => {
			if (output === 'factorial_plus_bonus=27\n') throw callbackError;
		});
		sandbox.output = failedOutput;
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		const running = sandbox.run('IO.puts("fail")', false, true, undefined, [], {
			stdin: ''
		});
		const staleHandler = worker.onmessage;
		sandbox.write('queued during callback failure\n');
		sandbox.eof();

		await expect(running).rejects.toBe(callbackError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		staleHandler?.({ data: { output: 'stale\n', results: ':stale' } } as MessageEvent<any>);
		expect(failedOutput).not.toHaveBeenCalledWith('stale\n');

		sandbox.output = vi.fn();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
		expect(workerInstances).toHaveLength(2);
	});

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } }
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } }
		}
	])('enforces a cumulative UTF-8 output budget for $name', async (testCase) => {
		const sandbox = new Elixir(testCase.language);
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load(testCase.runtimeAssets);
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('unicode_output', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const staleHandler = worker.onmessage;

		staleHandler?.({ data: { output: 'é' } } as MessageEvent<any>);
		staleHandler?.({ data: { output: '🙂' } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: testCase.language,
			actual: 6,
			limit: 5
		});
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('é');
		expect(output).not.toHaveBeenCalledWith('🙂');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale\n', results: ':stale' } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalledWith('stale\n');

		sandbox.output = vi.fn();
		await sandbox.load(testCase.runtimeAssets);
		await expect(sandbox.run('retry', false)).resolves.toBe(':ok');
		expect(workerInstances).toHaveLength(2);
	});

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } }
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } }
		}
	])('counts the evaluated $name result in the same output budget', async (testCase) => {
		const sandbox = new Elixir(testCase.language);
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load(testCase.runtimeAssets);
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('result_output', false, true, undefined, [], {
			limits: { maxOutputBytes: 6 }
		});

		worker.onmessage?.({ data: { results: ':ok' } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: testCase.language,
			actual: 7,
			limit: 6
		});
		expect(output).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
	});

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } }
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } }
		}
	])(
		'preserves a replacement $name load when a limit getter terminates the provisional run',
		async (testCase) => {
			const sandbox = new Elixir(testCase.language);
			const terminationReason = new Error(`replace ${testCase.name} during limits`);
			let replacementLoad: Promise<void> | undefined;
			await sandbox.load(testCase.runtimeAssets);
			const retiredWorker = workerInstances[0];
			const limits = Object.defineProperty({}, 'maxOutputBytes', {
				enumerable: true,
				get: () => {
					sandbox.terminate(terminationReason);
					replacementLoad = sandbox.load(testCase.runtimeAssets);
					return 5;
				}
			});

			const superseded = sandbox.run('superseded', false, true, undefined, [], {
				limits
			});

			await expect(superseded).rejects.toBe(terminationReason);
			expect(replacementLoad).toBeDefined();
			await expect(replacementLoad).resolves.toBeUndefined();
			expect(retiredWorker.terminate).toHaveBeenCalledOnce();
			expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
			expect(workerInstances).toHaveLength(2);
			expect(workerInstances[1].terminate).not.toHaveBeenCalled();

			await expect(sandbox.run('retry', false)).resolves.toBe(':ok');
		}
	);

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } }
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } }
		}
	])('rejects a $name run when the evaluated-result output callback throws', async (testCase) => {
		const sandbox = new Elixir(testCase.language);
		const callbackError = new Error(`${testCase.name} result output failed`);
		sandbox.output = vi.fn((output: string) => {
			if (output === '=> :ok\n') throw callbackError;
		});
		await sandbox.load(testCase.runtimeAssets);
		const worker = workerInstances[0];
		const running = sandbox.run('result_output_failure', false, true, undefined, [], {
			stdin: ''
		});
		sandbox.write('queued during result callback failure\n');
		sandbox.eof();

		await expect(running).rejects.toBe(callbackError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);
		expect(sandbox.prepared).toBe(false);
		expect(sandbox.hasExecuted).toBe(false);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		sandbox.output = vi.fn();
		await sandbox.load(testCase.runtimeAssets);
		await expect(sandbox.run('retry', false)).resolves.toBe(':ok');
		expect(workerInstances).toHaveLength(2);
	});

	it('keeps result-output reentrant operations busy until the original run settles', async () => {
		const sandbox = new Elixir();
		const runtimeAssets = {
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		};
		let reentrantLoadResult: Promise<unknown> | undefined;
		let reentrantRunResult: Promise<unknown> | undefined;
		await sandbox.load(runtimeAssets);
		const worker = workerInstances[0];
		sandbox.output = (output: string) => {
			if (output !== '=> :ok\n') return;
			reentrantLoadResult = sandbox.load(runtimeAssets).catch((reason) => reason);
			reentrantRunResult = sandbox
				.run('IO.puts("reentrant")', false)
				.catch((reason) => reason);
		};

		await expect(sandbox.run('IO.puts("owner")', false)).resolves.toBe(':ok');
		await expect(reentrantLoadResult).resolves.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ELIXIR',
			phase: 'execute'
		});
		await expect(reentrantRunResult).resolves.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ELIXIR',
			phase: 'execute'
		});
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.terminate).not.toHaveBeenCalled();

		sandbox.output = vi.fn();
		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
	});

	it('preserves reentrant termination and its replacement when an output callback throws', async () => {
		const sandbox = new Elixir();
		const terminationReason = new Error('stop from Elixir output');
		const callbackError = new Error('throw after Elixir termination');
		let replacementLoad: Promise<void> | undefined;
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const oldWorker = workerInstances[0];
		sandbox.output = (output: string) => {
			if (output !== '=> :ok\n') return;
			sandbox.terminate(terminationReason);
			replacementLoad = sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			});
			throw callbackError;
		};

		await expect(sandbox.run('IO.puts("replace")', false)).rejects.toBe(terminationReason);
		expect(replacementLoad).toBeDefined();
		await expect(replacementLoad).resolves.toBeUndefined();
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();

		sandbox.output = vi.fn();
		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
	});

	it('releases Elixir operation ownership after kill', async () => {
		const sandbox = new Elixir();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('IO.puts("wait")', false, true, undefined, [], {
			stdin: ''
		});
		sandbox.write('discarded input\n');
		sandbox.eof();

		sandbox.kill();
		sandbox.write('fresh input\n');

		await expect(running).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual(['fresh input\n']);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		await expect(
			sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			})
		).resolves.toBeUndefined();
		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
	});

	it('does not start a pre-aborted Elixir execution', async () => {
		const sandbox = new Elixir();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const uid = sandbox.uid;
		const controller = new AbortController();
		const reason = new Error('stop before Elixir execution');
		sandbox.write('preserved pre-abort input\n');
		sandbox.eof();
		controller.abort(reason);

		await expect(
			sandbox.run('IO.puts("never")', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBe(reason);
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual(['preserved pre-abort input\n']);
		expect(sandbox.pendingEof).toBe(true);
	});

	it('releases the provisional run without retiring the worker when limits are invalid', async () => {
		const sandbox = new Elixir();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const uid = sandbox.uid;

		await expect(
			sandbox.run('IO.puts("invalid")', false, true, undefined, [], {
				limits: { maxOutputBytes: 0 }
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'configuration'
		});
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
	});

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } },
			code: 'IO.puts("workspace")',
			activePath: '../main.exs'
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } },
			code: 'io:format("workspace~n").',
			activePath: '/main.erl'
		}
	])('rejects an unsafe $name active path before worker dispatch', async (testCase) => {
		const sandbox = new Elixir(testCase.language);
		await sandbox.load(testCase.runtimeAssets);
		const worker = workerInstances[0];

		await expect(
			sandbox.run(testCase.code, false, true, undefined, [], {
				activePath: testCase.activePath
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'invalid-path',
			path: testCase.activePath
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run(testCase.code, false)).resolves.toBe(':ok');
	});

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } },
			activePath: 'lib/main.exs'
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } },
			activePath: 'src/main.erl'
		}
	])('rejects unsupported auxiliary $name workspace files', async (testCase) => {
		const sandbox = new Elixir(testCase.language);
		await sandbox.load(testCase.runtimeAssets);
		const worker = workerInstances[0];

		await expect(
			sandbox.run('workspace_source', false, true, undefined, [], {
				activePath: testCase.activePath,
				workspaceFiles: [{ path: 'lib/helper.txt', content: 'helper' }]
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'execute',
			runtimeId: testCase.language
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.terminate).not.toHaveBeenCalled();

		await expect(
			sandbox.run('workspace_source', false, true, undefined, [], {
				activePath: testCase.activePath,
				workspaceFiles: [{ path: testCase.activePath, content: 'stale source' }]
			})
		).resolves.toBe(':ok');
	});

	it('clamps the Elixir workspace byte limit to the execution ceiling', async () => {
		const sandbox = new Elixir();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];

		await expect(
			sandbox.run('four', false, true, undefined, [], {
				limits: { maxWorkspaceBytes: 3 },
				workspaceLimits: { maxFileBytes: 100, maxTotalBytes: 100 }
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'file-size-limit',
			limit: 3,
			actual: 4
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.terminate).not.toHaveBeenCalled();

		await expect(sandbox.run('ok', false)).resolves.toBe(':ok');
	});

	it('preserves a replacement Elixir load when a workspace getter terminates the run', async () => {
		const sandbox = new Elixir();
		const runtimeAssets = {
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		};
		const terminationReason = new Error('replace Elixir during workspace snapshot');
		let replacementLoad: Promise<void> | undefined;
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const options = Object.defineProperty({}, 'workspaceFiles', {
			enumerable: true,
			get: () => {
				sandbox.terminate(terminationReason);
				replacementLoad = sandbox.load(runtimeAssets);
				return [];
			}
		});

		const superseded = sandbox.run('superseded', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(terminationReason);
		expect(replacementLoad).toBeDefined();
		await expect(replacementLoad).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();

		await expect(sandbox.run('retry', false)).resolves.toBe(':ok');
	});

	it('aborts only the active Elixir execution and permits a clean retry', async () => {
		const sandbox = new Elixir();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const controller = new AbortController();
		const reason = new Error('stop active Elixir execution');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const running = sandbox.run('IO.puts("wait")', false, true, undefined, [], {
			signal: controller.signal,
			stdin: ''
		});
		const staleHandler = worker.onmessage;
		sandbox.write('queued during aborted explicit run\n');
		sandbox.eof();

		controller.abort(reason);

		await expect(running).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		const abortRegistrations = addEventListener.mock.calls.filter(
			(registration: unknown[]) => registration[0] === 'abort'
		);
		expect(abortRegistrations).toHaveLength(1);
		for (const registration of abortRegistrations) {
			expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
		}

		staleHandler?.({ data: { output: 'stale\n', results: ':stale' } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		await expect(sandbox.run('IO.puts("retry")', false)).resolves.toBe(':ok');
		expect(workerInstances).toHaveLength(2);
	});

	it('removes an Elixir execution abort listener after success', async () => {
		const sandbox = new Elixir();
		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		await expect(
			sandbox.run('IO.puts("done")', false, true, undefined, [], {
				signal: controller.signal
			})
		).resolves.toBe(':ok');
		const abortRegistrations = addEventListener.mock.calls.filter(
			(registration: unknown[]) => registration[0] === 'abort'
		);
		expect(abortRegistrations).toHaveLength(1);
		for (const registration of abortRegistrations) {
			expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
		}

		controller.abort(new Error('late successful Elixir run abort'));
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('IO.puts("again")', false)).resolves.toBe(':ok');
	});

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } }
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } }
		}
	])(
		'isolates empty explicit stdin from the $name terminal queue and following run',
		async (testCase) => {
			const sandbox = new Elixir(testCase.language);
			await sandbox.load(testCase.runtimeAssets);
			const worker = workerInstances[0];
			let explicitMessage: any;
			let explicitSnapshot:
				| {
						pendingInput: string[];
						pendingEof: boolean;
						waitingForInput: boolean;
						bufferedInput: string | null;
				  }
				| undefined;
			sandbox.write('queued before explicit run\n');
			sandbox.eof();
			worker.postMessage.mockImplementationOnce((message: any) => {
				explicitMessage = message;
				sandbox.write('queued during explicit run\n');
				sandbox.eof();
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				explicitSnapshot = {
					pendingInput: [...sandbox.pendingInput],
					pendingEof: sandbox.pendingEof,
					waitingForInput: sandbox.waitingForInput,
					bufferedInput: readBufferedStdin(sandbox.buffer)
				};
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});

			await expect(
				sandbox.run('stdin_read', false, true, undefined, [], { stdin: '' })
			).resolves.toBe(true);
			expect(explicitMessage).toEqual(
				expect.objectContaining({
					language: testCase.language,
					stdin: ''
				})
			);
			expect(explicitSnapshot).toEqual({
				pendingInput: ['queued during explicit run\n'],
				pendingEof: true,
				waitingForInput: false,
				bufferedInput: ''
			});
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect(sandbox.waitingForInput).toBe(false);
			expect(readBufferedStdin(sandbox.buffer)).toBe('');

			let waitingBeforeFreshInput = false;
			let bufferedBeforeFreshInput: string | null = null;
			let bufferedAfterFreshInput: string | null = null;
			worker.postMessage.mockImplementationOnce(() => {
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				waitingBeforeFreshInput = sandbox.waitingForInput;
				bufferedBeforeFreshInput = readBufferedStdin(sandbox.buffer);
				sandbox.write('fresh input\n');
				bufferedAfterFreshInput = readBufferedStdin(sandbox.buffer);
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});

			await expect(sandbox.run('stdin_read', false)).resolves.toBe(true);
			expect(waitingBeforeFreshInput).toBe(true);
			expect(bufferedBeforeFreshInput).toBe('');
			expect(bufferedAfterFreshInput).toBe('fresh input\n');
		}
	);

	it('flushes queued terminal input into the worker stdin buffer when Elixir requests it', async () => {
		const sandbox = new Elixir();
		const output = vi.fn();
		sandbox.output = output;

		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		let runMessage: any;
		worker.postMessage.mockImplementationOnce((message: any) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('5\n');
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				worker.onmessage?.({
					data: { output: 'factorial_plus_bonus=123\n' }
				} as MessageEvent<any>);
				worker.onmessage?.({ data: { results: ':ok' } } as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('IO.gets("")', false)).resolves.toBe(':ok');

		expect(runMessage).toEqual(
			expect.objectContaining({
				code: 'IO.gets("")',
				prepare: false,
				buffer: expect.any(SharedArrayBuffer)
			})
		);
		expect(readBufferedStdin(runMessage.buffer)).toBe('5\n');
		expect(output).toHaveBeenCalledWith('factorial_plus_bonus=123\n');
		expect(output).toHaveBeenCalledWith('=> :ok\n');
	});

	it('preserves input typed between prepare and the follow-up run load', async () => {
		const sandbox = new Elixir();

		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		await expect(sandbox.run('IO.gets("")', true)).resolves.toBe(true);
		sandbox.write('5\n');

		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		let runMessage: any;
		worker.postMessage.mockImplementationOnce((message: any) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('IO.gets("")', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('5\n');
	});

	it('flushes subsequent queued stdin chunks when the worker requests input multiple times', async () => {
		const sandbox = new Elixir();

		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		const flushedChunks: Array<string | null> = [];
		let runMessage: any;
		worker.postMessage.mockImplementationOnce((message: any) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('5\n');
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				flushedChunks.push(readBufferedStdin(runMessage.buffer));
				sandbox.write('7\n');
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				flushedChunks.push(readBufferedStdin(runMessage.buffer));
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('IO.gets("") <> IO.gets("")', false)).resolves.toBe(true);

		expect(flushedChunks).toEqual(['5\n', '7\n']);
	});

	it('flushes EOF into the worker stdin buffer when requested', async () => {
		const sandbox = new Elixir();

		await sandbox.load({
			elixir: {
				bundleUrl: '/runtime/elixir/bundle.avm'
			}
		});
		const worker = workerInstances[0];
		let runMessage: any;
		worker.postMessage.mockImplementationOnce((message: any) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.eof();
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('IO.gets("")', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBeNull();
	});

	it.each([
		{
			name: 'Elixir',
			language: 'ELIXIR' as const,
			runtimeAssets: { elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } }
		},
		{
			name: 'Erlang',
			language: 'ERLANG' as const,
			runtimeAssets: { erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } }
		}
	])('keeps clear reusable but disposes an idle $name runtime exactly once', async (testCase) => {
		const sandbox = new Elixir(testCase.language);
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load(testCase.runtimeAssets);
		const worker = workerInstances[0];
		await expect(sandbox.run('prepared_source', true)).resolves.toBe(true);

		await sandbox.clear();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('prepared_again', true)).resolves.toBe(true);
		sandbox.write('queued input\n');
		sandbox.eof();
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.pendingEof).toBe(true);

		let cleanupSnapshot: Record<string, unknown> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		worker.terminate.mockImplementationOnce(() => {
			cleanupSnapshot = {
				worker: sandbox.worker,
				bundleUrl: sandbox.bundleUrl,
				bundleIdentity: sandbox.bundleIdentity,
				output: sandbox.output,
				prepared: sandbox.prepared,
				hasExecuted: sandbox.hasExecuted,
				pendingInput: [...sandbox.pendingInput],
				waitingForInput: sandbox.waitingForInput,
				pendingEof: sandbox.pendingEof,
				bufferedInput: readBufferedStdin(sandbox.buffer),
				onmessage: worker.onmessage,
				onerror: worker.onerror,
				onmessageerror: worker.onmessageerror
			};
			reentrantLoad = sandbox.load(testCase.runtimeAssets);
			reentrantRun = sandbox.run('unavailable', false);
			reentrantDisposal = sandbox.dispose();
		});

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		expect(reentrantDisposal).toBe(firstDisposal);
		await firstDisposal;

		expect(cleanupSnapshot).toEqual({
			worker: undefined,
			bundleUrl: '',
			bundleIdentity: '',
			output: null,
			prepared: false,
			hasExecuted: false,
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
			runtimeId: testCase.language
		});
		await expect(reentrantRun).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: testCase.language
		});
		sandbox.write('ignored input\n');
		sandbox.eof();
		sandbox.terminate();
		await sandbox.clear();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles active Erlang startup with one stable disposal cancellation', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Elixir('ERLANG');
		const loading = sandbox.load({ erlang: { bundleUrl: '/runtime/erlang/bundle.avm' } });
		const outcome = loading.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		const cancellation = await outcome;
		await firstDisposal;

		expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'ERLANG',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.bundleUrl).toBe('');
		expect(sandbox.bundleIdentity).toBe('');
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active Elixir run, clears stdin, and ignores retained messages', async () => {
		const sandbox = new Elixir();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load({ elixir: { bundleUrl: '/runtime/elixir/bundle.avm' } });
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('IO.gets("")', false);
		const outcome = running.catch((error) => error);
		const staleHandler = worker.onmessage;
		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.write('active input\n');
		sandbox.eof();
		expect(readBufferedStdin(sandbox.buffer)).toBe('active input\n');
		expect(sandbox.pendingEof).toBe(true);

		await sandbox.dispose();
		const cancellation = await outcome;
		expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'ELIXIR',
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
				results: ':late'
			}
		} as MessageEvent<any>);
		await Promise.resolve();
		expect(output).not.toHaveBeenCalled();
		expect(sandbox.output).toBeNull();
		expect(sandbox.waitingForInput).toBe(false);
	});

	it('rejects terminal startup when the signal getter reenters disposal', async () => {
		const sandbox = new Elixir('ERLANG');
		let reentrantDisposal: Promise<void> | undefined;
		let loading: Promise<void> | undefined;
		let loadError: unknown;
		const options = {
			get signal() {
				reentrantDisposal = sandbox.dispose();
				return undefined;
			}
		};

		try {
			loading = sandbox.load(
				{ erlang: { bundleUrl: '/runtime/erlang/reentrant.avm' } },
				'',
				true,
				[],
				options
			);
		} catch (error) {
			loadError = error;
		}

		expect(loadError).toBeUndefined();
		await expect(loading).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'ERLANG'
		});
		expect(reentrantDisposal).toBe(sandbox.dispose());
		await reentrantDisposal;
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.bundleUrl).toBe('');
		expect(workerInstances).toHaveLength(0);
	});

	it('does not publish bundle state when an asset getter reenters disposal', async () => {
		const sandbox = new Elixir();
		const progress = { set: vi.fn() };
		let reentrantDisposal: Promise<void> | undefined;
		const runtimeAssets = {
			elixir: {
				get bundleUrl() {
					reentrantDisposal = sandbox.dispose();
					return '/runtime/elixir/reentrant.avm';
				}
			}
		};

		const loading = sandbox.load(runtimeAssets, '', true, [], {}, progress);
		const cancellation = await loading.catch((error) => error);

		expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(reentrantDisposal).toBe(sandbox.dispose());
		await reentrantDisposal;
		expect(progress.set).not.toHaveBeenCalled();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.bundleUrl).toBe('');
		expect(sandbox.bundleIdentity).toBe('');
		expect(workerInstances).toHaveLength(0);
	});

	it('does not resurrect bundle identity when worker replacement reenters disposal', async () => {
		const sandbox = new Elixir();
		await sandbox.load({ elixir: { bundleUrl: '/runtime/elixir/first.avm' } });
		const retiredWorker = workerInstances[0];
		const replacementProgress = { set: vi.fn() };
		let reentrantDisposal: Promise<void> | undefined;
		let reentrantError: unknown;
		retiredWorker.terminate.mockImplementationOnce(() => {
			try {
				reentrantDisposal = sandbox.dispose();
			} catch (error) {
				reentrantError = error;
			}
		});

		const replacement = sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/first.avm',
					integrity: {
						...WASM_ELIXIR_ASSET_RECEIPTS,
						'bundle.avm': {
							...WASM_ELIXIR_ASSET_RECEIPTS['bundle.avm'],
							uncompressedSha256: 'd'.repeat(64)
						}
					}
				}
			},
			'',
			true,
			[],
			{},
			replacementProgress
		);
		const outcome = replacement.catch((error) => error);
		await vi.waitFor(() => expect(reentrantDisposal ?? reentrantError).toBeDefined());

		expect(reentrantError).toBeUndefined();
		const cancellation = await outcome;
		expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(sandbox.dispose()).toBe(reentrantDisposal);
		await reentrantDisposal;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(replacementProgress.set).not.toHaveBeenCalled();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.bundleUrl).toBe('');
		expect(sandbox.bundleIdentity).toBe('');
		expect(workerInstances).toHaveLength(1);
	});
});
