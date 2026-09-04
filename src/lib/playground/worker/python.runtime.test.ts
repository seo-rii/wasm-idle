// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const workerAssets = vi.hoisted(() => ({
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: vi.fn(() => false),
	loadWorkerRuntimeAsset: vi.fn()
}));

vi.mock('$lib/playground/worker/assets', () => workerAssets);

afterEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	workerAssets.configureWorkerRuntimeAssets.mockReset();
	workerAssets.handleWorkerAssetMessage.mockReset().mockReturnValue(false);
	workerAssets.loadWorkerRuntimeAsset.mockReset();
});

describe('Python worker runtime dispatch', () => {
	it('loads bridged entry modules, keeps packages on the bridged base, and settles empty code', async () => {
		const postMessage = vi.fn();
		const runtimeOptions: Array<Record<string, unknown>> = [];
		const fs = {
			mkdirTree: vi.fn(),
			writeFile: vi.fn()
		};
		const pyodide = {
			FS: fs,
			loadPackagesFromImports: vi.fn(async () => undefined),
			runPythonAsync: vi.fn(async () => {
				const readyName = Object.keys(globalThis).find((name) =>
					name.startsWith('__wasm_idle_python_execution_ready_')
				);
				if (readyName) (globalThis as any)[readyName]();
			}),
			setInterruptBuffer: vi.fn()
		};
		const moduleSources: Record<string, string> = {
			'pyodide.asm.js': 'globalThis._createPyodideModule = async () => ({});',
			'pyodide.mjs': `
export const version = 'test-version';
export async function loadPyodide(options) {
  globalThis.__pythonRuntimeOptions.push(options);
  return globalThis.__pythonRuntimeMock;
}
`
		};
		workerAssets.loadWorkerRuntimeAsset.mockImplementation(async (asset: string) => ({
			bytes: new TextEncoder().encode(moduleSources[asset]),
			mimeType: 'text/javascript'
		}));

		class ModuleBlob {
			constructor(
				readonly parts: Array<ArrayBuffer | string>,
				readonly options?: BlobPropertyBag
			) {}
		}
		let moduleId = 0;
		vi.stubGlobal('self', globalThis);
		vi.stubGlobal('postMessage', postMessage);
		vi.stubGlobal('__pythonRuntimeMock', pyodide);
		vi.stubGlobal('__pythonRuntimeOptions', runtimeOptions);
		vi.stubGlobal('Blob', ModuleBlob);
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob) => {
			const source = (blob as unknown as ModuleBlob).parts
				.map((part) =>
					typeof part === 'string' ? Buffer.from(part) : Buffer.from(new Uint8Array(part))
				)
				.reduce((left, right) => Buffer.concat([left, right]));
			return `data:text/javascript;base64,${source.toString('base64')}#${++moduleId}`;
		});
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

		await import('./python');
		const onmessage = (globalThis as any).self.onmessage as (event: {
			data: Record<string, unknown>;
		}) => Promise<void>;
		const assetConfig = {
			baseUrl: 'https://wasm-idle.invalid/python/',
			maxAssetBytes: 4096,
			useAssetBridge: true
		};
		await onmessage({ data: { load: true, assets: assetConfig } });

		expect(workerAssets.configureWorkerRuntimeAssets).toHaveBeenCalledWith(assetConfig);
		expect(workerAssets.loadWorkerRuntimeAsset.mock.calls.map(([asset]) => asset)).toEqual([
			'pyodide.asm.js',
			'pyodide.mjs'
		]);
		expect(runtimeOptions).toEqual([
			expect.objectContaining({
				indexURL: 'https://wasm-idle.invalid/python/',
				packageBaseUrl: 'https://wasm-idle.invalid/python/'
			})
		]);
		expect(revokeObjectURL).toHaveBeenCalledTimes(2);
		expect(postMessage).toHaveBeenCalledWith({ load: true });

		postMessage.mockClear();
		await onmessage({
			data: {
				code: '',
				prepare: false,
				buffer: new SharedArrayBuffer(4096),
				debugBuffer: new SharedArrayBuffer(4096),
				watchBuffer: new SharedArrayBuffer(4096),
				watchResultBuffer: new SharedArrayBuffer(4096),
				interrupt: new SharedArrayBuffer(1),
				workspaceFiles: []
			}
		});

		expect(pyodide.runPythonAsync).toHaveBeenCalledOnce();
		expect(postMessage).toHaveBeenCalledWith({ results: true });
	});
});
