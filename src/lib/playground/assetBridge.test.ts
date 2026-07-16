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
