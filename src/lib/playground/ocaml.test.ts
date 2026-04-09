import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_OCAML_MODULE_URL: '',
		PUBLIC_WASM_OCAML_MANIFEST_URL: ''
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
						progress: {
							stage: 'compile-ready',
							percent: 35
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.ml',
							lineNumber: 1,
							columnNumber: 5,
							severity: 'warning',
							message: 'unused value'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: {
					runtime: {
						sourcePath: message.target === 'js' ? '/workspace/_build/hello.js' : '/workspace/_build/hello-wasm.js',
						programSource:
							message.target === 'js'
								? 'globalThis.__wasm_of_js_of_ocaml_runtime_promise = Promise.resolve().then(() => console.log("hello from ocaml js"));'
								: 'globalThis.__wasm_of_js_of_ocaml_runtime_promise = Promise.resolve().then(() => console.log("hello from ocaml wasm"));',
						assetFiles: []
					}
				}
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/ocaml?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Ocaml from './ocaml';

describe('OCaml sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '/wasm-of-js-of-ocaml/browser-native/src/index.js';
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL =
			'/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json';
		suppressAutoLoadAck = false;
	});

	it('loads the OCaml worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Ocaml();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const values: number[] = [];
		const code = `let () = print_endline "hello"`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run(code, true, true, {
				set(value: number) {
					values.push(value);
				}
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, [], {
				ocamlBackend: 'js'
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, [], {
				ocamlBackend: 'wasm'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-of-js-of-ocaml\/browser-native\/src\/index\.js$/),
				manifestUrl: expect.stringMatching(
					/\/wasm-of-js-of-ocaml\/browser-native-bundle\/browser-native-manifest\.v1\.json$/
				)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				target: 'wasm',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				target: 'js',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({
				prepare: false,
				code,
				target: 'wasm',
				log: true
			})
		);
		expect(outputs).toContain('hello from ocaml js\n');
		expect(outputs).toContain('hello from ocaml wasm\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.ml',
				lineNumber: 1,
				columnNumber: 5,
				severity: 'warning',
				message: 'unused value'
			}
		]);
		expect(values).toEqual([0.35]);
	});

	it('rejects load when the OCaml worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Ocaml();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/ocaml.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'OCaml worker script error: worker script error (/worker/ocaml.js:88:24)'
		);
	});

	it('rejects load when the OCaml bundle URLs are missing', async () => {
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL = '';
		const sandbox = new Ocaml();

		await expect(sandbox.load({ rootUrl: '' })).rejects.toContain('OCaml runtime is not configured');
	});
});
