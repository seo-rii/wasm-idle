import { describe, expect, it } from 'vitest';

import { loadBundledRuntimeContext } from '../src/compiler-runtime.js';
import {
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	parseRuntimeManifest,
	resolveTargetManifest
} from '../src/runtime-manifest.js';
import {
	createIntegratedRuntimeManifestV3,
	createRuntimeManifest,
	createRuntimeManifestV2,
	createRuntimeManifestV3
} from './helpers.js';

describe('runtime manifest edge cases', () => {
	it('rejects malformed runtime manifest fields', () => {
		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				rustcWasm: ''
			})
		).toThrow(/invalid rustcWasm/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				rustcMemory: {
					initialPages: 8,
					maximumPages: 0
				}
			})
		).toThrow(/invalid rustcMemory.maximumPages/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				link: {
					...createRuntimeManifest().link,
					args: ['-o', '']
				}
			})
		).toThrow(/invalid link.args/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				sysrootFiles: [{ asset: '', runtimePath: '/libstd.rlib' }]
			})
		).toThrow(/invalid sysrootFiles\[0\]\.asset/);
	});

	it('rejects malformed v2 target fields', () => {
		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV2(),
				defaultTargetTriple: 'wasm32-wasi'
			})
		).toThrow(/invalid defaultTargetTriple/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV2(),
				targets: {
					...createRuntimeManifestV2().targets,
					'wasm32-wasip2': {
						...createRuntimeManifestV2().targets['wasm32-wasip2'],
						artifactFormat: 'wasm'
					}
				}
			})
		).toThrow(/invalid targets\.wasm32-wasip2\.artifactFormat/);
	});

	it('rejects malformed v3 pack fields', () => {
		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV3(),
				targets: {
					...createRuntimeManifestV3().targets,
					'wasm32-wasip1': {
						...createRuntimeManifestV3().targets['wasm32-wasip1'],
						sysrootPack: {
							...createRuntimeManifestV3().targets['wasm32-wasip1'].sysrootPack,
							asset: ''
						}
					}
				}
			})
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.asset/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV3(),
				targets: {
					...createRuntimeManifestV3().targets,
					'wasm32-wasip1': {
						...createRuntimeManifestV3().targets['wasm32-wasip1'],
						compile: {
							...createRuntimeManifestV3().targets['wasm32-wasip1'].compile,
							link: {
								args: ['-o', '/work/main.wasm']
							}
						}
					}
				}
			})
		).toThrow(/missing legacy link asset fields/);
	});

	it('parses recursive delta pack references and accepts zero byte counts', () => {
		const fixture = createRuntimeManifestV3();
		const zeroByteBasePack = {
			asset: 'packs/sysroot/base.pack',
			index: 'packs/sysroot/base.index.json',
			fileCount: 0,
			totalBytes: 0
		};
		const middlePack = {
			asset: 'packs/sysroot/middle.delta.pack',
			index: 'packs/sysroot/middle.delta.index.json',
			fileCount: 0,
			totalBytes: 0,
			decodedTotalBytes: 0,
			delta: {
				format: 'copy-literal-v1',
				base: zeroByteBasePack
			}
		};
		const deltaPack = {
			asset: 'packs/sysroot/final.delta.pack',
			index: 'packs/sysroot/final.delta.index.json',
			fileCount: 0,
			totalBytes: 0,
			decodedTotalBytes: 0,
			delta: {
				format: 'copy-literal-v1',
				base: middlePack
			}
		};

		const manifest = normalizeRuntimeManifest(
			parseRuntimeManifest({
				...fixture,
				targets: {
					...fixture.targets,
					'wasm32-wasip1': {
						...fixture.targets['wasm32-wasip1'],
						sysrootPack: deltaPack
					}
				}
			})
		);

		expect(manifest.targets['wasm32-wasip1']?.sysrootPack).toEqual(deltaPack);
	});

	it('rejects invalid delta formats and negative nested pack sizes', () => {
		const fixture = createRuntimeManifestV3();
		const sysrootPack = fixture.targets['wasm32-wasip1'].sysrootPack;
		const createManifestWithPack = (pack: object) => ({
			...fixture,
			targets: {
				...fixture.targets,
				'wasm32-wasip1': {
					...fixture.targets['wasm32-wasip1'],
					sysrootPack: pack
				}
			}
		});

		expect(() =>
			parseRuntimeManifest(
				createManifestWithPack({
					...sysrootPack,
					decodedTotalBytes: 3,
					delta: { format: 'copy-literal-v2', base: sysrootPack }
				})
			)
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.delta\.format/);

		expect(() =>
			parseRuntimeManifest(
				createManifestWithPack({
					...sysrootPack,
					decodedTotalBytes: 3,
					delta: {
						format: 'copy-literal-v1',
						base: { ...sysrootPack, totalBytes: -1 }
					}
				})
			)
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.delta\.base\.totalBytes/);

		expect(() =>
			parseRuntimeManifest(
				createManifestWithPack({
					...sysrootPack,
					decodedTotalBytes: 3,
					delta: {
						format: 'copy-literal-v1',
						base: { ...sysrootPack, fileCount: -1 }
					}
				})
			)
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.delta\.base\.fileCount/);

		expect(() =>
			parseRuntimeManifest(createManifestWithPack({ ...sysrootPack, decodedTotalBytes: -1 }))
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.decodedTotalBytes/);
	});

	it('accepts integrated rustc targets without split LLVM or link assets', () => {
		const manifest = normalizeRuntimeManifest(
			parseRuntimeManifest(createIntegratedRuntimeManifestV3())
		);

		expect(manifest.compiler.workerBitcodeFile).toBe('main.wasm');
		expect(manifest.targets['wasm32-wasip1']?.compile).toEqual({
			kind: 'integrated-rustc'
		});
		expect(manifest.targets['wasm32-wasip3']?.compile).toEqual({
			kind: 'integrated-rustc+component-encoder'
		});
	});

	it('fails to resolve an unavailable target from the normalized manifest', () => {
		const manifest = normalizeRuntimeManifest(
			parseRuntimeManifest({
				...createRuntimeManifestV2(),
				targets: {
					'wasm32-wasip1': createRuntimeManifestV2().targets['wasm32-wasip1']
				}
			})
		);

		expect(() => resolveTargetManifest(manifest, 'wasm32-wasip2')).toThrow(
			/unsupported wasm-rust target wasm32-wasip2/
		);
		expect(() => resolveTargetManifest(manifest, 'wasm32-wasip3')).toThrow(
			/unsupported wasm-rust target wasm32-wasip3/
		);
	});

	it('fails when runtime-manifest fetch returns a non-ok response', async () => {
		await expect(
			loadRuntimeManifest(
				'https://example.com/runtime-manifest.json',
				async () =>
					({
						ok: false,
						status: 500,
						statusText: 'Internal Server Error'
					}) as Response
			)
		).rejects.toMatchObject({
			manifestUrl: 'https://example.com/runtime-manifest.json',
			status: 500
		});
		await expect(
			loadRuntimeManifest(
				'https://example.com/runtime-manifest.json',
				async () =>
					({
						ok: false,
						status: 500,
						statusText: 'Internal Server Error'
					}) as Response
			)
		).rejects.toThrow(
			'failed to load wasm-rust runtime manifest from https://example.com/runtime-manifest.json (HTTP 500 Internal Server Error)'
		);
	});

	it('falls back from v3 to an older bundled manifest only when the newer manifest is missing', async () => {
		const requestedUrls: string[] = [];
		const loaded = await loadBundledRuntimeContext(async (manifestUrl) => {
			const url = manifestUrl.toString();
			requestedUrls.push(url);
			if (url.endsWith('runtime-manifest.v3.json')) {
				throw Object.assign(new Error('missing v3 manifest'), { status: 404 });
			}
			if (url.endsWith('runtime-manifest.v2.json')) {
				return createRuntimeManifestV2();
			}
			throw new Error(`unexpected manifest request: ${url}`);
		});

		expect(requestedUrls).toEqual([
			expect.stringContaining('runtime-manifest.v3.json'),
			expect.stringContaining('runtime-manifest.v2.json')
		]);
		expect(loaded.manifest.manifestVersion).toBe(2);
		expect(loaded.targetConfig.targetTriple).toBe('wasm32-wasip1');
	});

	it('does not hide a broken v3 manifest behind legacy fallback loading', async () => {
		await expect(
			loadBundledRuntimeContext(async (manifestUrl) => {
				if (manifestUrl.toString().endsWith('runtime-manifest.v3.json')) {
					throw new Error('broken v3 manifest');
				}
				return createRuntimeManifestV2();
			})
		).rejects.toThrow('broken v3 manifest');
	});
});
