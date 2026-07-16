import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the TinyGo runtime does not preload cross-runtime assets', async () => {
	const runtimeSource = await readFile(new URL('../src/runtime.ts', import.meta.url), 'utf8');

	assert.doesNotMatch(runtimeSource, /rustRuntime(?:BaseUrl|AssetPacks|ManifestLoaded)/);
	assert.doesNotMatch(runtimeSource, /wasm-rust runtime manifest/);
});

test('TinyGo build tooling owns its LLVM consumer contract locally', async () => {
	const [packageSource, fetchSource, patchSource] = await Promise.all([
		readFile(new URL('../package.json', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/fetch-emception-worker.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/patch-emception-worker-source.mjs', import.meta.url), 'utf8')
	]);
	const packageJson = JSON.parse(packageSource);

	assert.equal(packageJson.dependencies?.['@seo-rii/wasm-llvm'], undefined);
	assert.match(fetchSource, /scripts\/llvm-contracts\/tinygo\.mjs/u);
	assert.match(patchSource, /scripts\/llvm-contracts\/tinygo\.mjs/u);
	assert.doesNotMatch(`${fetchSource}\n${patchSource}`, /from\s+['"]@seo-rii\/wasm-llvm/u);
});
