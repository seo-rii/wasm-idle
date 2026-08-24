import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RUBY_MAX_ASSET_BYTES, RUBY_RUNTIME_PROFILE } from '@wasm-idle/core';
import { readBufferedStdin } from './stdinBuffer';
import { createRubyRuntimeTestPreflightPayload } from './rubyTestPreflight';

const preflightMocks = vi.hoisted(() => ({
	preflightVerifiedRubyRuntimeAssets: vi.fn()
}));

vi.mock('$lib/playground/rubyAssets', async (importOriginal) => ({
	...(await importOriginal<typeof import('./rubyAssets')>()),
	preflightVerifiedRubyRuntimeAssets: preflightMocks.preflightVerifiedRubyRuntimeAssets
}));

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_RUBY_MODULE_URL: '',
		PUBLIC_WASM_RUBY_WASM_URL: ''
	}
}));
let suppressAutoLoadAck = false;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any, _transfer?: Transferable[]) => {
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
							fileName: 'main.rb',
							lineNumber: 1,
							columnNumber: 1,
							severity: 'warning',
							message: 'demo warning'
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

vi.mock('$lib/playground/worker/ruby?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Ruby from './ruby';

describe('Ruby sandbox', () => {
	beforeEach(() => {
		preflightMocks.preflightVerifiedRubyRuntimeAssets
			.mockReset()
			.mockImplementation(async () => createRubyRuntimeTestPreflightPayload());
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_RUBY_WASM_URL = '';
		publicEnv.PUBLIC_WASM_RUBY_MODULE_URL = '';
		suppressAutoLoadAck = false;
	});

	it('loads the Ruby worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Ruby();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = 'puts "factorial_plus_bonus=27"';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['5'], {
				activePath: 'main.rb',
				stdin: '4\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		const [loadMessage, transfer] = workerInstances[0].postMessage.mock.calls[0];
		expect(Object.keys(loadMessage).sort()).toEqual([
			'load',
			'maxAssetBytes',
			'runtimePreflight'
		]);
		expect(loadMessage).toEqual({
			load: true,
			runtimePreflight: expect.any(Object),
			maxAssetBytes: RUBY_MAX_ASSET_BYTES
		});
		expect(transfer).toEqual([
			loadMessage.runtimePreflight.manifestBytes.buffer,
			loadMessage.runtimePreflight.moduleJavaScriptBytes.buffer,
			loadMessage.runtimePreflight.wasmBytes.buffer
		]);
		expect(new Set(transfer).size).toBe(3);
		expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledOnce();
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.rb',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['5'],
				stdin: '4\n',
				activePath: 'main.rb',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.rb',
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('preflights a complete custom profile without exposing asset URLs to the worker', async () => {
		const sandbox = new Ruby();

		await sandbox.load({
			ruby: {
				...RUBY_RUNTIME_PROFILE,
				baseUrl: '/runtime/'
			}
		});

		expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/runtime/',
				moduleUrl: expect.stringMatching(/\/runtime\/runtime\.mjs\.bin\?v=/),
				wasmUrl: expect.stringMatching(
					/\/runtime\/assets\/ruby_stdlib-C40Yu-vu\.wasm\.gz\.bin\?v=/
				)
			}),
			expect.any(Object)
		);
		const [loadMessage] = workerInstances[0].postMessage.mock.calls[0];
		expect(loadMessage).not.toHaveProperty('moduleUrl');
		expect(loadMessage).not.toHaveProperty('wasmUrl');
		expect(loadMessage).not.toHaveProperty('integrity');
	});

	it('reuses one verified warm worker without another preflight or transfer', async () => {
		const sandbox = new Ruby();

		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const firstLoadCall = worker.postMessage.mock.calls[0];
		await sandbox.load('/assets');

		expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledOnce();
		expect(workerInstances).toEqual([worker]);
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.postMessage.mock.calls[0]).toBe(firstLoadCall);
	});

	it('rejects load when the Ruby worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ruby();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/ruby.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Ruby worker script error: worker script error (/worker/ruby.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Ruby();
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

		await expect(sandbox.run('puts STDIN.gets', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
