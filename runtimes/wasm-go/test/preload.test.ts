import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadBrowserGoRuntime } from '../src/compiler.js';
import { clearRuntimePackCache } from '../src/runtime-asset.js';
import { createRuntimeManifest } from './helpers.js';

function harness(count = 0) {
	const manifest = createRuntimeManifest();
	const target = manifest.targets['wasip1/wasm']!;
	delete target.sysrootPack;
	target.sysrootFiles = Array.from({ length: count }, (_, i) => ({
		runtimePath: `/sysroot/lib${i}.a`,
		asset: `sysroot/lib${i}.a`
	}));
	const pending = new Map<
		string,
		{
			resolve: (response: Response) => void;
			reject: (reason: unknown) => void;
			signal: AbortSignal;
		}
	>();
	const fetchImpl = vi.fn(
		(url: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((resolve, reject) => {
				const key = new URL(String(url)).pathname;
				const signal = init!.signal!;
				pending.set(key, { resolve, reject, signal });
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			})
	);
	const start = (extra = {}) =>
		preloadBrowserGoRuntime({
			manifest,
			runtimeBaseUrl: 'https://example.test/',
			fetchImpl,
			...extra
		});
	const finish = (key: string) =>
		pending.get(key)!.resolve(new Response(new Uint8Array([1, 2, 3])));
	return { manifest, target, pending, fetchImpl, start, finish };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function packHarness() {
	const manifest = createRuntimeManifest();
	const requests: string[] = [];
	const pending: Array<{
		path: string;
		resolve: (response: Response) => void;
		signal: AbortSignal | null | undefined;
	}> = [];
	const fetchImpl = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
		const path = new URL(String(url)).pathname;
		requests.push(path);
		if (!path.startsWith('/sysroot/')) {
			return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
		}
		return new Promise<Response>((resolve) =>
			pending.push({ path, resolve, signal: init?.signal })
		);
	});
	const start = (signal?: AbortSignal) =>
		preloadBrowserGoRuntime({
			manifest,
			runtimeBaseUrl: 'https://example.test/',
			fetchImpl,
			...(signal ? { signal } : {})
		});
	const finish = () => {
		for (const request of pending.splice(0)) {
			request.resolve(
				request.path.endsWith('.index.json.gz')
					? new Response(
							JSON.stringify({
								format: 'wasm-go-runtime-pack-index-v1',
								fileCount: 2,
								totalBytes: 6,
								entries: [
									{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 },
									{ runtimePath: '/sysroot/runtime.a', offset: 3, length: 3 }
								]
							})
						)
					: new Response(new Uint8Array([1, 2, 3, 4, 5, 6]))
			);
		}
	};
	const count = (path: string) => requests.filter((request) => request === path).length;
	return { count, fetchImpl, finish, pending, start };
}

describe('parallel Go preloading', () => {
	afterEach(() => clearRuntimePackCache());

	it('starts compiler, linker and sysroot independently and preserves manifest order', async () => {
		const h = harness(2);
		const operation = h.start();
		await tick();
		expect(h.pending.size).toBe(4);
		h.finish('/sysroot/lib1.a');
		h.finish('/tools/link.wasm.gz');
		h.finish('/tools/compile.wasm.gz');
		h.finish('/sysroot/lib0.a');
		expect((await operation).fetchedAssets).toEqual([
			'https://example.test/tools/compile.wasm.gz',
			'https://example.test/tools/link.wasm.gz',
			'https://example.test/sysroot/lib0.a',
			'https://example.test/sysroot/lib1.a'
		]);
	});
	it('bounds file-level concurrency to four and starts the next file as a slot opens', async () => {
		const h = harness(6);
		const operation = h.start();
		await tick();
		expect(h.pending.size).toBe(6);
		expect(h.pending.has('/sysroot/lib4.a')).toBe(false);
		h.finish('/sysroot/lib1.a');
		await tick();
		expect(h.pending.has('/sysroot/lib4.a')).toBe(true);
		h.finish('/sysroot/lib0.a');
		await tick();
		expect(h.pending.has('/sysroot/lib5.a')).toBe(true);
		for (const [key] of h.pending) h.finish(key);
		expect((await operation).fetchedAssets).toHaveLength(8);
	});
	it('honors includeSysroot=false', async () => {
		const h = harness(4);
		const operation = h.start({ includeSysroot: false });
		await tick();
		expect(h.pending.size).toBe(2);
		for (const [key] of h.pending) h.finish(key);
		expect((await operation).fetchedAssets).toHaveLength(2);
	});
	it('starts wasm_exec with the toolchain for the JavaScript target', async () => {
		const h = harness();
		const operation = h.start({ target: 'js/wasm', includeSysroot: false });
		await tick();
		expect(h.pending.size).toBe(3);
		expect(h.pending.has('/runtime/wasm_exec.js')).toBe(true);
		for (const [key] of h.pending) h.finish(key);
		expect((await operation).fetchedAssets.at(-1)).toBe(
			'https://example.test/runtime/wasm_exec.js'
		);
	});
	it('cancels siblings on one failure without changing the parent signal', async () => {
		const parent = new AbortController();
		const h = harness(5);
		const operation = h.start({ signal: parent.signal });
		const assertion = expect(operation).rejects.toThrow('failed compiler');
		await tick();
		h.pending.get('/tools/compile.wasm.gz')!.reject(new Error('failed compiler'));
		await assertion;
		await tick();
		expect(parent.signal.aborted).toBe(false);
		expect([...h.pending.values()].every((x) => x.signal.aborted)).toBe(true);
		expect(h.pending.has('/sysroot/lib4.a')).toBe(false);
	});
	it('observes parent cancellation and removes its listener', async () => {
		const parent = new AbortController();
		const remove = vi.spyOn(parent.signal, 'removeEventListener');
		const h = harness(1);
		const operation = h.start({ signal: parent.signal });
		const assertion = expect(operation).rejects.toThrow('user stopped');
		await tick();
		parent.abort(new Error('user stopped'));
		await assertion;
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
	});
	it('does no I/O for a pre-aborted request', async () => {
		const parent = new AbortController();
		parent.abort(new Error('stopped'));
		const h = harness(1);
		await expect(h.start({ signal: parent.signal })).rejects.toThrow('stopped');
		expect(h.fetchImpl).not.toHaveBeenCalled();
	});
	it('retains per-asset byte limits on every branch', async () => {
		const h = harness(1);
		const operation = h.start({ maxAssetBytes: 2 });
		const assertion = expect(operation).rejects.toThrow(/asset limit/);
		await tick();
		h.finish('/sysroot/lib0.a');
		await assertion;
		expect(h.pending.get('/tools/link.wasm.gz')!.signal.aborted).toBe(true);
	});
	it('shares cold pack index and byte requests across concurrent preloads', async () => {
		const h = packHarness();
		const preloads = [h.start(), h.start()];

		await tick();
		const indexRequests = h.count('/sysroot/wasip1.index.json.gz');
		const packRequests = h.count('/sysroot/wasip1.pack.gz');
		h.finish();
		await Promise.all(preloads);

		expect(indexRequests).toBe(1);
		expect(packRequests).toBe(1);
	});
	it('cancels one shared-pack waiter without cancelling another', async () => {
		const h = packHarness();
		const firstController = new AbortController();
		const secondController = new AbortController();
		const first = h.start(firstController.signal);
		const second = h.start(secondController.signal);
		const firstResult = expect(first).rejects.toThrow('first waiter stopped');

		await tick();
		firstController.abort(new Error('first waiter stopped'));
		await firstResult;
		expect(secondController.signal.aborted).toBe(false);
		expect(h.count('/sysroot/wasip1.index.json.gz')).toBe(1);
		expect(h.count('/sysroot/wasip1.pack.gz')).toBe(1);
		expect(h.pending.every((request) => request.signal === undefined)).toBe(true);

		h.finish();
		await expect(second).resolves.toMatchObject({
			fetchedAssets: expect.arrayContaining([
				'https://example.test/sysroot/wasip1.index.json.gz',
				'https://example.test/sysroot/wasip1.pack.gz'
			])
		});
	});
	it('evicts a failed shared pack request so a later preload can retry', async () => {
		const manifest = createRuntimeManifest();
		let packRequests = 0;
		let indexRequests = 0;
		const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
			const path = new URL(String(url)).pathname;
			if (path.endsWith('.index.json.gz')) {
				indexRequests++;
				return new Response(
					JSON.stringify({
						format: 'wasm-go-runtime-pack-index-v1',
						fileCount: 2,
						totalBytes: 6,
						entries: [
							{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 },
							{ runtimePath: '/sysroot/runtime.a', offset: 3, length: 3 }
						]
					})
				);
			}
			if (path.endsWith('.pack.gz')) {
				packRequests++;
				return packRequests === 1
					? new Response('failed pack', { status: 503 })
					: new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
			}
			return new Response(new Uint8Array([1, 2, 3]));
		});
		const start = () =>
			preloadBrowserGoRuntime({
				manifest,
				runtimeBaseUrl: 'https://retry.example.test/',
				fetchImpl
			});

		await expect(start()).rejects.toThrow(/status 503/);
		await expect(start()).resolves.toMatchObject({ target: { target: 'wasip1/wasm' } });
		expect(indexRequests).toBe(1);
		expect(packRequests).toBe(2);
	});
});
