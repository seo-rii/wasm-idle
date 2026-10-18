// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WorkerAssetBridge } from './assetBridge';
import { resolveRuntimeAssetConfig, type ResolvedRuntimeAssetConfig } from './assets';
import { RuntimeAssetCache } from './runtimeAssetCache';

// Minimal valid modules exporting f(): i32 with a distinct result for each receipt.
const wasm = (value: number) =>
	Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		1,
		5,
		1,
		96,
		0,
		1,
		127,
		3,
		2,
		1,
		0,
		7,
		5,
		1,
		1,
		102,
		0,
		0,
		10,
		6,
		1,
		4,
		0,
		65,
		value,
		11
	]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('worker bridge integrity snapshots', () => {
	it.each([false, true])(
		'does not expose the verification snapshot as the loader receiver (module=%s)',
		async (module) => {
			const asset = 'pyodide.asm.wasm';
			const expected = wasm(1);
			const changed = wasm(2);
			let bytes = changed;
			const loader = vi.fn(function (this: ResolvedRuntimeAssetConfig | undefined) {
				if (this)
					this.integrity = { [asset]: { bytes: changed.length, sha256: hash(changed) } };
				return bytes;
			});
			const postMessage = vi.fn();
			const cache = new RuntimeAssetCache();
			const bridge = new WorkerAssetBridge(
				{ postMessage } as unknown as Worker,
				'python',
				{
					baseUrl: 'https://assets.test/python/',
					loader,
					integrity: { [asset]: { bytes: expected.length, sha256: hash(expected) } },
					persistentCache: false,
					useAssetBridge: true
				},
				undefined,
				1024,
				false,
				cache
			);
			const request = (id: number) =>
				bridge.handleMessage({
					data: { assetRequest: { id, asset, module } }
				} as MessageEvent);
			try {
				request(1);
				await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
				expect(postMessage.mock.calls[0][0].assetResponse.ok).toBe(false);
				expect(loader.mock.contexts).toEqual([undefined]);

				bytes = expected;
				request(2);
				await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
				request(3);
				await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));
				expect(loader).toHaveBeenCalledTimes(2);
				expect(loader.mock.contexts).toEqual([undefined, undefined]);
				for (const [message] of postMessage.mock.calls.slice(1)) {
					const response = message.assetResponse;
					expect(response.ok).toBe(true);
					if (module) {
						const instance = await WebAssembly.instantiate(
							response.module as WebAssembly.Module
						);
						expect((instance.exports.f as () => number)()).toBe(1);
					} else {
						expect(new Uint8Array(response.bytes)).toEqual(expected);
					}
				}
			} finally {
				bridge.dispose();
				cache.dispose();
			}
		}
	);

	it('replies with an error when a caller-owned receipt getter fails during capture', async () => {
		const integrity = Object.defineProperty({}, 'pyodide.asm.wasm', {
			enumerable: true,
			get() {
				throw new Error('receipt unavailable');
			}
		});
		const loader = vi.fn();
		const postMessage = vi.fn();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'python', {
			baseUrl: 'https://assets.test/python/',
			loader,
			integrity,
			useAssetBridge: true
		});
		try {
			bridge.handleMessage({
				data: { assetRequest: { id: 1, asset: 'pyodide.asm.wasm' } }
			} as MessageEvent);
			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
			expect(postMessage).toHaveBeenCalledWith({
				assetResponse: { id: 1, ok: false, error: 'receipt unavailable' }
			});
			expect(loader).not.toHaveBeenCalled();
		} finally {
			bridge.dispose();
		}
	});

	it.each([
		{ module: false, mutation: 'receipt' },
		{ module: true, mutation: 'receipt' },
		{ module: false, mutation: 'replace' },
		{ module: true, mutation: 'replace' },
		{ module: false, mutation: 'delete' },
		{ module: true, mutation: 'delete' }
	])(
		'keeps the initial receipt when $mutation changes during loading (module=$module)',
		async ({ module, mutation }) => {
			const asset = 'pyodide.asm.wasm';
			const expected = wasm(1);
			const changed = wasm(2);
			const receipt = { bytes: expected.byteLength, sha256: hash(expected) };
			const integrity: Record<string, typeof receipt> = { [asset]: receipt };
			let deliver!: (value: Uint8Array) => void;
			const loader = vi.fn(
				() =>
					new Promise<Uint8Array>((resolve) => {
						deliver = resolve;
					})
			);
			const config = resolveRuntimeAssetConfig('python', {
				persistentCache: false,
				python: { baseUrl: 'https://assets.test/python/', loader, integrity }
			});
			const postMessage = vi.fn();
			const cache = new RuntimeAssetCache();
			const bridge = new WorkerAssetBridge(
				{ postMessage } as unknown as Worker,
				'python',
				config,
				undefined,
				1024,
				false,
				cache
			);
			const request = (id: number) =>
				bridge.handleMessage({
					data: { assetRequest: { id, asset, module } }
				} as MessageEvent);
			try {
				request(1);
				await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
				if (mutation === 'receipt') receipt.sha256 = hash(changed);
				else if (mutation === 'replace')
					integrity[asset] = { ...receipt, sha256: hash(changed) };
				else delete integrity[asset];
				deliver(changed);
				await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
				expect(postMessage.mock.calls[0][0].assetResponse.ok).toBe(false);

				receipt.sha256 = hash(expected);
				integrity[asset] = receipt;
				request(2);
				await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
				deliver(expected);
				await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
				request(3);
				await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));
				expect(loader).toHaveBeenCalledTimes(2);
				for (const [message] of postMessage.mock.calls.slice(1)) {
					const response = message.assetResponse;
					expect(response.ok).toBe(true);
					if (module) {
						const instance = await WebAssembly.instantiate(
							response.module as WebAssembly.Module
						);
						expect((instance.exports.f as () => number)()).toBe(1);
					} else {
						expect(new Uint8Array(response.bytes)).toEqual(expected);
					}
				}
			} finally {
				bridge.dispose();
				cache.dispose();
			}
		}
	);
});
