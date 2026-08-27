import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadLanguageToolAsset: vi.fn(),
	preflightAwkRuntimeAssets: vi.fn()
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	preflightAwkRuntimeAssets: mocks.preflightAwkRuntimeAssets
}));

vi.mock('../src/assets.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/assets.js')>()),
	loadLanguageToolAsset: mocks.loadLanguageToolAsset
}));

import { getAwkLanguageServer } from '../src/awk/server.js';

afterEach(() => {
	mocks.loadLanguageToolAsset.mockReset();
	mocks.preflightAwkRuntimeAssets.mockReset();
});

describe('getAwkLanguageServer startup settlement', () => {
	it('rejects promptly when the runner fails while runtime preflight never settles', async () => {
		mocks.preflightAwkRuntimeAssets.mockImplementation(() => new Promise(() => undefined));
		mocks.loadLanguageToolAsset.mockRejectedValue(new Error('runner preflight failed'));
		const createWorker = vi.fn();

		await expect(
			getAwkLanguageServer({
				rootUrl: '/wasm-idle/',
				currentUrl: 'https://app.example.com/wasm-idle/editor',
				createWorker
			})
		).rejects.toThrow('runner preflight failed');

		expect(mocks.preflightAwkRuntimeAssets).toHaveBeenCalledOnce();
		expect(mocks.preflightAwkRuntimeAssets.mock.calls[0]?.[0].signal.aborted).toBe(true);
		expect(mocks.loadLanguageToolAsset).toHaveBeenCalledOnce();
		expect(createWorker).not.toHaveBeenCalled();
	}, 1000);
});
