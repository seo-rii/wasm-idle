import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_HASKELL_MODULE_URL: '',
		PUBLIC_WASM_HASKELL_ROOTFS_URL: '',
		PUBLIC_WASM_HASKELL_BSDTAR_URL: ''
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
						results: true
					}
				} as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: {
					output: 'hello from haskell\n',
					diagnostic: {
						fileName: 'main.hs',
						lineNumber: 2,
						columnNumber: 1,
						severity: 'warning',
						message: 'demo warning'
					},
					results: true,
					buffer: true
				}
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/haskell?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Haskell from './haskell';

describe('Haskell sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL = '/wasm-haskell/dyld.mjs';
		publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL = '/wasm-haskell/rootfs.tar.zst';
		publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL = '/wasm-haskell/bsdtar.wasm';
		suppressAutoLoadAck = false;
	});

	it('loads the Haskell worker and forwards prepare/run requests', async () => {
		const sandbox = new Haskell();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const progressValues: number[] = [];
		const code = 'main = putStrLn "hello"';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

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
			sandbox.run(code, true, true, undefined, ['-Wall'], {
				activePath: 'src/Main.hs',
				workspaceFiles: [{ path: 'src/Main.hs', content: code }]
			})
		).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['-Wall'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-haskell\/dyld\.mjs$/),
				rootfsUrl: expect.stringMatching(/\/wasm-haskell\/rootfs\.tar\.zst$/),
				bsdtarUrl: expect.stringMatching(/\/wasm-haskell\/bsdtar\.wasm$/),
				mainSoPath: '/tmp/libplayground001.so',
				searchDirs: expect.arrayContaining(['/tmp/clib'])
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				ghcArgs: '-Wall',
				activePath: 'src/Main.hs',
				workspaceFiles: [{ path: 'src/Main.hs', content: code }],
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				ghcArgs: '-Wall',
				activePath: 'main.hs',
				log: true
			})
		);
		expect(progressValues).toContain(1);
		expect(outputs).toEqual(['hello from haskell\n']);
		expect(diagnostics).toEqual([
			{
				fileName: 'main.hs',
				lineNumber: 2,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('rejects load when Haskell assets are not configured', async () => {
		publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL = '';
		const sandbox = new Haskell();

		await expect(sandbox.load({})).rejects.toContain('Haskell runtime is not configured');
	});

	it('rejects load when the worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Haskell();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/haskell.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Haskell worker script error: worker script error (/worker/haskell.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Haskell();
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

		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
