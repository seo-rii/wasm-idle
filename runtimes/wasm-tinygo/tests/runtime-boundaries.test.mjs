import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the TinyGo runtime does not preload cross-runtime assets', async () => {
	const runtimeSource = await readFile(new URL('../src/runtime.ts', import.meta.url), 'utf8');

	assert.doesNotMatch(runtimeSource, /rustRuntime(?:BaseUrl|AssetPacks|ManifestLoaded)/);
	assert.doesNotMatch(runtimeSource, /wasm-rust runtime manifest/);
});
