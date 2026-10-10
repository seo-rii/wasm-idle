// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WASM_AHEUI_VERSION, WASM_AHEUI_WHEELS } from '../wasmAheuiVersion';

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
const bufferedStdin = vi.hoisted(() => ({ waitForBufferedStdin: vi.fn<() => string | null>() }));

vi.mock('$lib/playground/worker/assets', () => workerAssets);
vi.mock('./runtimeAssetFetch', () => assetFetch);
vi.mock('$lib/playground/stdinBuffer', async (importOriginal) => ({
	...(await importOriginal<typeof import('../stdinBuffer')>()),
	...bufferedStdin
}));

afterEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	workerAssets.configureWorkerRuntimeAssets.mockReset();
	workerAssets.configureWorkerRuntimeAssetAllowlist.mockReset();
	workerAssets.loadWorkerRuntimeAsset.mockReset();
	assetFetch.fetchRuntimeAssetBytes.mockReset();
	assetFetch.fetchRuntimeAssetBytes.mockImplementation(
		async (options) => new Uint8Array(options.expected.bytes)
	);
	bufferedStdin.waitForBufferedStdin.mockReset();
});

let nextRuntimeModuleId = 0;
const sitePackages = '/lib/python3.14/site-packages';
const bridgedAssets = {
	baseUrl: 'https://wasm-idle.invalid/python/',
	maxAssetBytes: 1024 * 1024,
	useAssetBridge: true
};
const aheuiExtension = (wheels = WASM_AHEUI_WHEELS) => ({
	language: 'aheui',
	version: WASM_AHEUI_VERSION,
	wheels: wheels.map((wheel) => ({
		...wheel,
		url: `https://idle.example.test/wasm-aheui/${wheel.fileName}`
	}))
});

interface StdinHandler {
	stdin?: () => Uint8Array | null;
	autoEOF?: boolean;
	error?: boolean;
}
interface StreamWriter {
	write: (bytes: Uint8Array) => number;
}

async function createRuntimeHarness(loadedVersion = WASM_AHEUI_VERSION) {
	const postMessage = vi.fn();
	const files = new Map<string, string>();
	const pyodide = {
		FS: {
			mkdirTree: vi.fn(),
			writeFile: vi.fn((filename: string, source: string) => files.set(filename, source)),
			analyzePath: vi.fn((filename: string) => ({ exists: files.has(filename) })),
			unlink: vi.fn((filename: string) => files.delete(filename))
		},
		loadPackagesFromImports: vi.fn(async () => undefined),
		unpackArchive: vi.fn(),
		runPython: vi.fn((source: string) =>
			source.includes('sysconfig') ? sitePackages : loadedVersion
		),
		runPythonAsync: vi.fn(async (_source: string) => undefined),
		setInterruptBuffer: vi.fn(),
		setStdin: vi.fn((_options: StdinHandler) => undefined),
		setStdout: vi.fn((_options: StreamWriter) => undefined),
		setStderr: vi.fn((_options: StreamWriter) => undefined)
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
		pyodide,
		files
	};
}

const executionData = (code: string, extra: Record<string, unknown> = {}) => ({
	code,
	language: 'aheui',
	activePath: 'main.aheui',
	workspaceFiles: [],
	buffer: new SharedArrayBuffer(4096),
	debugBuffer: new SharedArrayBuffer(4096),
	watchBuffer: new SharedArrayBuffer(4096),
	watchResultBuffer: new SharedArrayBuffer(4096),
	interrupt: new SharedArrayBuffer(1),
	...extra
});

describe('Aheui on the Pyodide worker', { timeout: 30_000 }, () => {
	it('installs a verified local original wheel once and checks the actual package version', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		const load = { load: true, assets: bridgedAssets, extension: aheuiExtension() };
		await onmessage({ data: load });
		await onmessage({ data: load });
		expect(postMessage).toHaveBeenCalledWith({ load: true });
		expect(assetFetch.fetchRuntimeAssetBytes).toHaveBeenCalledTimes(1);
		expect(assetFetch.fetchRuntimeAssetBytes).toHaveBeenCalledWith(
			expect.objectContaining({
				url: `https://idle.example.test/wasm-aheui/${WASM_AHEUI_WHEELS[0].fileName}`,
				expected: {
					bytes: WASM_AHEUI_WHEELS[0].bytes,
					sha256: WASM_AHEUI_WHEELS[0].sha256
				},
				maxAssetBytes: WASM_AHEUI_WHEELS[0].bytes,
				integrityContext: { asset: WASM_AHEUI_WHEELS[0].fileName, runtimeId: 'AHEUI' }
			})
		);
		expect(pyodide.unpackArchive).toHaveBeenCalledWith(expect.any(Uint8Array), 'whl', {
			extractDir: sitePackages
		});
		expect(pyodide.runPython.mock.calls.at(-1)?.[0]).toContain(
			'from aheui.version import VERSION'
		);
	});

	it.each([
		{ wheel: { ...WASM_AHEUI_WHEELS[0], fileName: '../aheui.whl' } },
		{ wheel: { ...WASM_AHEUI_WHEELS[0], sha256: 'invalid' } },
		{ wheel: { ...WASM_AHEUI_WHEELS[0], bytes: 0 } }
	])('rejects malformed wheel receipts before downloading: $wheel', async ({ wheel }) => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: aheuiExtension([wheel]) }
		});
		expect(postMessage).toHaveBeenCalledWith({
			error: 'Aheui runtime wheel receipt is invalid'
		});
		expect(assetFetch.fetchRuntimeAssetBytes).not.toHaveBeenCalled();
		expect(pyodide.unpackArchive).not.toHaveBeenCalled();
	});

	it('does not acknowledge installation after an integrity failure or mismatched imported version', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness('0.0.1');
		assetFetch.fetchRuntimeAssetBytes.mockRejectedValueOnce(
			new Error('Aheui wheel integrity failed')
		);
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: aheuiExtension() }
		});
		expect(postMessage).toHaveBeenCalledWith({ error: 'Aheui wheel integrity failed' });
		expect(pyodide.unpackArchive).not.toHaveBeenCalled();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: aheuiExtension() }
		});
		expect(postMessage).toHaveBeenCalledWith({
			error: `Aheui runtime version mismatch: expected ${WASM_AHEUI_VERSION}, loaded 0.0.1`
		});
		expect(postMessage).not.toHaveBeenCalledWith({ load: true });
	});

	it('does not scan Aheui as Python and rejects unavailable runtimes or debugging', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: bridgedAssets } });
		await onmessage({ data: executionData('밯맣희') });
		expect(postMessage).toHaveBeenCalledWith({ error: 'Aheui runtime is not installed' });
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: aheuiExtension() }
		});
		await onmessage({ data: { ...executionData('밯맣희'), prepare: true } });
		expect(postMessage).toHaveBeenCalledWith({ results: true });
		expect(pyodide.loadPackagesFromImports).not.toHaveBeenCalled();
		await onmessage({ data: executionData('밯맣희', { debug: true }) });
		expect(postMessage).toHaveBeenCalledWith({ error: 'Aheui debugging is not supported' });
		expect(pyodide.runPythonAsync).not.toHaveBeenCalled();
	});

	it('passes explicit UTF-8 stdin bytes without appending a newline and retains EOF', async () => {
		const { onmessage, postMessage, pyodide, files } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: aheuiExtension() }
		});
		pyodide.runPythonAsync.mockImplementation(async () => {
			const handler = pyodide.setStdin.mock.calls.at(-1)![0];
			expect(handler.autoEOF).toBe(false);
			expect(handler.stdin!()).toEqual(new TextEncoder().encode('가😀\0'));
			expect(handler.stdin!()).toBeNull();
			expect(handler.stdin!()).toBeNull();
			const filename = '/tmp/__wasm_idle_aheui__/nested/가.aheui';
			expect(files.get(filename)).toBe('밯맣희');
			return undefined;
		});
		await onmessage({
			data: executionData('밯맣희', { stdin: '가😀\0', activePath: 'nested/가.aheui' })
		});
		expect(bufferedStdin.waitForBufferedStdin).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({ results: true });
		expect(files.size).toBe(0);
		const source = pyodide.runPythonAsync.mock.calls[0][0];
		expect(source).toContain('importlib.reload(__wasm_idle_aheui)');
		expect(source).toContain('__wasm_idle_aheui.entry_point(');
		expect(source).not.toContain('builtins.input');
	});

	it('accepts multiple terminal chunks and never requests input after terminal EOF', async () => {
		const { onmessage, pyodide } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: aheuiExtension() }
		});
		bufferedStdin.waitForBufferedStdin
			.mockReturnValueOnce('가')
			.mockReturnValueOnce('😀')
			.mockReturnValueOnce(null);
		pyodide.runPythonAsync.mockImplementation(async () => {
			const read = pyodide.setStdin.mock.calls.at(-1)![0].stdin!;
			expect(read()).toEqual(new TextEncoder().encode('가'));
			expect(read()).toEqual(new TextEncoder().encode('😀'));
			expect(read()).toBeNull();
			expect(read()).toBeNull();
			return undefined;
		});
		await onmessage({ data: executionData('밯맣밯맣밯망희') });
		expect(bufferedStdin.waitForBufferedStdin).toHaveBeenCalledTimes(3);
	});

	it.each(['stdout', 'stderr'] as const)(
		'preserves leading BOMs in split %s writes and fresh executions',
		async (stream) => {
			const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
			await onmessage({
				data: { load: true, assets: bridgedAssets, extension: aheuiExtension() }
			});
			const text = '\ufeff가🙂\ufeffx';
			pyodide.runPythonAsync.mockImplementation(async () => {
				const write =
					stream === 'stdout'
						? pyodide.setStdout.mock.calls.at(-1)![0].write
						: pyodide.setStderr.mock.calls.at(-1)![0].write;
				for (const byte of new TextEncoder().encode(text)) {
					expect(write(new Uint8Array([byte]))).toBe(1);
				}
			});
			for (let run = 0; run < 2; run += 1) {
				postMessage.mockClear();
				await onmessage({ data: executionData('밯맣희', { stdin: text }) });
				const output = postMessage.mock.calls
					.map(([message]) => message.output || '')
					.join('');
				expect(output).toBe(text);
				expect(postMessage).toHaveBeenCalledWith({ results: true });
			}
		}
	);

	it('streams split UTF-8 and NUL, cleans up after errors, then permits a fresh execution', async () => {
		const { onmessage, postMessage, pyodide, files } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: aheuiExtension() }
		});
		postMessage.mockClear();
		pyodide.runPythonAsync.mockImplementationOnce(async () => {
			const stdout = pyodide.setStdout.mock.calls.at(-1)![0].write;
			const stderr = pyodide.setStderr.mock.calls.at(-1)![0].write;
			const encoded = new TextEncoder().encode('가😀\0');
			for (const byte of encoded) expect(stdout(new Uint8Array([byte]))).toBe(1);
			expect(stderr(new Uint8Array([0xea]))).toBe(1);
			throw new Error('Original interpreter failed');
		});
		await onmessage({ data: executionData('밯맣희', { stdin: '가' }) });
		const output = postMessage.mock.calls.map(([message]) => message.output || '').join('');
		expect(output).toBe('가😀\0�');
		expect(postMessage).toHaveBeenCalledWith({ error: 'Original interpreter failed' });
		expect(files.size).toBe(0);
		expect(pyodide.setStdin).toHaveBeenLastCalledWith({ error: true });
		postMessage.mockClear();
		await onmessage({ data: executionData('희', { stdin: '' }) });
		expect(postMessage).toHaveBeenCalledWith({ results: true });
		expect(files.size).toBe(0);
	});
});
