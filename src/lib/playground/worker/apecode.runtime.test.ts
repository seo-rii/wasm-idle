// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WASM_APECODE_VERSION, WASM_APECODE_WHEELS } from '../wasmApecodeVersion';
import { WASM_HY_VERSION, WASM_HY_WHEELS } from '../wasmHyVersion';
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
const apecodeExtension = (wheels = WASM_APECODE_WHEELS) => ({
	language: 'apecode',
	version: WASM_APECODE_VERSION,
	wheels: wheels.map((wheel) => ({
		...wheel,
		url: `https://idle.example.test/wasm-apecode/${wheel.fileName}`
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

async function createRuntimeHarness(loadedVersion = WASM_APECODE_VERSION) {
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
	language: 'apecode',
	activePath: 'main.ape',
	workspaceFiles: [],
	buffer: new SharedArrayBuffer(4096),
	debugBuffer: new SharedArrayBuffer(4096),
	watchBuffer: new SharedArrayBuffer(4096),
	watchResultBuffer: new SharedArrayBuffer(4096),
	interrupt: new SharedArrayBuffer(1),
	...extra
});

const identity = 'state main { return true; }';

describe('APECode on the Pyodide worker', { timeout: 30_000 }, () => {
	it('installs the verified original local wheel once and checks its imported version', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		const load = { load: true, assets: bridgedAssets, extension: apecodeExtension() };
		await onmessage({ data: load });
		await onmessage({ data: load });
		expect(postMessage).toHaveBeenCalledWith({ load: true });
		expect(assetFetch.fetchRuntimeAssetBytes).toHaveBeenCalledTimes(1);
		expect(assetFetch.fetchRuntimeAssetBytes).toHaveBeenCalledWith(
			expect.objectContaining({
				url: `https://idle.example.test/wasm-apecode/${WASM_APECODE_WHEELS[0].fileName}`,
				expected: {
					bytes: WASM_APECODE_WHEELS[0].bytes,
					sha256: WASM_APECODE_WHEELS[0].sha256
				},
				maxAssetBytes: WASM_APECODE_WHEELS[0].bytes,
				integrityContext: { asset: WASM_APECODE_WHEELS[0].fileName, runtimeId: 'APECODE' }
			})
		);
		expect(pyodide.unpackArchive).toHaveBeenCalledWith(expect.any(Uint8Array), 'whl', {
			extractDir: sitePackages
		});
		expect(pyodide.runPython.mock.calls.at(-1)?.[0]).toContain(
			'from apecode.cli import run_source'
		);
	});

	it('rejects changed code-pinned versions and wheel metadata before downloading', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		const changedExtensions = [
			{ ...apecodeExtension(), version: '0.1.1' },
			apecodeExtension([{ ...WASM_APECODE_WHEELS[0], fileName: '../apecode.whl' }]),
			apecodeExtension([
				{ ...WASM_APECODE_WHEELS[0], fileName: 'apecode-0.1.1-py3-none-any.whl' }
			]),
			apecodeExtension([
				{ ...WASM_APECODE_WHEELS[0], bytes: WASM_APECODE_WHEELS[0].bytes + 1 }
			]),
			apecodeExtension([{ ...WASM_APECODE_WHEELS[0], sha256: '0'.repeat(64) }]),
			apecodeExtension([WASM_APECODE_WHEELS[0], WASM_APECODE_WHEELS[0]])
		];
		for (const [index, extension] of changedExtensions.entries()) {
			postMessage.mockClear();
			await onmessage({ data: { load: true, assets: bridgedAssets, extension } });
			expect(postMessage).toHaveBeenCalledWith({
				error:
					index === 0
						? 'APECode runtime configuration is invalid'
						: 'APECode runtime wheel receipt is invalid'
			});
		}
		expect(assetFetch.fetchRuntimeAssetBytes).not.toHaveBeenCalled();
		expect(pyodide.unpackArchive).not.toHaveBeenCalled();
	});

	it('never acknowledges installation after an integrity failure or imported version mismatch', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness('0.0.1');
		assetFetch.fetchRuntimeAssetBytes.mockRejectedValueOnce(
			new Error('APECode wheel integrity failed')
		);
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		expect(postMessage).toHaveBeenCalledWith({ error: 'APECode wheel integrity failed' });
		expect(pyodide.unpackArchive).not.toHaveBeenCalled();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		expect(postMessage).toHaveBeenCalledWith({
			error: `APECode runtime version mismatch: expected ${WASM_APECODE_VERSION}, loaded 0.0.1`
		});
		expect(postMessage).not.toHaveBeenCalledWith({ load: true });
	});

	it('prepares without Python import scanning or source execution and rejects unavailable/debug runs', async () => {
		const { onmessage, postMessage, pyodide, files } = await createRuntimeHarness();
		await onmessage({ data: { load: true, assets: bridgedAssets } });
		await onmessage({ data: executionData(identity) });
		expect(postMessage).toHaveBeenCalledWith({ error: 'APECode runtime is not installed' });
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		await onmessage({
			data: { ...executionData('state main { call missing; }'), prepare: true }
		});
		expect(postMessage).toHaveBeenCalledWith({ results: true });
		expect(pyodide.loadPackagesFromImports).not.toHaveBeenCalled();
		expect(pyodide.runPythonAsync).not.toHaveBeenCalled();
		expect(files.size).toBe(0);
		await onmessage({ data: executionData(identity, { debug: true }) });
		expect(postMessage).toHaveBeenCalledWith({ error: 'APECode debugging is not supported' });
		expect(pyodide.runPythonAsync).not.toHaveBeenCalled();
	});

	it('passes unchanged source and finite UTF-8 stdin to the genuine API with stream flushing', async () => {
		const { onmessage, postMessage, pyodide, files } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		pyodide.runPythonAsync.mockImplementation(async () => {
			const handler = pyodide.setStdin.mock.calls.at(-1)![0];
			expect(handler.autoEOF).toBe(false);
			expect(handler.stdin!()).toEqual(new TextEncoder().encode('가😀\0 1 1 -42'));
			expect(handler.stdin!()).toBeNull();
			expect(handler.stdin!()).toBeNull();
			expect(files.get('/tmp/__wasm_idle_apecode__/nested/가.ape')).toBe(identity);
			return undefined;
		});
		await onmessage({
			data: executionData(identity, { stdin: '가😀\0 1 1 -42', activePath: 'nested/가.ape' })
		});
		expect(bufferedStdin.waitForBufferedStdin).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({ results: true });
		expect(files.size).toBe(0);
		const source = pyodide.runPythonAsync.mock.calls[0][0];
		expect(source).toContain('from apecode.cli import run_source');
		expect(source).toContain(
			'__wasm_idle_apecode_source.read(), sys.stdin, sys.stdout, sys.stderr'
		);
		expect(source).toContain('sys.stdout.flush()');
		expect(source).toContain('sys.stderr.flush()');
		expect(source).toContain('if __wasm_idle_apecode_status != 0:');
		expect(source).not.toContain('builtins.input');
	});

	it('delivers several terminal chunks and retains EOF for the original stdin.read()', async () => {
		const { onmessage, pyodide } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		bufferedStdin.waitForBufferedStdin
			.mockReturnValueOnce('1\n')
			.mockReturnValueOnce('한😀 2\n-42 7')
			.mockReturnValueOnce(null);
		pyodide.runPythonAsync.mockImplementation(async () => {
			const read = pyodide.setStdin.mock.calls.at(-1)![0].stdin!;
			expect(read()).toEqual(new TextEncoder().encode('1\n'));
			expect(read()).toEqual(new TextEncoder().encode('한😀 2\n-42 7'));
			expect(read()).toBeNull();
			expect(read()).toBeNull();
			return undefined;
		});
		await onmessage({ data: executionData(identity) });
		expect(bufferedStdin.waitForBufferedStdin).toHaveBeenCalledTimes(3);
	});

	it('streams split UTF-8, NUL and original binary signature bytes with independent decoders', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		postMessage.mockClear();
		const signature = new Uint8Array([
			107, 66, 113, 37, 70, 97, 7, 8, 107, 21, 36, 84, 120, 49, 122, 144, 144, 144, 144, 205,
			114, 10
		]);
		pyodide.runPythonAsync.mockImplementationOnce(async () => {
			const stdout = pyodide.setStdout.mock.calls.at(-1)![0].write;
			const stderr = pyodide.setStderr.mock.calls.at(-1)![0].write;
			const encoded = new TextEncoder().encode('가😀\0');
			for (const byte of encoded) expect(stdout(new Uint8Array([byte]))).toBe(1);
			expect(stderr(new Uint8Array([0xea]))).toBe(1);
			for (const byte of signature) expect(stdout(new Uint8Array([byte]))).toBe(1);
			return undefined;
		});
		await onmessage({ data: executionData(identity, { stdin: '1\n-1657206531\n' }) });
		const output = postMessage.mock.calls.map(([message]) => message.output || '').join('');
		expect(output).toBe(`가😀\0${new TextDecoder().decode(signature)}�`);
		expect(postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('preserves upstream diagnostics, cleans file descriptors on nonzero status and permits a fresh run', async () => {
		const { onmessage, postMessage, pyodide, files } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		postMessage.mockClear();
		pyodide.runPythonAsync.mockImplementationOnce(async () => {
			const stderr = pyodide.setStderr.mock.calls.at(-1)![0].write;
			stderr(new TextEncoder().encode("apecode: call to unknown state 'missing'\n"));
			throw new Error('APECode interpreter exited with status 1');
		});
		await onmessage({
			data: executionData('state main { call missing; }', { stdin: '1\n0\n' })
		});
		expect(postMessage).toHaveBeenCalledWith({
			output: "apecode: call to unknown state 'missing'\n"
		});
		expect(postMessage).toHaveBeenCalledWith({
			error: 'APECode interpreter exited with status 1'
		});
		expect(files.size).toBe(0);
		expect(pyodide.setStdin).toHaveBeenLastCalledWith({ error: true });
		postMessage.mockClear();
		pyodide.runPythonAsync.mockImplementationOnce(async () => {
			const read = pyodide.setStdin.mock.calls.at(-1)![0].stdin!;
			expect(read()).toEqual(new Uint8Array());
			expect(read()).toBeNull();
			return undefined;
		});
		await onmessage({ data: executionData(identity, { stdin: '' }) });
		expect(postMessage).toHaveBeenCalledWith({ results: true });
		expect(files.size).toBe(0);
	});

	it('isolates APECode from other installed language extensions', async () => {
		const { onmessage, postMessage, pyodide } = await createRuntimeHarness();
		await onmessage({
			data: { load: true, assets: bridgedAssets, extension: apecodeExtension() }
		});
		const otherExtensions = [
			{ language: 'hy', version: WASM_HY_VERSION, wheels: WASM_HY_WHEELS },
			{ language: 'aheui', version: WASM_AHEUI_VERSION, wheels: WASM_AHEUI_WHEELS }
		];
		for (const extension of otherExtensions) {
			postMessage.mockClear();
			await onmessage({
				data: {
					load: true,
					assets: bridgedAssets,
					extension: {
						...extension,
						wheels: extension.wheels.map((wheel) => ({
							...wheel,
							url: `https://idle.example.test/wasm-${extension.language}/${wheel.fileName}`
						}))
					}
				}
			});
			expect(postMessage).toHaveBeenCalledWith({
				error: 'Python runtime extension language changed'
			});
		}
		expect(assetFetch.fetchRuntimeAssetBytes).toHaveBeenCalledTimes(1);
		expect(pyodide.unpackArchive).toHaveBeenCalledTimes(1);
	});
});
