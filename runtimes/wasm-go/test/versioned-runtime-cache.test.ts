import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearGoRuntimeJsonCache, compileGo } from '../src/compiler.js';
import { clearGoToolModuleCache } from '../src/tool-module.js';
import { prepareGoToolModule } from '../src/tool-runtime.js';
import type { BrowserGoToolResult } from '../src/types.js';
import { createCompileRequest, createRuntimeManifest } from './helpers.js';

// A real, minimal WASI command exporting memory and a no-op _start.
const command = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 19, 2, 6, 109,
	101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11
]);
const invocation = { tool: 'compile', toolAsset: 'tools/compile.wasm' } as const;
const toolFetch = () =>
	vi.fn(async () => new Response(Uint8Array.from(command).buffer)) as unknown as typeof fetch &
		ReturnType<typeof vi.fn>;

afterEach(() => {
	clearGoToolModuleCache();
	clearGoRuntimeJsonCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('versioned Go tool modules', () => {
	it('reuses the module for a versioned URL without downloading the tool again', async () => {
		const fetchImpl = toolFetch();
		const progress = vi.fn();
		const base = 'https://example.test/go/?v=fingerprint';
		const first = await prepareGoToolModule(invocation, base, fetchImpl, progress);
		const second = await prepareGoToolModule(invocation, base, fetchImpl, progress);
		expect(second).toBe(first);
		expect(fetchImpl).toHaveBeenCalledOnce();
		// A cache hit still reports a complete asset so stage progress reaches 100%.
		expect(progress).toHaveBeenLastCalledWith(invocation.toolAsset, 1, 1);
	});

	it('keys versioned modules by version and memory cap', async () => {
		const fetchImpl = toolFetch();
		const first = await prepareGoToolModule(
			invocation,
			'https://example.test/go/?v=1',
			fetchImpl
		);
		await prepareGoToolModule(invocation, 'https://example.test/go/?v=2', fetchImpl);
		await prepareGoToolModule(
			invocation,
			'https://example.test/go/?v=1',
			fetchImpl,
			undefined,
			{
				maxWasmMemoryBytes: 2 * 65_536
			}
		);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(
			await prepareGoToolModule(invocation, 'https://example.test/go/?v=1', fetchImpl)
		).toBe(first);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('keeps loading unversioned URLs, whose bytes may change in place', async () => {
		const fetchImpl = toolFetch();
		await prepareGoToolModule(invocation, 'https://example.test/go/', fetchImpl);
		await prepareGoToolModule(invocation, 'https://example.test/go/', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('does not publish a load that failed or was cancelled', async () => {
		const base = 'https://example.test/go/?v=fingerprint';
		const failing = vi.fn(
			async () => new Response(null, { status: 503 })
		) as unknown as typeof fetch;
		await expect(prepareGoToolModule(invocation, base, failing)).rejects.toThrow();
		const controller = new AbortController();
		const fetchImpl = toolFetch();
		const cancelled = prepareGoToolModule(invocation, base, fetchImpl, undefined, {
			signal: controller.signal
		});
		controller.abort(new Error('cancelled'));
		await expect(cancelled).rejects.toThrow('cancelled');
		await prepareGoToolModule(invocation, base, fetchImpl);
		await prepareGoToolModule(invocation, base, fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});

describe('versioned Go runtime JSON', () => {
	function stubRuntime() {
		const manifest = createRuntimeManifest();
		manifest.targets['wasip1/wasm']!.stdlibIndex = {
			asset: 'sysroot/wasip1.stdlib-index.json',
			packageCount: 1
		};
		const index = {
			format: 'wasm-go-stdlib-index-v1',
			packageCount: 1,
			packages: [{ importPath: 'runtime', runtimePath: '/sysroot/runtime.a', imports: [] }]
		};
		const fetchMock = vi.fn(async (input: string | URL) => {
			const url = String(input);
			if (url.includes('runtime-manifest')) return Response.json(manifest);
			if (url.includes('stdlib-index')) return Response.json(index);
			return new Response(null, { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}
	const runTool = async (tool: {
		tool: string;
		outputPath: string;
	}): Promise<BrowserGoToolResult> => ({
		exitCode: 0,
		stdout: '',
		outputs: {
			[tool.outputPath]:
				tool.tool === 'compile' ? new Uint8Array([1]) : new Uint8Array([0, 97, 115, 109, 1])
		}
	});
	const urls = (fetchMock: ReturnType<typeof stubRuntime>) =>
		fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname.split('/').at(-1));

	it('loads a versioned manifest and stdlib index once across compiles', async () => {
		const fetchMock = stubRuntime();
		const options = {
			runtimeManifestUrl:
				'https://example.invalid/wasm-go/runtime/runtime-manifest.v1.json?v=abc',
			dependencies: { runTool }
		};
		for (let run = 0; run < 3; run += 1)
			expect(
				(await compileGo(createCompileRequest({ dependencies: undefined }), options))
					.success
			).toBe(true);
		expect(urls(fetchMock)).toEqual(['runtime-manifest.v1.json', 'wasip1.stdlib-index.json']);
	});

	it('keeps fetching unversioned manifests and injected fetch providers on every compile', async () => {
		const fetchMock = stubRuntime();
		const unversioned = {
			runtimeManifestUrl: 'https://example.invalid/wasm-go/runtime/runtime-manifest.v1.json',
			dependencies: { runTool }
		};
		await compileGo(createCompileRequest({ dependencies: undefined }), unversioned);
		await compileGo(createCompileRequest({ dependencies: undefined }), unversioned);
		expect(urls(fetchMock)).toHaveLength(4);
		const injected = vi.fn((input: string | URL) => fetchMock(input));
		const custom = {
			runtimeManifestUrl:
				'https://example.invalid/wasm-go/runtime/runtime-manifest.v1.json?v=abc',
			dependencies: { runTool, fetchImpl: injected as unknown as typeof fetch }
		};
		await compileGo(createCompileRequest({ dependencies: undefined }), custom);
		await compileGo(createCompileRequest({ dependencies: undefined }), custom);
		expect(injected).toHaveBeenCalledTimes(4);
	});
});
