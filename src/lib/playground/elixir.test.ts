import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_ELIXIR_BUNDLE_URL: ''
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
		suppressAutoLoadAck = false;
		history.replaceState({}, '', '/editor');
	});

	it('loads the elixir worker once, preserves it across prepare, and prints the evaluated result', async () => {
		const sandbox = new Elixir();
		const output = vi.fn();
		const progress = { set: vi.fn() };
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
			{},
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

		await expect(sandbox.run('IO.puts("hello")', false)).resolves.toBe(':ok');
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(2, {
			code: 'IO.puts("hello")',
			prepare: true,
			buffer: expect.any(SharedArrayBuffer),
			log: true
		});
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(3, {
			code: 'IO.puts("hello")',
			prepare: false,
			buffer: expect.any(SharedArrayBuffer),
			log: true
		});
		expect(output).toHaveBeenCalledWith('factorial_plus_bonus=27\n');
		expect(output).toHaveBeenCalledWith('=> :ok\n');

		await sandbox.clear();
		expect(workerInstances[0].terminate).toHaveBeenCalledTimes(1);
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
