import { describe, expect, it } from 'vitest';

import { createTinyGoRuntime } from '../../../runtimes/wasm-tinygo/src/runtime';

describe('TinyGo compiler runtime asset limits', () => {
	it('applies a replacement byte limit to subsequent asset loads', async () => {
		const requestedAssets: string[] = [];
		const runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			maxAssetBytes: 8,
			assetLoader: ({ assetPath }) => {
				requestedAssets.push(assetPath);
				return new Uint8Array([0, 1]);
			}
		});

		runtime.setMaxAssetBytes(1);

		await expect(runtime.runUpstreamProbe()).rejects.toThrow(
			'wasm-tinygo runtime asset tools/tinygo-upstream-probe.wasm exceeds the 1 byte limit'
		);
		expect(requestedAssets).toContain('tools/tinygo-upstream-probe.wasm');
		runtime.dispose();
	});
});
