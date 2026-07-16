// @vitest-environment node

import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
				await readFile(new URL(`${language}/blazor.boot.json`, runtimeRoot), 'utf8')
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

	it('stores each native runtime as gzip-only and registers its logical URL', async () => {
		const compressedManifest = JSON.parse(
			await readFile(
				new URL('../../static/compressed-runtime-assets.v1.json', import.meta.url),
				'utf8'
			)
		) as { assets: string[] };

		for (const language of ['csharp', 'fsharp', 'vbnet']) {
			const logicalPath = `wasm-dotnet/runtime/${language}/dotnet.native.wasm`;
			await expect(stat(new URL(`${language}/dotnet.native.wasm`, runtimeRoot))).rejects.toThrow();
			await expect(stat(new URL(`${language}/dotnet.native.wasm.gz`, runtimeRoot))).resolves.toBeDefined();
			expect(compressedManifest.assets).toContain(logicalPath);
		}
	});
});
