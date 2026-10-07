// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerAssetBridge } from './assetBridge';
import { RuntimeAssetCache } from './runtimeAssetCache';
import { BUNDLED_CLANG_ASSET_INTEGRITY } from './clangAssetIntegrity';
import { compileVerifiedWasmAsset } from '@wasm-idle/llvm-core/core/verified-wasm';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('@wasm-idle/llvm-core/core/verified-wasm', () => ({ compileVerifiedWasmAsset: vi.fn() }));
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const receipt = { sha256: createHash('sha256').update(wasm).digest('hex'), bytes: wasm.length };
const baseUrl = 'https://runtime.example/pyodide/';
afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function endpoint(
	cache: RuntimeAssetCache,
	loader: any,
	integrity: any = undefined,
	maxBytes = 128
) {
	const postMessage = vi.fn();
	const bridge = new WorkerAssetBridge(
		{ postMessage } as unknown as Worker,
		'python',
		{
			baseUrl,
			useAssetBridge: true,
			loader,
			integrity
		},
		undefined,
		maxBytes,
		false,
		cache
	);
	return {
		bridge,
		postMessage,
		async request(asset: string, module = false) {
			postMessage.mockClear();
			bridge.handleMessage({
				data: { assetRequest: { id: 1, asset, module } }
			} as MessageEvent);
			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
			return postMessage.mock.calls[0][0].assetResponse;
		}
	};
}

describe('compiler modules outlive execution worker bridges', () => {
	it('uses verified streaming for the built-in Clang module and retains it outside the worker', async () => {
		const cache = new RuntimeAssetCache();
		const module = await WebAssembly.compile(wasm);
		vi.mocked(compileVerifiedWasmAsset).mockResolvedValue(module);
		for (let index = 0; index < 2; index++) {
			const postMessage = vi.fn();
			const bridge = new WorkerAssetBridge(
				{ postMessage } as unknown as Worker,
				'clang',
				{
					baseUrl: 'https://runtime.example/clang/',
					useAssetBridge: true,
					integrity: BUNDLED_CLANG_ASSET_INTEGRITY
				},
				undefined,
				128 * 1024 * 1024,
				false,
				cache
			);
			bridge.handleMessage({
				data: { assetRequest: { id: 1, asset: 'bin/clang.wasm.gz', module: true } }
			} as MessageEvent);
			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
			expect(postMessage.mock.calls[0][0].assetResponse).toMatchObject({ ok: true, module });
			bridge.dispose();
		}
		expect(compileVerifiedWasmAsset).toHaveBeenCalledExactlyOnceWith(
			'https://runtime.example/clang/bin/clang.wasm.gz',
			BUNDLED_CLANG_ASSET_INTEGRITY['bin/clang.wasm.gz'],
			expect.objectContaining({
				fetch: expect.any(Function),
				signal: expect.any(AbortSignal)
			})
		);
	});
	it('compiles trusted bytes once and reuses the module across fresh worker bridges', async () => {
		const cache = new RuntimeAssetCache();
		const loader = vi.fn(async () => ({ data: wasm }));
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = endpoint(cache, loader, { 'pyodide.asm.wasm': receipt });
		const response = await first.request('pyodide.asm.wasm', true);
		expect(response.ok).toBe(true);
		expect(response.module).toBeInstanceOf(WebAssembly.Module);
		first.bridge.dispose();
		const next = endpoint(cache, loader, { 'pyodide.asm.wasm': receipt });
		expect((await next.request('pyodide.asm.wasm', true)).module).toBe(response.module);
		expect(loader).toHaveBeenCalledTimes(1);
		expect(compile).toHaveBeenCalledTimes(1);
		expect(cache.stats().hits).toBe(1);
	});

	it('copies cached bootstrap bytes without lending the owner buffer to a worker', async () => {
		const cache = new RuntimeAssetCache();
		const source = new Uint8Array([1, 2, 3]);
		const loader = vi.fn(async () => ({ data: source, transferOwnership: true }));
		const first = endpoint(cache, loader);
		const response = await first.request('python_stdlib.zip');
		new Uint8Array(response.bytes)[0] = 99;
		first.bridge.dispose();
		const second = endpoint(cache, loader);
		expect(new Uint8Array((await second.request('python_stdlib.zip')).bytes)).toEqual(source);
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('does not reuse a module for another loader, receipt, or lower size limit', async () => {
		const cache = new RuntimeAssetCache();
		const loader = vi.fn(async () => ({ data: wasm }));
		await endpoint(cache, loader).request('pyodide.asm.wasm', true);
		const other = vi.fn(async () => ({ data: wasm }));
		expect((await endpoint(cache, other).request('pyodide.asm.wasm', true)).ok).toBe(true);
		expect(other).toHaveBeenCalledOnce();
		expect(
			(await endpoint(cache, loader, undefined, 4).request('pyodide.asm.wasm', true)).ok
		).toBe(false);
		expect(
			(
				await endpoint(cache, loader, {
					'pyodide.asm.wasm': { ...receipt, sha256: '0'.repeat(64) }
				}).request('pyodide.asm.wasm', true)
			).ok
		).toBe(false);
	});

	it('reauthorizes packages from a cached lock in a fresh worker bridge', async () => {
		const cache = new RuntimeAssetCache();
		const lock = JSON.stringify({ packages: { example: { file_name: 'example.whl' } } });
		const loader = vi.fn(async ({ asset }: { asset: string }) => ({
			data: asset === 'pyodide-lock.json' ? lock : 'package'
		}));
		const first = endpoint(cache, loader);
		expect((await first.request('pyodide-lock.json')).ok).toBe(true);
		expect((await first.request('example.whl')).ok).toBe(true);
		first.bridge.dispose();
		const next = endpoint(cache, loader);
		expect((await next.request('example.whl')).ok).toBe(false);
		expect((await next.request('pyodide-lock.json')).ok).toBe(true);
		expect((await next.request('example.whl')).ok).toBe(true);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('rejects forged assets and never retains failed compilation or verification', async () => {
		const cache = new RuntimeAssetCache();
		const loader = vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]) }));
		const bridge = endpoint(cache, loader);
		expect((await bridge.request('user-program.wasm', true)).ok).toBe(false);
		expect(loader).not.toHaveBeenCalled();
		expect((await bridge.request('pyodide.asm.wasm', true)).ok).toBe(false);
		expect(cache.stats().entries).toBe(0);
		loader.mockResolvedValueOnce({ data: wasm });
		expect((await bridge.request('pyodide.asm.wasm', true)).ok).toBe(true);
	});

	it('does not repopulate a disposed owner after a late compiler result', async () => {
		const cache = new RuntimeAssetCache();
		const module = await WebAssembly.compile(wasm);
		let finish!: (module: WebAssembly.Module) => void;
		vi.spyOn(WebAssembly, 'compile').mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const bridge = endpoint(cache, async () => ({ data: wasm }));
		const pending = bridge.request('pyodide.asm.wasm', true);
		await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
		cache.dispose();
		finish(module);
		await pending;
		expect(cache.stats()).toMatchObject({ entries: 0, disposed: true });
	});
});

describe('concurrent owner asset operations', () => {
	it('shares downloads between byte and module requests and keeps worker buffers separate', async () => {
		const cache = new RuntimeAssetCache();
		let finish!: (value: { data: Uint8Array }) => void;
		const loader = vi.fn(
			() =>
				new Promise<{ data: Uint8Array }>((resolve) => {
					finish = resolve;
				})
		);
		const compile = vi.spyOn(WebAssembly, 'compile');
		const bytesEndpoint = endpoint(cache, loader, { 'pyodide.asm.wasm': receipt });
		const moduleEndpoint = endpoint(cache, loader, { 'pyodide.asm.wasm': receipt });
		const bytesPending = bytesEndpoint.request('pyodide.asm.wasm');
		const modulePending = moduleEndpoint.request('pyodide.asm.wasm', true);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
		finish({ data: wasm });
		const [bytesResponse, moduleResponse] = await Promise.all([bytesPending, modulePending]);
		expect(bytesResponse.ok).toBe(true);
		expect(moduleResponse.module).toBeInstanceOf(WebAssembly.Module);
		expect(compile).toHaveBeenCalledOnce();
		new Uint8Array(bytesResponse.bytes)[0] = 99;
		expect(new Uint8Array((await bytesEndpoint.request('pyodide.asm.wasm')).bytes)).toEqual(
			wasm
		);
		expect(wasm[0]).toBe(0);
		expect(loader).toHaveBeenCalledOnce();
		expect(cache.stats().inFlight).toBe(0);
	});

	it('keeps compilation alive for another worker after its initiating bridge is disposed', async () => {
		const cache = new RuntimeAssetCache();
		const module = await WebAssembly.compile(wasm);
		let finish!: (value: WebAssembly.Module) => void;
		let loadSignal!: AbortSignal;
		const loader = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
			loadSignal = signal;
			return { data: wasm };
		});
		const compile = vi.spyOn(WebAssembly, 'compile').mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const first = endpoint(cache, loader);
		first.bridge.handleMessage({
			data: { assetRequest: { id: 1, asset: 'pyodide.asm.wasm', module: true } }
		} as MessageEvent);
		const next = endpoint(cache, loader);
		const pending = next.request('pyodide.asm.wasm', true);
		await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
		first.bridge.dispose();
		expect(loadSignal.aborted).toBe(false);
		finish(module);
		expect((await pending).module).toBe(module);
		expect(first.postMessage).not.toHaveBeenCalled();
		expect((await endpoint(cache, loader).request('pyodide.asm.wasm', true)).module).toBe(
			module
		);
		expect(compile).toHaveBeenCalledOnce();
		expect(loader).toHaveBeenCalledOnce();
	});

	it('shares streaming compilation and cancels it only when every worker leaves', async () => {
		const cache = new RuntimeAssetCache();
		const module = await WebAssembly.compile(wasm);
		let finish!: (module: WebAssembly.Module) => void;
		vi.mocked(compileVerifiedWasmAsset).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const config = {
			baseUrl: 'https://runtime.example/clang/',
			useAssetBridge: true,
			integrity: BUNDLED_CLANG_ASSET_INTEGRITY
		};
		const messages = [vi.fn(), vi.fn()];
		const bridges = messages.map(
			(postMessage) =>
				new WorkerAssetBridge(
					{ postMessage } as unknown as Worker,
					'clang',
					config,
					undefined,
					128 * 1024 * 1024,
					false,
					cache
				)
		);
		for (const bridge of bridges)
			bridge.handleMessage({
				data: { assetRequest: { id: 1, asset: 'bin/clang.wasm.gz', module: true } }
			} as MessageEvent);
		await vi.waitFor(() => expect(compileVerifiedWasmAsset).toHaveBeenCalledOnce());
		const signal = vi.mocked(compileVerifiedWasmAsset).mock.calls[0][2]?.signal;
		bridges[0].dispose();
		expect(signal?.aborted).toBe(false);
		finish(module);
		await vi.waitFor(() => expect(messages[1]).toHaveBeenCalledOnce());
		expect(messages[0]).not.toHaveBeenCalled();
		expect(messages[1].mock.calls[0][0].assetResponse.module).toBe(module);
	});

	it('preserves the initiating load configuration when that bridge is rebound', async () => {
		const cache = new RuntimeAssetCache();
		let finish!: (value: string) => void;
		let loadSignal!: AbortSignal;
		const loader = vi.fn(({ signal }: { signal: AbortSignal }) => {
			loadSignal = signal;
			return new Promise<string>((resolve) => {
				finish = resolve;
			});
		});
		const fetchAsset = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(wasm));
		const first = endpoint(cache, loader, { 'pyodide.asm.wasm': receipt });
		first.bridge.handleMessage({
			data: { assetRequest: { id: 1, asset: 'pyodide.asm.wasm' } }
		} as MessageEvent);
		const next = endpoint(cache, loader, { 'pyodide.asm.wasm': receipt });
		const pending = next.request('pyodide.asm.wasm');
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
		first.bridge.rebind(
			{ postMessage: first.postMessage } as unknown as Worker,
			{
				baseUrl: 'https://changed.example/',
				useAssetBridge: true,
				loader: async () => null
			},
			undefined,
			1
		);
		expect(loadSignal.aborted).toBe(false);
		finish(`${baseUrl}pyodide.asm.wasm`);
		expect((await pending).ok).toBe(true);
		expect(fetchAsset).toHaveBeenCalledWith(`${baseUrl}pyodide.asm.wasm`, expect.any(Object));
		expect(first.postMessage).not.toHaveBeenCalled();
	});

	it('propagates shared loader failures to all workers and retries the next request', async () => {
		const cache = new RuntimeAssetCache();
		let fail!: (error: Error) => void;
		const loader = vi.fn(
			() =>
				new Promise<{ data: Uint8Array }>((_resolve, reject) => {
					fail = reject;
				})
		);
		const first = endpoint(cache, loader);
		const next = endpoint(cache, loader);
		const pending = [
			first.request('pyodide.asm.wasm', true),
			next.request('pyodide.asm.wasm', true)
		];
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
		fail(new Error('download failed'));
		for (const response of await Promise.all(pending))
			expect(response).toMatchObject({ ok: false, error: 'download failed' });
		expect(cache.stats()).toMatchObject({ inFlight: 0, entries: 0 });
		loader.mockResolvedValueOnce({ data: wasm });
		expect((await next.request('pyodide.asm.wasm', true)).ok).toBe(true);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('never shares pending work across loaders, integrity receipts, or size limits', async () => {
		const cache = new RuntimeAssetCache();
		let finish!: (value: { data: Uint8Array }) => void;
		const loader = vi.fn(
			() =>
				new Promise<{ data: Uint8Array }>((resolve) => {
					finish = resolve;
				})
		);
		const pending = endpoint(cache, loader, { 'pyodide.asm.wasm': receipt }).request(
			'pyodide.asm.wasm',
			true
		);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
		const other = vi.fn(async () => ({ data: wasm }));
		expect(
			(
				await endpoint(cache, other, { 'pyodide.asm.wasm': receipt }).request(
					'pyodide.asm.wasm',
					true
				)
			).ok
		).toBe(true);
		expect(other).toHaveBeenCalledOnce();
		loader.mockResolvedValueOnce({ data: wasm });
		expect(
			(
				await endpoint(cache, loader, {
					'pyodide.asm.wasm': { ...receipt, sha256: '0'.repeat(64) }
				}).request('pyodide.asm.wasm', true)
			).ok
		).toBe(false);
		loader.mockResolvedValueOnce({ data: wasm });
		expect(
			(await endpoint(cache, loader, undefined, 4).request('pyodide.asm.wasm', true)).ok
		).toBe(false);
		finish({ data: wasm });
		expect((await pending).ok).toBe(true);
		expect(loader).toHaveBeenCalledTimes(3);
	});
});
