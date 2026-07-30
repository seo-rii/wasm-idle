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

	it('ignores an old load abort after a replacement load starts', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Elixir();
		const controller = new AbortController();
		const firstLoad = sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			},
			'',
			true,
			[],
			{ signal: controller.signal }
		);
		const firstOutcome = firstLoad.then(
			() => ({ status: 'resolved' as const }),
			(error) => ({ status: 'rejected' as const, reason: error as unknown })
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		try {
			suppressAutoLoadAck = false;
			const replacementLoad = sandbox.load({
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			});
			controller.abort(new Error('late superseded load abort'));

			await expect(firstOutcome).resolves.toEqual({
				status: 'rejected',
				reason: 'Worker operation superseded'
			});
			await expect(replacementLoad).resolves.toBeUndefined();
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(1);
		} finally {
			sandbox.terminate();
			await firstLoad.catch(() => {});
		}
	});

	it('ignores an old load abort after a run starts', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Elixir();
		const controller = new AbortController();
		const firstLoad = sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			},
			'',
			true,
			[],
			{ signal: controller.signal }
		);
		const firstOutcome = firstLoad.then(
			() => ({ status: 'resolved' as const }),
			(error) => ({ status: 'rejected' as const, reason: error as unknown })
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() =>
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>)
			);
		});

		try {
			const running = sandbox.run('IO.puts("ready")', false);
			controller.abort(new Error('late load abort after run start'));

			await expect(firstOutcome).resolves.toEqual({
				status: 'rejected',
				reason: 'Worker operation superseded'
			});
			await expect(running).resolves.toBe(true);
			expect(worker.terminate).not.toHaveBeenCalled();
		} finally {
			sandbox.terminate();
			await firstLoad.catch(() => {});
		}
	});

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
});
