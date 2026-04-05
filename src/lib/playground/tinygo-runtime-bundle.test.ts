import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const assetsDir = path.resolve(
	'/home/seorii/dev/hancomac/wasm-idle/static/wasm-tinygo/assets'
);

describe('bundled wasm-tinygo runtime', () => {
	it('ships runtime asset progress through the bundled browser module', () => {
		const runtimeChunk = readdirSync(assetsDir).find(
			(entry) => entry.startsWith('runtime-') && entry.endsWith('.js')
		);
		expect(runtimeChunk).toBeTruthy();
		const runtimeChunkSource = readFileSync(path.join(assetsDir, runtimeChunk!), 'utf8');

		expect(runtimeChunkSource).toContain('assetPath:');
		expect(runtimeChunkSource).toContain('onProgress:e.onProgress');
		expect(runtimeChunkSource).toMatch(/loaded:e,total:[a-z]/);
	});
});
