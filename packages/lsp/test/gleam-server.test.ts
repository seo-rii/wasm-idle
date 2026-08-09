import { describe, expect, it, vi } from 'vitest';

import { getGleamLanguageServer, LanguageServerAssetConfigurationError } from '../src/index.js';

describe('getGleamLanguageServer', () => {
	it('rejects an unpinned custom runtime before creating a worker', async () => {
		const createWorker = vi.fn();

		await expect(
			getGleamLanguageServer({
				currentUrl: 'https://app.example.com/editor/',
				createWorker,
				gleam: {
					baseUrl: 'https://runtime.example.com/wasm-gleam/',
					manifestUrl: 'https://runtime.example.com/wasm-gleam/manifest.json'
				}
			})
		).rejects.toBeInstanceOf(LanguageServerAssetConfigurationError);
		expect(createWorker).not.toHaveBeenCalled();
	});
});
