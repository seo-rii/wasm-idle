import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { RUNTIME_LOAD_ASSETS } from '$lib/playground/assets';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';

describe('WorkerAssetBridge progress', () => {
	it('does not mark an asset complete from the first chunk when its total is unknown', () => {
		const progress = { set: vi.fn() };
		const bridge = new WorkerAssetBridge(
			{ postMessage: vi.fn() } as unknown as Worker,
			'clang',
			{ baseUrl: '/clang/', useAssetBridge: true },
			progress
		);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetProgress: { asset, loaded: 64 * 1024 } }
		} as MessageEvent);
		expect(progress.set).toHaveBeenLastCalledWith(0);

		bridge.handleMessage({
			data: { assetProgress: { asset, loaded: 64 * 1024, total: 128 * 1024 } }
		} as MessageEvent);
		expect(progress.set).toHaveBeenLastCalledWith(0.125);

		bridge.handleMessage({
			data: { assetProgress: { asset, loaded: 128 * 1024, total: 128 * 1024 } }
		} as MessageEvent);
		expect(progress.set).toHaveBeenLastCalledWith(0.25);
	});
});

describe('WorkerAssetBridge asset requests', () => {
	it('rejects assets outside the runtime allowlist before calling the loader', async () => {
		const postMessage = vi.fn();
		const loader = vi.fn();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			useAssetBridge: true
		});

		expect(
			bridge.handleMessage({
				data: {
					assetRequest: { id: 7, asset: 'https://example.com/private-resource' }
				}
			} as MessageEvent)
		).toBe(true);

		await vi.waitFor(() => {
			expect(postMessage).toHaveBeenCalledWith({
				assetResponse: {
					id: 7,
					ok: false,
					error: 'Unexpected clang runtime asset: https://example.com/private-resource'
				}
			});
		});
		expect(loader).not.toHaveBeenCalled();
	});

	it('continues loading assets declared for the runtime', async () => {
		const postMessage = vi.fn();
		const loader = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 8, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(loader).toHaveBeenCalledWith({
			runtime: 'clang',
			asset,
			reportProgress: expect.any(Function)
		});
		expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 8, ok: true, mimeType: undefined }
		});
	});
});
