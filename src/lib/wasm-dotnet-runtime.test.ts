// @vitest-environment node

import { readFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const staticRoot = new URL('../../static/', import.meta.url);
const runtimeRoot = new URL('../../static/wasm-dotnet/runtime/', import.meta.url);
const compilerAssets = [
	'FSharp.Compiler.Service.wasm',
	'FSharp.Core.wasm',
	'Microsoft.CodeAnalysis.CSharp.wasm',
	'Microsoft.CodeAnalysis.VisualBasic.wasm',
	'Microsoft.CodeAnalysis.wasm'
] as const;
const expectedCompilers = {
	csharp: ['Microsoft.CodeAnalysis.CSharp.wasm', 'Microsoft.CodeAnalysis.wasm'],
	fsharp: ['FSharp.Compiler.Service.wasm', 'FSharp.Core.wasm'],
	vbnet: ['Microsoft.CodeAnalysis.VisualBasic.wasm', 'Microsoft.CodeAnalysis.wasm']
} as const;

type LayeredRuntimeManifest = {
	assets: Record<string, { layer: string; length: number; offset: number }>;
};

const layeredManifestPromise = readFile(
	new URL('layered-runtime-assets.v1.json', staticRoot),
	'utf8'
).then((source) => JSON.parse(source) as LayeredRuntimeManifest);

async function readLogicalStaticAsset(logicalPath: string) {
	const rawBytes = await readFile(new URL(logicalPath, staticRoot)).catch(() => null);
	if (rawBytes) return rawBytes;
	const compressedBytes = await readFile(new URL(`${logicalPath}.gz`, staticRoot)).catch(
		() => null
	);
	if (compressedBytes) return gunzipSync(compressedBytes);

	const entry = (await layeredManifestPromise).assets[logicalPath];
	if (!entry)
		throw new Error(`static asset is neither raw, compressed, nor layered: ${logicalPath}`);
	const layerBytes = gunzipSync(await readFile(new URL(entry.layer, staticRoot)));
	return layerBytes.subarray(entry.offset, entry.offset + entry.length);
}

describe('checked-in wasm-dotnet runtime', () => {
	it('keeps compiler assets isolated in language-specific AOT bundles', async () => {
		const runtimeManifest = JSON.parse(
			await readFile(new URL('manifest.json', runtimeRoot), 'utf8')
		);
		expect(Object.keys(runtimeManifest.languages).sort()).toEqual([
			'csharp',
			'fsharp',
			'vbnet'
		]);

		for (const [language, expected] of Object.entries(expectedCompilers)) {
			const boot = JSON.parse(
				new TextDecoder().decode(
					await readLogicalStaticAsset(`wasm-dotnet/runtime/${language}/blazor.boot.json`)
				)
			);
			const compilerResources = Object.fromEntries(
				Object.entries(boot.resources.coreAssembly || {}).filter(([name]) =>
					compilerAssets.includes(name as (typeof compilerAssets)[number])
				)
			);
			expect(Object.keys(compilerResources).sort()).toEqual([...expected].sort());
			for (const group of ['assembly', 'lazyAssembly']) {
				expect(
					Object.keys(boot.resources[group] || {}).filter((name) =>
						compilerAssets.includes(name as (typeof compilerAssets)[number])
					)
				).toEqual([]);
			}
		}
	});

	it('serves language compiler assemblies only from bounded runtime layers', async () => {
		const layeredManifest = await layeredManifestPromise;
		const samples = {
			csharp: 'Microsoft.CodeAnalysis.CSharp.wasm',
			fsharp: 'FSharp.Compiler.Service.wasm',
			vbnet: 'Microsoft.CodeAnalysis.VisualBasic.wasm'
		};

		for (const [language, filename] of Object.entries(samples)) {
			const logicalPath = `wasm-dotnet/runtime/${language}/${filename}`;
			await expect(stat(new URL(`${language}/${filename}`, runtimeRoot))).rejects.toThrow();
			await expect(
				stat(new URL(`${language}/${filename}.gz`, runtimeRoot))
			).rejects.toThrow();
			expect(layeredManifest.assets[logicalPath]?.layer).toMatch(
				new RegExp(`^wasm-dotnet/runtime/layers/${language}-\\d+\\.pack\\.gz$`)
			);
			expect((await readLogicalStaticAsset(logicalPath)).byteLength).toBeGreaterThan(0);
		}
	});

	it('stores each native runtime as gzip-only and registers its logical URL', async () => {
		const compressedManifest = JSON.parse(
			await readFile(
				new URL('../../static/compressed-runtime-assets.v1.json', import.meta.url),
				'utf8'
			)
		) as { assets: string[] };

		for (const language of ['csharp', 'fsharp', 'vbnet']) {
			const logicalPath = `wasm-dotnet/runtime/${language}/dotnet.native.wasm`;
			await expect(
				stat(new URL(`${language}/dotnet.native.wasm`, runtimeRoot))
			).rejects.toThrow();
			await expect(
				stat(new URL(`${language}/dotnet.native.wasm.gz`, runtimeRoot))
			).resolves.toBeDefined();
			expect(compressedManifest.assets).toContain(logicalPath);
		}
	});
});
