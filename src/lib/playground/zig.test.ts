import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_ZIG_COMPILER_URL: '',
		PUBLIC_WASM_ZIG_STDLIB_URL: ''
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
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						progress: { percent: 100 },
						load: true
					}
				} as MessageEvent<any>)
			);
			return;
		}
		if (message.prepare) {
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						output: 'zig artifact ready\n',
						results: true,
						buffer: true
					}
				} as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'zig-ok\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/zig?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Zig from './zig';

describe('Zig sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = '/wasm-zig/zig_small.wasm';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = '/wasm-zig/std.tar.gz';
		suppressAutoLoadAck = false;
	});

	it('loads the Zig worker and forwards prepare/run requests', async () => {
		const sandbox = new Zig();
		const outputs: string[] = [];
		const progressValues: number[] = [];
		const code = 'pub fn main() void {}';
		const workspaceFiles = [
			{ path: 'src/main.zig', content: code },
			{ path: 'src/helper.zig', content: 'pub const bonus = 3;' }
		];

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{},
			{
				set(value) {
					progressValues.push(value);
				}
			}
		);
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				activePath: 'src/main.zig',
				workspaceFiles,
				compileArgs: ['-O', 'Debug']
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['one'], {
				stdin: '5\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				compilerUrl: expect.stringMatching(/\/wasm-zig\/zig_small\.wasm$/),
				stdlibUrl: expect.stringMatching(/\/wasm-zig\/std\.tar\.gz$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				compileArgs: ['-O', 'Debug'],
				activePath: 'src/main.zig',
				workspaceFiles,
				targetTriple: 'wasm64-wasi',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one'],
				stdin: '5\n',
				activePath: 'main.zig',
				targetTriple: 'wasm64-wasi',
				log: true
			})
		);
		expect(progressValues).toContain(1);
		expect(outputs).toEqual(['zig artifact ready\n', 'zig-ok\n']);
	});

	it('rejects load when Zig compiler or stdlib assets are not configured', async () => {
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = '';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = '';
		const sandbox = new Zig();

		await expect(sandbox.load({})).rejects.toContain('Zig runtime is not configured');
	});

	it('rejects load when the worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/zig.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Zig worker script error: worker script error (/worker/zig.js:88:24)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Zig();
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

		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
