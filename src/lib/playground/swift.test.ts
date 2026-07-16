import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const workerBootstrapBlobs = new Map<string, Blob>();
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_SWIFT_BASE_URL: '',
		PUBLIC_WASM_SWIFT_WORKER_URL: '',
		PUBLIC_WASM_SWIFT_MANIFEST_URL: ''
	}
}));
let onPostMessage: ((worker: MockWorker, message: any) => void) | null = null;
let workerBootstrapId = 0;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (onPostMessage) {
			onPostMessage(this, message);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'swift-ok\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor(
		public url: string,
		public options?: WorkerOptions
	) {
		workerInstances.push(this);
		queueMicrotask(() => {
			this.onmessage?.({
				data: { __wasmIdleStaticWorkerReady: true }
			} as MessageEvent<any>);
		});
	}
}

vi.stubGlobal('Worker', MockWorker);

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Swift from './swift';

describe('Swift sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		workerBootstrapBlobs.clear();
		workerBootstrapId = 0;
		publicEnv.PUBLIC_WASM_SWIFT_BASE_URL = '';
		publicEnv.PUBLIC_WASM_SWIFT_WORKER_URL = '';
		publicEnv.PUBLIC_WASM_SWIFT_MANIFEST_URL = '';
		onPostMessage = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('/* Swift worker */', {
						status: 200,
						headers: { 'content-length': '18' }
					})
			)
		);
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			const url = `blob:wasm-idle-swift-worker-${workerBootstrapId++}`;
			workerBootstrapBlobs.set(url, blob as Blob);
			return url;
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('loads Swift runtime urls and forwards the static worker run payload', async () => {
		const sandbox = new Swift();
		const outputs: string[] = [];
		const code = 'let line = readLine() ?? ""\nprint(line)';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			swift: {
				baseUrl: '/wasm-swift/',
				workerUrl: '/wasm-swift/runner-worker.js?v=test',
				manifestUrl: '/wasm-swift/runtime-manifest.v1.json?v=test'
			}
		});
		await expect(
			sandbox.run(code, false, true, undefined, ['--demo'], {
				activePath: 'Sources/main.swift',
				stdin: 'hello\n',
				workspaceFiles: [
					{
						path: 'Sources/Helper.swift',
						content: 'func helper() -> String { "ok" }'
					}
				]
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].url).toMatch(/^blob:wasm-idle-swift-worker-/);
		expect(await workerBootstrapBlobs.get(workerInstances[0].url)?.text()).toContain(
			'http://localhost:3000/wasm-swift/runner-worker.js?v=test'
		);
		expect(workerInstances[0].options).toBeUndefined();
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-swift/',
				manifestUrl: 'http://localhost:3000/wasm-swift/runtime-manifest.v1.json?v=test',
				code,
				args: ['--demo'],
				stdin: 'hello\n',
				activePath: 'Sources/main.swift',
				workspaceFiles: [
					{
						path: 'Sources/Helper.swift',
						content: 'func helper() -> String { "ok" }'
					}
				],
				log: true
			})
		);
		expect(outputs).toContain('swift-ok\n');
	});

	it('collects queued terminal input before starting stdin-using Swift code', async () => {
		const sandbox = new Swift();
		await sandbox.load('/absproxy/5173');
		let runMessage: any;

		onPostMessage = (worker, message) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({
					data: { results: true }
				} as MessageEvent<any>);
			});
		};

		const runPromise = sandbox.run('let line = readLine() ?? ""\nprint(line)', false);
		await Promise.resolve();
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		sandbox.write('42\n');
		sandbox.eof();

		await expect(runPromise).resolves.toBe(true);
		expect(workerInstances[0].url).toMatch(/^blob:wasm-idle-swift-worker-/);
		expect(await workerBootstrapBlobs.get(workerInstances[0].url)?.text()).toContain(
			'http://localhost:3000/absproxy/5173/wasm-swift/runner-worker.js'
		);
		expect(runMessage).toEqual(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/absproxy/5173/wasm-swift/',
				manifestUrl:
					'http://localhost:3000/absproxy/5173/wasm-swift/runtime-manifest.v1.json',
				stdin: '42\n',
				activePath: 'main.swift'
			})
		);
	});

	it('uses EOF to release Swift stdin waits without queued input', async () => {
		const sandbox = new Swift();
		await sandbox.load('/absproxy/5173');
		let runMessage: any;

		onPostMessage = (worker, message) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({
					data: { results: true }
				} as MessageEvent<any>);
			});
		};

		const runPromise = sandbox.run('let line = readLine() ?? ""\nprint(line)', false);
		await Promise.resolve();
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		sandbox.eof();

		await expect(runPromise).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(runMessage).toEqual(
			expect.objectContaining({
				stdin: '',
				activePath: 'main.swift'
			})
		);
	});
});
