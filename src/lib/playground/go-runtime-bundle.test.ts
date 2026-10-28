// @vitest-environment node

import { link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeAssetLock } from '../../../scripts/generate-runtime-asset-lock.mjs';
import { RUNTIME_ASSET_LOCK } from '../../../packages/core/src/runtime-asset-lock.generated';
import compilerSource from '../../../static/wasm-go/compiler.js?raw';
import browserExecutionSource from '../../../static/wasm-go/browser-execution.js?raw';
import runtimeManifestSource from '../../../static/wasm-go/runtime/runtime-manifest.v1.json?raw';
import { describe, expect, it } from 'vitest';

describe('bundled wasm-go compiler', () => {
	it('pins the complete delivered Go profile in the global compression index and asset lock', async () => {
		const temporary = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-go-release-'));
		const rootDir = path.join(temporary, 'static');
		const source = fileURLToPath(new URL('../../../static/wasm-go/', import.meta.url));
		const target = path.join(rootDir, 'wasm-go');
		async function linkDirectory(from: string, to: string) {
			await mkdir(to, { recursive: true });
			for (const entry of await readdir(from, { withFileTypes: true })) {
				const fromPath = path.join(from, entry.name);
				const toPath = path.join(to, entry.name);
				if (entry.isDirectory()) await linkDirectory(fromPath, toPath);
				else await link(fromPath, toPath);
			}
		}
		try {
			// Share immutable payloads while checking this whole runtime with the official generator.
			await linkDirectory(source, target);
			const compressed = JSON.parse(
				await readFile(
					new URL('../../../static/compressed-runtime-assets.v1.json', import.meta.url),
					'utf8'
				)
			);
			const assets = compressed.assets.filter((asset: string) =>
				asset.startsWith('wasm-go/')
			);
			expect(assets.length).toBeGreaterThan(0);
			await writeFile(
				path.join(rootDir, 'compressed-runtime-assets.v1.json'),
				JSON.stringify({
					assets,
					sizes: Object.fromEntries(
						assets.map((asset: string) => [asset, compressed.sizes[asset]])
					)
				})
			);
			const canonical = await createRuntimeAssetLock({
				rootDir,
				packageFile: fileURLToPath(new URL('../../../package.json', import.meta.url))
			});
			const goEntries = (entries: typeof RUNTIME_ASSET_LOCK.assets) =>
				Object.fromEntries(
					Object.entries(entries).filter(([asset]) => asset.startsWith('wasm-go/'))
				);
			expect(goEntries(RUNTIME_ASSET_LOCK.assets)).toEqual(goEntries(canonical.assets));
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}, 30_000);

	it('ships the asset-aware progress mapping instead of the coarse fallback ranges', () => {
		expect(compilerSource).toContain('compile: [20, 88]');
		expect(compilerSource).toContain('link: [88, 97]');
		expect(compilerSource).toContain('resolving compile inputs');
		expect(compilerSource).toContain('preparing compile runtime');
		expect(compilerSource).not.toContain('compile: [35, 75]');
		expect(compilerSource).not.toContain('link: [75, 95]');
	});

	it('ships the js/wasm browser execution path in the synced runtime bundle', () => {
		expect(runtimeManifestSource).toContain('"js/wasm"');
		expect(runtimeManifestSource).toContain('"artifactFormat": "js-wasm"');
		expect(runtimeManifestSource).toContain('"wasmExecJs": "runtime/wasm_exec.js"');
		expect(compilerSource).toContain("target.execution.kind === 'js-wasm-exec'");
		expect(browserExecutionSource).toContain("artifact.target === 'js/wasm'");
		expect(browserExecutionSource).toContain('wasm_exec.js');
	});
});
