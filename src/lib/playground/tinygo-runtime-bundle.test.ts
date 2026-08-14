import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const assetsDir = path.join(checkoutRoot, 'static', 'wasm-tinygo', 'assets');
const toolsDir = path.join(checkoutRoot, 'static', 'wasm-tinygo', 'tools');

describe('bundled wasm-tinygo runtime', () => {
	it('keeps the legacy direct-mode artifact classified as a porting harness, not upstream TinyGo', () => {
		const runtimeChunk = readdirSync(assetsDir).find(
			(entry) => entry.startsWith('runtime-') && entry.endsWith('.js')
		);
		expect(runtimeChunk).toBeTruthy();
		const runtimeChunkSource = readFileSync(path.join(assetsDir, runtimeChunk!), 'utf8');
		const compilerManifest = JSON.parse(
			readFileSync(path.join(toolsDir, 'tinygo-compiler.json'), 'utf8')
		) as {
			buildMode?: string;
			artifactKind?: string;
			format?: string;
			producerId?: string;
			upstreamCompiler?: boolean;
			implementationKind?: string;
		};

		expect(compilerManifest.buildMode).toBe('direct');
		// Older generated bundles predate implementationKind. These two generic fields are not
		// accepted as evidence of upstream TinyGo identity.
		expect(['compiler', 'porting-harness']).toContain(compilerManifest.artifactKind);
		if (compilerManifest.implementationKind !== undefined) {
			expect(compilerManifest.implementationKind).toBe('wasm-idle-go-ast-to-c-subset');
		}
		expect(compilerManifest.format).not.toBe('wasm-llvm-tinygo-browser-compiler-v1');
		expect(compilerManifest.producerId).not.toBe('wasm-llvm/tinygo-browser');
		expect(compilerManifest.upstreamCompiler).not.toBe(true);
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
