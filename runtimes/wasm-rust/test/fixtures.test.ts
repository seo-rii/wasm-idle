import { describe, expect, it } from 'vitest';

import {
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	parseRuntimeManifest,
	resolveRuntimeAssetUrl
} from '../src/runtime-manifest.js';
import { createRuntimeManifest, createRuntimeManifestV2, createRuntimeManifestV3 } from './helpers.js';

describe('wasm-rust runtime manifest', () => {
	it('parses the generated manifest shape', () => {
		const manifest = normalizeRuntimeManifest(parseRuntimeManifest(createRuntimeManifest()));

		expect(manifest.defaultTargetTriple).toBe('wasm32-wasip1');
		expect(manifest.compiler.workerBitcodeFile).toBe(
			'main.main.1ca70c240d7de168-cgu.0.rcgu.no-opt.bc'
		);
		expect(manifest.targets['wasm32-wasip1']?.compile.link.args).toContain('/work/main.wasm');
		expect(manifest.targets['wasm32-wasip1']?.compile.llvm.llcWasm).toBe('llvm/llc.wasm');
	});

	it('parses and normalizes the v2 manifest shape', () => {
		const manifest = normalizeRuntimeManifest(parseRuntimeManifest(createRuntimeManifestV2()));

		expect(manifest.manifestVersion).toBe(2);
		expect(manifest.defaultTargetTriple).toBe('wasm32-wasip1');
		expect(manifest.targets['wasm32-wasip2']?.artifactFormat).toBe('component');
		expect(manifest.targets['wasm32-wasip2']?.execution.kind).toBe('preview2-component');
		expect(manifest.targets['wasm32-wasip3']?.artifactFormat).toBe('component');
		expect(manifest.targets['wasm32-wasip3']?.execution.kind).toBe('preview2-component');
	});

	it('parses and normalizes the v3 pack manifest shape', () => {
		const manifest = normalizeRuntimeManifest(parseRuntimeManifest(createRuntimeManifestV3()));

		expect(manifest.manifestVersion).toBe(3);
		expect(manifest.targets['wasm32-wasip1']?.sysrootPack?.asset).toBe(
			'packs/sysroot/wasm32-wasip1.pack.gz'
		);
		expect(manifest.targets['wasm32-wasip2']?.compile.link.pack?.index).toBe(
			'packs/link/wasm32-wasip2.index.json.gz'
		);
		expect(manifest.targets['wasm32-wasip2']?.compile.llvm.lldData).toBe('llvm/lld.data.gz');
	});

	it('resolves asset URLs relative to the runtime base URL', () => {
		expect(
			resolveRuntimeAssetUrl('https://example.com/wasm-rust/runtime/', 'llvm/lld.js')
		).toBe('https://example.com/wasm-rust/runtime/llvm/lld.js');
	});

	it('loads and validates the manifest through fetch', async () => {
		const manifest = createRuntimeManifestV3();
		const loaded = await loadRuntimeManifest('https://example.com/runtime-manifest.json', async () => ({
			ok: true,
			json: async () => manifest
		}) as Response);

		expect(loaded.version).toBe(manifest.version);
		expect(normalizeRuntimeManifest(loaded).targets['wasm32-wasip1']?.sysrootPack?.asset).toBe(
			manifest.targets['wasm32-wasip1']?.sysrootPack?.asset
		);
	});
});
