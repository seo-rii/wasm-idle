import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const assetsDir = path.join(checkoutRoot, 'static', 'wasm-tinygo', 'assets');
const toolsDir = path.join(checkoutRoot, 'static', 'wasm-tinygo', 'tools');

describe('bundled wasm-tinygo runtime', () => {
	it('resolves runtime fixtures from the active checkout', () => {
		expect(path.relative(checkoutRoot, assetsDir)).toBe('static/wasm-tinygo/assets');
		expect(path.relative(checkoutRoot, toolsDir)).toBe('static/wasm-tinygo/tools');
	});

	it('ships the direct-mode runtime and runtime asset progress through the bundled browser module', () => {
		const runtimeChunk = readdirSync(assetsDir).find(
			(entry) => entry.startsWith('runtime-') && entry.endsWith('.js')
		);
		expect(runtimeChunk).toBeTruthy();
		const runtimeChunkSource = readFileSync(path.join(assetsDir, runtimeChunk!), 'utf8');
		const compilerManifest = JSON.parse(
			readFileSync(path.join(toolsDir, 'tinygo-compiler.json'), 'utf8')
		) as { buildMode?: string; artifactKind?: string };

		expect(compilerManifest.buildMode).toBe('direct');
		expect(compilerManifest.artifactKind).toBe('compiler');
		expect(runtimeChunkSource).toContain('assetPath:');
		expect(runtimeChunkSource).toContain('onProgress:e.onProgress');
		expect(runtimeChunkSource).toMatch(/loaded:e,total:[a-z]/);
		expect(runtimeChunkSource).toContain(
			'tinygo compiler module loaded from tools/tinygo-compiler.wasm'
		);
		expect(runtimeChunkSource).toContain(
			'frontend bootstrap tool plan skipped: backend lowering is active'
		);
	});
});
