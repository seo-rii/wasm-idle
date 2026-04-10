import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const assetsDir = path.resolve(
	'/home/seorii/dev/hancomac/wasm-idle/static/wasm-tinygo/assets'
);
const toolsDir = path.resolve('/home/seorii/dev/hancomac/wasm-idle/static/wasm-tinygo/tools');

describe('bundled wasm-tinygo runtime', () => {
	it('ships the direct-mode runtime and runtime asset progress through the bundled browser module', () => {
		const runtimeChunk = readdirSync(assetsDir).find(
			(entry) => entry.startsWith('runtime-') && entry.endsWith('.js')
		);
		expect(runtimeChunk).toBeTruthy();
		const runtimeChunkSource = readFileSync(path.join(assetsDir, runtimeChunk!), 'utf8');
		const compilerManifest = JSON.parse(
			readFileSync(path.join(toolsDir, 'tinygo-compiler.json'), 'utf8')
		) as { buildMode?: string };

		expect(compilerManifest.buildMode).toBe('direct');
		expect(runtimeChunkSource).toContain('assetPath:');
		expect(runtimeChunkSource).toContain('onProgress:e.onProgress');
		expect(runtimeChunkSource).toMatch(/loaded:e,total:[a-z]/);
		expect(runtimeChunkSource).toContain('mode=direct');
		expect(runtimeChunkSource).toContain('frontend bootstrap tool plan skipped: backend lowering is active');
	});
});
