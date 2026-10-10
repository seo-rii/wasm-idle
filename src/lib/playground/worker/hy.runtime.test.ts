// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WASM_HY_VERSION, WASM_HY_WHEELS } from '../wasmHyVersion';

const workerAssets = vi.hoisted(() => ({
	configureWorkerRuntimeAssetAllowlist: vi.fn(),
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: vi.fn(() => false),
	loadWorkerRuntimeAsset: vi.fn(),
	hasWorkerRuntimeModuleBridge: vi.fn(() => true),
	loadWorkerRuntimeModule: vi.fn(
		async () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
	)
}));
const assetFetch = vi.hoisted(() => ({
	fetchRuntimeAssetBytes: vi.fn(
		async (options: { expected: { bytes: number } }) => new Uint8Array(options.expected.bytes)
	)
}));

vi.mock('$lib/playground/worker/assets', () => workerAssets);
vi.mock('./runtimeAssetFetch', () => assetFetch);

afterEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	workerAssets.configureWorkerRuntimeAssets.mockReset();
	workerAssets.configureWorkerRuntimeAssetAllowlist.mockReset();
	workerAssets.loadWorkerRuntimeAsset.mockReset();
	assetFetch.fetchRuntimeAssetBytes.mockClear();
});

let nextRuntimeModuleId = 0;
const sitePackages = '/lib/python3.14/site-packages';
const bridgedAssets = {
	baseUrl: 'https://wasm-idle.invalid/python/',
	maxAssetBytes: 1024 * 1024,
	useAssetBridge: true
};

const hyExtension = (wheels = WASM_HY_WHEELS) => ({
	language: 'hy',
	version: WASM_HY_VERSION,
	wheels: wheels.map((wheel) => ({
		...wheel,
		url: `https://idle.example.test/wasm-hy/${wheel.fileName}`
	}))
});

async function createRuntimeHarness(loadedHyVersion = WASM_HY_VERSION) {
	const postMessage = vi.fn();
	const pyodide = {
		FS: { mkdirTree: vi.fn(), writeFile: vi.fn() },
		loadPackagesFromImports: vi.fn(async () => undefined),
		unpackArchive: vi.fn(),
		runPython: vi.fn((source: string) =>
			source.includes('sysconfig') ? sitePackages : loadedHyVersion
		),
		runPythonAsync: vi.fn(async (_source: string) => {
			const readyName = Object.keys(globalThis).find((name) =>
				name.startsWith('__wasm_idle_python_execution_ready_')
			);
			if (readyName) (globalThis as any)[readyName]();
		}),
		setInterruptBuffer: vi.fn()
	};
	const moduleSources: Record<string, string> = {
		'pyodide.asm.mjs': 'export default async function createPyodideModule() { return {}; }',
		'pyodide.mjs': `export const version = '314.0.7';
export async function loadPyodide() { return globalThis.__pythonRuntimeMock; }`
	};
	workerAssets.loadWorkerRuntimeAsset.mockImplementation(async (asset: string) => ({
		bytes: new TextEncoder().encode(moduleSources[asset]),
		mimeType: 'text/javascript'
	}));
	class ModuleBlob {
		constructor(readonly parts: Array<ArrayBuffer | string>) {}
	}
	vi.stubGlobal('self', globalThis);
	vi.stubGlobal('postMessage', postMessage);
	vi.stubGlobal('__pythonRuntimeMock', pyodide);
	vi.stubGlobal('Blob', ModuleBlob);
	vi.spyOn(URL, 'createObjectURL').mockImplementation((source: Blob | MediaSource) => {
		const bytes = Buffer.concat(
			(source as unknown as ModuleBlob).parts.map((part) =>
				typeof part === 'string' ? Buffer.from(part) : Buffer.from(new Uint8Array(part))
			)
		);
		return `data:text/javascript;base64,${bytes.toString('base64')}#${++nextRuntimeModuleId}`;
	});
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	await import('./python');
	return {
		onmessage: (globalThis as any).self.onmessage as (event: {
			data: Record<string, unknown>;
		}) => Promise<void>,
		postMessage,
		pyodide
	};
}

const executionData = (code: string, extra: Record<string, unknown> = {}) => ({
	code,
	language: 'hy',
	activePath: 'main.hy',
	workspaceFiles: [],
	buffer: new SharedArrayBuffer(4096),
	debugBuffer: new SharedArrayBuffer(4096),
	watchBuffer: new SharedArrayBuffer(4096),
	watchResultBuffer: new SharedArrayBuffer(4096),
	interrupt: new SharedArrayBuffer(1),
	...extra
});

describe('Hy on the Pyodide worker', { timeout: 30_000 }, () => {
	it('installs only the receipt-verified local wheels into site-packages', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();

		await onmessage({ data: { load: true, assets: bridgedAssets, extension: hyExtension() } });

		expect(postMessage).toHaveBeenCalledWith({ load: true });
		expect(assetFetch.fetchRuntimeAssetBytes.mock.calls.map(([options]) => options)).toEqual(
			WASM_HY_WHEELS.map((wheel) =>
				expect.objectContaining({
					url: `https://idle.example.test/wasm-hy/${wheel.fileName}`,
					expected: { bytes: wheel.bytes, sha256: wheel.sha256 },
					maxAssetBytes: wheel.bytes
				})
			)
		);
		expect(pyodide.unpackArchive).toHaveBeenCalledTimes(WASM_HY_WHEELS.length);
		for (const [bytes, format, options] of pyodide.unpackArchive.mock.calls) {
			expect(bytes).toBeInstanceOf(Uint8Array);
			expect(format).toBe('whl');
			expect(options).toEqual({ extractDir: sitePackages });
		}
		expect(pyodide.runPython.mock.calls.at(-1)?.[0]).toContain('import hy.compiler');
	});

	it.each([
		{
			name: 'an unsafe wheel name',
			extension: hyExtension([{ ...WASM_HY_WHEELS[0], fileName: '../hy.whl' }]),
			error: 'Hy runtime wheel receipt is invalid'
		},
		{
			name: 'a missing sha256 receipt',
			extension: hyExtension([{ ...WASM_HY_WHEELS[0], sha256: 'abc' }]),
			error: 'Hy runtime wheel receipt is invalid'
		},
		{
			name: 'a non-Hy extension',
			extension: { ...hyExtension(), language: 'python' },
			error: 'Hy runtime configuration is invalid'
		}
	])('fails closed for $name before fetching', async ({ extension, error }) => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: bridgedAssets, extension } });
		expect(postMessage).toHaveBeenCalledWith({ error });
		expect(assetFetch.fetchRuntimeAssetBytes).not.toHaveBeenCalled();
		expect(pyodide.unpackArchive).not.toHaveBeenCalled();
	});

	it('rejects a Hy package whose imported version differs from the pinned receipt', async () => {
		const { onmessage, postMessage } = await createRuntimeHarness('0.0.1');
		await onmessage({ data: { load: true, assets: bridgedAssets, extension: hyExtension() } });
		expect(postMessage).toHaveBeenCalledWith({
			error: `Hy runtime version mismatch: expected ${WASM_HY_VERSION}, loaded 0.0.1`
		});
		expect(postMessage).not.toHaveBeenCalledWith({ load: true });
	});

	it('compiles Hy source with the Hy compiler and the shared stdin/stdout bridge', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: bridgedAssets, extension: hyExtension() } });
		postMessage.mockClear();
		const code = '(print (+ "main=" (input)))';

		await onmessage({ data: { ...executionData(code), prepare: true } });
		await onmessage({ data: executionData(code) });

		expect(pyodide.loadPackagesFromImports).not.toHaveBeenCalled();
		const source = pyodide.runPythonAsync.mock.calls[0][0];
		expect(source).toContain('builtins.input = __wasm_idle_input_wrapper');
		expect(source).toContain('builtins.print = __wasm_idle_output');
		expect(source).toContain('hy.compiler.hy_compile(');
		expect(source).toContain(`hy.read_many(__wasm_idle_source, filename = "main.hy")`);
		expect(source).toContain(`__wasm_idle_source = ${JSON.stringify(code)}`);
		expect(source).not.toContain('ast.PyCF_ALLOW_TOP_LEVEL_AWAIT');
		expect(postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('refuses Hy runs before installation and Hy debug sessions', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: bridgedAssets } });
		await onmessage({ data: executionData('(print 1)') });
		expect(postMessage).toHaveBeenCalledWith({ error: 'Hy runtime is not installed' });

		await onmessage({ data: { load: true, assets: bridgedAssets, extension: hyExtension() } });
		await onmessage({ data: executionData('(print 1)', { debug: true }) });
		expect(postMessage).toHaveBeenCalledWith({ error: 'Hy debugging is not supported' });
		expect(pyodide.runPythonAsync).not.toHaveBeenCalled();
	});
});
