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
let nextRuntimeModuleId = 0;

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
	const moduleEvaluations: string[] = [];
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
		'pyodide.asm.js': `
  globalThis.__pythonModuleEvaluations.push('asm');
  globalThis._createPyodideModule = async () => ({});
`,
		'pyodide.mjs': `
globalThis.__pythonModuleEvaluations.push('entry');
if (typeof globalThis._createPyodideModule !== 'function') throw new Error('asm not evaluated');
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
	vi.stubGlobal('self', globalThis);
	vi.stubGlobal('postMessage', postMessage);
	vi.stubGlobal('__pythonRuntimeMock', pyodide);
	vi.stubGlobal('__pythonRuntimeOptions', runtimeOptions);
	vi.stubGlobal('__pythonModuleEvaluations', moduleEvaluations);
	vi.stubGlobal('_createPyodideModule', undefined);
	vi.stubGlobal('Blob', ModuleBlob);
	vi.spyOn(URL, 'createObjectURL').mockImplementation((source: Blob | MediaSource) => {
		const bytes = (source as unknown as ModuleBlob).parts
			.map((part) =>
				typeof part === 'string' ? Buffer.from(part) : Buffer.from(new Uint8Array(part))
			)
			.reduce((left, right) => Buffer.concat([left, right]));
		return `data:text/javascript;base64,${bytes.toString('base64')}#${++nextRuntimeModuleId}`;
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
		runtimeOptions,
		moduleSources,
		moduleEvaluations
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
			expectedAssets: ['pyodide.asm.js', 'pyodide.mjs', 'pyodide-lock.json']
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

const directAssets = {
	baseUrl: 'https://assets.example.test/python/',
	maxAssetBytes: 4096,
	useAssetBridge: false
};

function executionData(
	code = 'import demo',
	workspaceFiles: { path: string; content: string }[] = [],
	activePath = 'main.py'
) {
	return {
		code,
		activePath,
		workspaceFiles,
		buffer: new SharedArrayBuffer(4096),
		debugBuffer: new SharedArrayBuffer(4096),
		watchBuffer: new SharedArrayBuffer(4096),
		watchResultBuffer: new SharedArrayBuffer(4096),
		interrupt: new SharedArrayBuffer(1)
	};
}

describe('Python bootstrap scheduling', () => {
	it.each([false, true])(
		'fetches independent assets concurrently and evaluates asm first (bridge=%s)',
		async (useAssetBridge) => {
			const harness = await createRuntimeHarness();
			const loadAsset = workerAssets.loadWorkerRuntimeAsset.getMockImplementation()!;
			const pending = new Map<string, () => void>();
			workerAssets.loadWorkerRuntimeAsset.mockImplementation(
				(asset: string) =>
					new Promise((resolve) => {
						pending.set(asset, () => resolve(loadAsset(asset)));
					})
			);

			const loading = harness.onmessage({
				data: { load: true, assets: { ...directAssets, useAssetBridge } }
			});
			const expected = ['pyodide.asm.js', 'pyodide.mjs'];
			if (!useAssetBridge) expected.push('pyodide-lock.json');
			expect([...pending.keys()]).toEqual(expected);
			expect(harness.moduleEvaluations).toEqual([]);
			expect(harness.runtimeOptions).toHaveLength(0);
			expect(harness.postMessage).not.toHaveBeenCalledWith({ load: true });

			// Reverse completion order must not change module evaluation dependencies.
			for (const asset of [...expected].reverse()) pending.get(asset)!();
			await loading;
			expect(harness.moduleEvaluations).toEqual(['asm', 'entry']);
			expect(harness.runtimeOptions).toHaveLength(1);
			expect(harness.revokeObjectURL).toHaveBeenCalledTimes(2);
			expect(harness.postMessage).toHaveBeenCalledWith({ load: true });
		}
	);

	it.each(['pyodide.asm.js', 'pyodide.mjs', 'pyodide-lock.json'])(
		'fails closed and can retry when %s cannot be downloaded',
		async (failedAsset) => {
			const harness = await createRuntimeHarness();
			const loadAsset = workerAssets.loadWorkerRuntimeAsset.getMockImplementation()!;
			workerAssets.loadWorkerRuntimeAsset.mockImplementation((asset: string) =>
				asset === failedAsset ? Promise.reject(new Error('asset unavailable')) : loadAsset(asset)
			);
			await harness.onmessage({ data: { load: true, assets: directAssets } });
			expect(harness.runtimeOptions).toHaveLength(0);
			expect(harness.moduleEvaluations).toEqual([]);
			expect(workerAssets.configureWorkerRuntimeAssetAllowlist).not.toHaveBeenCalled();
			expect(harness.postMessage).toHaveBeenCalledWith({ error: 'asset unavailable' });
			expect(harness.postMessage).not.toHaveBeenCalledWith({ load: true });

			workerAssets.loadWorkerRuntimeAsset.mockImplementation(loadAsset);
			await harness.onmessage({ data: { load: true, assets: directAssets } });
			expect(harness.runtimeOptions).toHaveLength(1);
			expect(harness.postMessage).toHaveBeenCalledWith({ load: true });
		}
	);

	it('revokes both module URLs when the entry module throws during evaluation', async () => {
		const harness = await createRuntimeHarness();
		harness.moduleSources['pyodide.mjs'] = "throw new Error('entry failed');";
		await harness.onmessage({ data: { load: true, assets: directAssets } });
		expect(harness.revokeObjectURL).toHaveBeenCalledTimes(2);
		expect(harness.runtimeOptions).toHaveLength(0);
		expect(harness.postMessage).toHaveBeenCalledWith({ error: 'entry failed' });
	});
});

describe('Python prepare-to-run reuse', () => {
	it.each([false, true])(
		'reuses import analysis only for the next matching run (bridge=%s)',
		async (useAssetBridge) => {
			const { onmessage, pyodide, postMessage } = await createRuntimeHarness();
			await onmessage({ data: { load: true, assets: { ...directAssets, useAssetBridge } } });
			const data = executionData('import demo', [{ path: 'helper.py', content: 'import demo' }]);
			await onmessage({ data: { ...data, prepare: true } });
			expect(pyodide.loadPackagesFromImports).toHaveBeenCalledOnce();
			expect(pyodide.runPythonAsync).not.toHaveBeenCalled();

			await onmessage({ data });
			expect(pyodide.loadPackagesFromImports).toHaveBeenCalledOnce();
			expect(pyodide.runPythonAsync).toHaveBeenCalledOnce();
			// Rewriting files is intentional: preparation does not change workspace semantics.
			expect(pyodide.FS.writeFile).toHaveBeenCalledTimes(2);
			expect(postMessage).toHaveBeenCalledWith({ results: true });

			await onmessage({ data });
			expect(pyodide.loadPackagesFromImports).toHaveBeenCalledTimes(2);
			expect(pyodide.runPythonAsync).toHaveBeenCalledTimes(2);
		}
	);

	it.each([
		[
			'active source',
			executionData('import another', [{ path: 'a.py', content: 'import demo' }])
		],
		[
			'active path',
			executionData('import demo', [{ path: 'a.py', content: 'import demo' }], 'other.py')
		],
		[
			'workspace source',
			executionData('import demo', [{ path: 'a.py', content: 'import other' }])
		],
		[
			'workspace path',
			executionData('import demo', [{ path: 'b.py', content: 'import demo' }])
		],
		['removed file', executionData('import demo')]
	])('reanalyzes imports after a changed %s', async (_label, changed) => {
		const { onmessage, pyodide } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: directAssets } });
		const data = executionData('import demo', [{ path: 'a.py', content: 'import demo' }]);
		await onmessage({ data: { ...data, prepare: true } });
		await onmessage({ data: changed });
		expect(pyodide.loadPackagesFromImports).toHaveBeenCalledTimes(2);
		expect(pyodide.runPythonAsync).toHaveBeenCalledOnce();
	});

	it('does not confuse source boundaries that produce the same joined text', async () => {
		const { onmessage, pyodide } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: directAssets } });
		await onmessage({
			data: {
				...executionData('import demo', [{ path: 'a.py', content: 'import other' }]),
				prepare: true
			}
		});
		await onmessage({ data: executionData('import demo\nimport other') });
		expect(pyodide.loadPackagesFromImports).toHaveBeenCalledTimes(2);
		expect(pyodide.loadPackagesFromImports.mock.calls[0]).toEqual(
			pyodide.loadPackagesFromImports.mock.calls[1]
		);
	});

	it('does not reuse an old preparation after a later preparation fails', async () => {
		const { onmessage, pyodide, postMessage } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: directAssets } });
		const data = executionData();
		await onmessage({ data: { ...data, prepare: true } });
		pyodide.loadPackagesFromImports.mockRejectedValueOnce(new Error('package failed'));
		await onmessage({ data: { ...data, prepare: true } });
		expect(postMessage).toHaveBeenCalledWith({ error: 'package failed' });
		await onmessage({ data });
		expect(pyodide.loadPackagesFromImports).toHaveBeenCalledTimes(3);
		expect(pyodide.runPythonAsync).toHaveBeenCalledOnce();
	});

	it('consumes preparation even when user execution fails', async () => {
		const { onmessage, pyodide, postMessage } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: directAssets } });
		const data = executionData();
		await onmessage({ data: { ...data, prepare: true } });
		pyodide.runPythonAsync.mockRejectedValueOnce(new Error('user code failed'));
		await onmessage({ data });
		expect(postMessage).toHaveBeenCalledWith({ error: 'user code failed' });
		expect(pyodide.loadPackagesFromImports).toHaveBeenCalledOnce();
		await onmessage({ data });
		expect(pyodide.loadPackagesFromImports).toHaveBeenCalledTimes(2);
	});

	it('clears preparation when a new load message is received', async () => {
		const { onmessage, pyodide } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: directAssets } });
		const data = executionData();
		await onmessage({ data: { ...data, prepare: true } });
		await onmessage({ data: { load: true, assets: directAssets } });
		await onmessage({ data });
		expect(pyodide.loadPackagesFromImports).toHaveBeenCalledTimes(2);
	});

	it('keeps empty prepared programs executable', async () => {
		const { onmessage, pyodide, postMessage } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: directAssets } });
		const data = executionData('');
		await onmessage({ data: { ...data, prepare: true } });
		await onmessage({ data });
		expect(pyodide.loadPackagesFromImports).not.toHaveBeenCalled();
		expect(pyodide.runPythonAsync).toHaveBeenCalledOnce();
		expect(postMessage).toHaveBeenCalledWith({ results: true });
	});
});
