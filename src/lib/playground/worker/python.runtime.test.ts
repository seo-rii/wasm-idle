// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const workerAssets = vi.hoisted(() => ({
	configureWorkerRuntimeAssetAllowlist: vi.fn(),
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: vi.fn(() => false),
	loadWorkerRuntimeAsset: vi.fn()
}));

vi.mock('$lib/playground/worker/assets', () => workerAssets);

afterEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	workerAssets.configureWorkerRuntimeAssetAllowlist.mockReset();
	workerAssets.configureWorkerRuntimeAssets.mockReset();
	workerAssets.handleWorkerAssetMessage.mockReset().mockReturnValue(false);
	workerAssets.loadWorkerRuntimeAsset.mockReset();
});

const packageAsset = 'demo-1.0-py3-none-any.whl';

async function createRuntimeHarness({
	version = '0.29.3',
	lock = {
		info: {
			arch: 'wasm32',
			abi_version: 'test-abi',
			platform: 'test-platform',
			python: '3.13.2',
			version
		},
		packages: {
			demo: {
				depends: [],
				file_name: packageAsset,
				imports: ['demo'],
				install_dir: 'site',
				name: 'demo',
				package_type: 'package',
				sha256: 'a'.repeat(64),
				version: '1.0'
			}
		}
	}
}: {
	version?: string;
	lock?: Record<string, unknown>;
} = {}) {
	const postMessage = vi.fn();
	const runtimeOptions: Array<Record<string, unknown>> = [];
	const pyodide = {
		FS: {
			mkdirTree: vi.fn(),
			writeFile: vi.fn()
		},
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
export const version = ${JSON.stringify(version)};
export async function loadPyodide(options) {
  globalThis.__pythonRuntimeOptions.push(options);
  return globalThis.__pythonRuntimeMock;
}
`,
		'pyodide-lock.json': JSON.stringify(lock)
	};
	workerAssets.loadWorkerRuntimeAsset.mockImplementation(async (asset: string) => ({
		bytes: new TextEncoder().encode(moduleSources[asset]),
		mimeType: asset.endsWith('.json') ? 'application/json' : 'text/javascript'
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
	vi.spyOn(URL, 'createObjectURL').mockImplementation((source: Blob | MediaSource) => {
		const bytes = (source as unknown as ModuleBlob).parts
			.map((part) =>
				typeof part === 'string' ? Buffer.from(part) : Buffer.from(new Uint8Array(part))
			)
			.reduce((left, right) => Buffer.concat([left, right]));
		return `data:text/javascript;base64,${bytes.toString('base64')}#${++moduleId}`;
	});
	const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

	await import('./python');
	return {
		onmessage: (globalThis as any).self.onmessage as (event: {
			data: Record<string, unknown>;
		}) => Promise<void>,
		postMessage,
		pyodide,
		revokeObjectURL,
		runtimeOptions
	};
}

describe('Python worker runtime dispatch', () => {
	it.each([
		{
			name: 'bridged',
			assetConfig: {
				baseUrl: 'https://wasm-idle.invalid/python/',
				maxAssetBytes: 4096,
				useAssetBridge: true
			},
			expectedAssets: ['pyodide.asm.js', 'pyodide.mjs'],
			expectedPackageBaseUrl: 'https://wasm-idle.invalid/python/'
		},
		{
			name: 'direct',
			assetConfig: {
				baseUrl: 'https://assets.example.test/python/',
				maxAssetBytes: 4096,
				useAssetBridge: false
			},
			expectedAssets: ['pyodide.asm.js', 'pyodide.mjs', 'pyodide-lock.json'],
			expectedPackageBaseUrl: 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/'
		}
	])(
		'loads $name runtime assets with bounded package configuration and settles empty code',
		async ({ assetConfig, expectedAssets, expectedPackageBaseUrl }) => {
			const { onmessage, postMessage, pyodide, revokeObjectURL, runtimeOptions } =
				await createRuntimeHarness();

			await onmessage({ data: { load: true, assets: assetConfig } });

			expect(workerAssets.configureWorkerRuntimeAssets).toHaveBeenCalledWith(assetConfig);
			expect(workerAssets.loadWorkerRuntimeAsset.mock.calls.map(([asset]) => asset)).toEqual(
				expectedAssets
			);
			expect(runtimeOptions).toHaveLength(1);
			expect(runtimeOptions[0]).toMatchObject({
				indexURL: assetConfig.baseUrl,
				packageBaseUrl: expectedPackageBaseUrl
			});
			if (assetConfig.useAssetBridge) {
				expect(runtimeOptions[0]).not.toHaveProperty('lockFileContents');
				expect(workerAssets.configureWorkerRuntimeAssetAllowlist).not.toHaveBeenCalled();
			} else {
				expect(runtimeOptions[0]).toHaveProperty(
					'lockFileContents.packages.demo.file_name',
					packageAsset
				);
				expect(workerAssets.configureWorkerRuntimeAssetAllowlist).toHaveBeenCalledWith({
					baseUrl: expectedPackageBaseUrl,
					assets: [packageAsset],
					runtimeAssets: [
						'pyodide.mjs',
						'pyodide.asm.js',
						'pyodide-lock.json',
						'pyodide.asm.wasm',
						'python_stdlib.zip'
					]
				});
			}
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
		}
	);

	it.each([
		{
			name: 'untrusted runtime version',
			version: '0.29.3/../../untrusted',
			lock: undefined,
			error: 'Pyodide runtime version is invalid',
			expectedAssets: ['pyodide.asm.js', 'pyodide.mjs']
		},
		{
			name: 'unsafe lock package path',
			version: '0.29.3',
			lock: { packages: { demo: { file_name: '../untrusted.whl' } } },
			error: 'Python runtime lock file has an unsafe package asset name',
			expectedAssets: ['pyodide.asm.js', 'pyodide.mjs', 'pyodide-lock.json']
		}
	])('fails closed for an $name', async ({ version, lock, error, expectedAssets }) => {
		const { onmessage, postMessage, runtimeOptions } = await createRuntimeHarness({
			version,
			...(lock ? { lock } : {})
		});

		await onmessage({
			data: {
				load: true,
				assets: {
					baseUrl: 'https://assets.example.test/python/',
					maxAssetBytes: 4096,
					useAssetBridge: false
				}
			}
		});

		expect(workerAssets.loadWorkerRuntimeAsset.mock.calls.map(([asset]) => asset)).toEqual(
			expectedAssets
		);
		expect(workerAssets.configureWorkerRuntimeAssetAllowlist).not.toHaveBeenCalled();
		expect(runtimeOptions).toHaveLength(0);
		expect(postMessage).toHaveBeenCalledWith({ error });
	});
});
