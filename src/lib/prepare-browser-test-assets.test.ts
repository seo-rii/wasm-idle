// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	normalizeBrowserTestAssetGroups,
	prepareBrowserTestAssets,
	verifyBrowserTestAssets
} from '../../scripts/prepare-browser-test-assets.mjs';
import { loadBundledProfile } from '../../scripts/verify-pinned-runtime-assets.mjs';
import { computeBundleFingerprint } from '../../scripts/sync-wasm-of-js-of-ocaml.mjs';
import { WASM_OCAML_RUNTIME_PROFILE } from './playground/wasmOcamlVersion';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('browser test asset preparation', () => {
	it('downloads current receipt-pinned clangd assets and headers from their configured group base', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clangd-group-base-'));
		temporaryDirectories.push(root);
		const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
		const rawHeaders = Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				version: 'fixture',
				targetTriple: 'wasm32-wasi',
				resourceDir: '/lib/clang/22',
				files: {
					'/usr/include/wasm32-wasi/stdio.h': 'C header',
					'/usr/include/c++/v1/vector': 'C++ header',
					'/lib/clang/22/include/stddef.h': 'resource header'
				}
			})
		);
		const encodedHeaders = gzipSync(rawHeaders);
		const headers = {
			asset: 'clangd/clangd.headers.json.gz',
			format: 'clangd-headers-v1',
			version: hash(rawHeaders),
			targetTriple: 'wasm32-wasi',
			resourceDir: '/lib/clang/22',
			bytes: encodedHeaders.length,
			sha256: hash(encodedHeaders),
			uncompressedBytes: rawHeaders.length,
			uncompressedSha256: hash(rawHeaders)
		};
		const contents = new Map([
			['clangd/clangd.js', Buffer.from('new clangd loader')],
			['clangd/clangd.wasm.gz', gzipSync(Buffer.from('new clangd wasm'))],
			[headers.asset, encodedHeaders]
		]);
		const assets = [...contents].map(([asset, bytes]) => ({
			asset,
			size: bytes.length,
			sha256: hash(bytes)
		}));
		const clangdReceiptPath = path.join(root, 'runtime-build.json');
		await writeFile(
			clangdReceiptPath,
			JSON.stringify({ toolchain: { clangd: { headers } }, assets })
		);
		const manifestPath = path.join(root, 'manifest.json');
		await writeFile(
			manifestPath,
			JSON.stringify({
				format: 'wasm-idle-browser-test-assets-v1',
				defaultBaseUrl: 'https://assets.example.test/old-immutable-release/',
				groupBaseUrls: { clangd: 'https://assets.example.test/current-release/' },
				assets: assets.map(({ asset, ...pin }) => ({
					group: 'clangd',
					source: asset,
					target: asset,
					...pin
				}))
			})
		);
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : input);
			expect(url.href).toMatch(
				/^https:\/\/assets\.example\.test\/current-release\/clangd\//u
			);
			return new Response(contents.get(url.pathname.slice('/current-release/'.length))!);
		});
		const options = {
			groups: ['clangd'],
			manifestPath,
			clangdReceiptPath,
			staticDir: path.join(root, 'static'),
			fetchImpl
		};
		await expect(prepareBrowserTestAssets(options)).resolves.toMatchObject({
			downloaded: 3,
			reused: 0
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		await expect(verifyBrowserTestAssets(options)).resolves.toMatchObject({ assetCount: 3 });
		fetchImpl.mockClear();
		await expect(prepareBrowserTestAssets(options)).resolves.toMatchObject({
			downloaded: 0,
			reused: 3
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('checks the generated OCaml graph using the same fingerprint before and after delivery compression', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-ocaml-fingerprint-'));
		temporaryDirectories.push(root);
		const runtimeDir = path.join(root, 'browser-native');
		await mkdir(runtimeDir);
		const first = Buffer.from('compiler wrapper');
		await writeFile(path.join(runtimeDir, 'first.js'), first);
		await writeFile(path.join(runtimeDir, 'second.js'), 'worker implementation');
		const archive = path.join(runtimeDir, 'tool.js.gz');
		await writeFile(archive, gzipSync(Buffer.from('pinned compressed compiler input')));
		const expected = await computeBundleFingerprint([runtimeDir]);
		await rm(path.join(runtimeDir, 'first.js'));
		await writeFile(path.join(runtimeDir, 'first.js.gz'), gzipSync(first));
		const compressedManifestPath = path.join(root, 'compressed-runtime-assets.v1.json');
		await writeFile(
			compressedManifestPath,
			JSON.stringify({
				assets: ['browser-native/first.js', 'browser-native/tool.js'],
				sizes: { 'browser-native/first.js': first.length, 'browser-native/tool.js': 32 }
			})
		);
		const options = { compressedManifestPath, preserveCompressedPaths: [archive] };
		expect(await computeBundleFingerprint([runtimeDir], options)).toBe(expected);
		await writeFile(path.join(runtimeDir, 'second.js'), 'stale worker implementation');
		expect(await computeBundleFingerprint([runtimeDir], options)).not.toBe(expected);
	});
	it('verifies both the pinned download and decoded runtime bytes, including built gzip delivery', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-decoded-assets-'));
		temporaryDirectories.push(root);
		const payload = Buffer.from('reviewed compiler bytes');
		const encoded = gzipSync(payload);
		const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
		const manifestPath = path.join(root, 'manifest.json');
		const manifest = {
			format: 'wasm-idle-browser-test-assets-v1',
			defaultBaseUrl: 'https://assets.example.test/legacy/',
			groupBaseUrls: { c3: 'https://assets.example.test/pinned/' },
			assets: [
				{
					group: 'c3',
					source: 'wasm-c3/c3c.wasm.gz',
					target: 'wasm-c3/c3c.wasm',
					size: encoded.length,
					sha256: hash(encoded),
					decoded: { size: payload.length, sha256: hash(payload) }
				}
			]
		};
		await writeFile(manifestPath, JSON.stringify(manifest));
		const staticDir = path.join(root, 'static');
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			expect(String(input)).toBe('https://assets.example.test/pinned/wasm-c3/c3c.wasm.gz');
			return new Response(encoded);
		});
		const options = {
			groups: ['c3'],
			manifestPath,
			staticDir,
			cacheDir: path.join(root, 'cache'),
			fetchImpl
		};
		await expect(prepareBrowserTestAssets(options)).resolves.toMatchObject({ downloaded: 1 });
		expect(await readFile(path.join(staticDir, 'wasm-c3/c3c.wasm'))).toEqual(payload);
		await expect(verifyBrowserTestAssets(options)).resolves.toMatchObject({ assetCount: 1 });
		await rm(path.join(staticDir, 'wasm-c3/c3c.wasm'));
		await expect(verifyBrowserTestAssets(options)).rejects.toThrow(
			'Missing or oversized required browser test asset'
		);
		await writeFile(path.join(staticDir, 'wasm-c3/c3c.wasm.gz'), encoded);
		await writeFile(
			path.join(staticDir, 'compressed-runtime-assets.v1.json'),
			JSON.stringify({ assets: ['wasm-c3/c3c.wasm'] })
		);
		await expect(verifyBrowserTestAssets(options)).resolves.toMatchObject({ assetCount: 1 });
		await expect(prepareBrowserTestAssets(options)).resolves.toMatchObject({ reused: 1 });
		await expect(readFile(path.join(staticDir, 'wasm-c3/c3c.wasm'))).rejects.toThrow();
		await expect(verifyBrowserTestAssets(options)).resolves.toMatchObject({ assetCount: 1 });
		await writeFile(
			path.join(staticDir, 'wasm-c3/c3c.wasm.gz'),
			gzipSync(Buffer.from('unreviewed compiler'))
		);
		await expect(verifyBrowserTestAssets(options)).rejects.toThrow('size/SHA-256 mismatch');
		manifest.assets[0].decoded.sha256 = hash(Buffer.from('other compiler'));
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(prepareBrowserTestAssets(options)).rejects.toThrow(
			'Decoded browser test asset failed receipt validation'
		);
	});

	it('uses the existing receipt-verified Lean and Common Lisp synchronizers', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-runtime-assets-'));
		temporaryDirectories.push(root);
		const prepareLean4 = vi.fn().mockResolvedValue({});
		const prepareCommonLisp = vi.fn().mockResolvedValue({});
		const fetchImpl = vi.fn();
		await prepareBrowserTestAssets({
			groups: ['lean4', 'commonlisp'],
			staticDir: root,
			prepareLean4,
			prepareCommonLisp,
			fetchImpl
		});
		expect(prepareLean4).toHaveBeenCalledWith({
			targetDir: path.join(root, 'wasm-lean4'),
			fetchImpl
		});
		expect(prepareCommonLisp).toHaveBeenCalledWith({
			targetDir: path.join(root, 'wasm-commonlisp'),
			fetchImpl
		});
	});

	it('pins complete C3 and LFortran bundles to the committed consumer profiles', async () => {
		const manifest = JSON.parse(await readFile('scripts/browser-test-assets.v1.json', 'utf8'));
		const c3 = await loadBundledProfile(
			new URL('./playground/wasmC3Version.ts', import.meta.url)
		);
		const lfortran = await loadBundledProfile(
			new URL('./playground/wasmLfortranVersion.ts', import.meta.url)
		);
		for (const [group, expected] of [
			[
				'c3',
				{
					'c3c.mjs': c3.bundledC3Profile.compilerJavaScriptReceipt,
					'c3c.wasm': c3.bundledC3Profile.compilerWasmReceipt,
					'producer-receipt.json': c3.bundledC3Profile.producerReceipt,
					'runner-worker.js': c3.bundledC3WorkerReceipt
				}
			],
			[
				'lfortran',
				{
					...Object.fromEntries(
						Object.entries(lfortran.WASM_LFORTRAN_PROFILE.assets).map(
							([name, receipt]) => [
								name === 'lfortran.data' ? 'lfortran.data.bin' : name,
								receipt
							]
						)
					),
					'runner-worker.js': lfortran.WASM_LFORTRAN_PROFILE.workerReceipt
				}
			]
		] as const) {
			expect(manifest.groupBaseUrls[group]).toMatch(
				/^https:\/\/raw\.githubusercontent\.com\/seo-rii\/wasm-idle\/[a-f0-9]{40}\/$/u
			);
			const assets = manifest.assets.filter(
				(asset: { group: string }) => asset.group === group
			);
			expect(manifest.generatedWorkers).toContain(group);
			expect(assets).toHaveLength(Object.keys(expected).length - 1);
			for (const [name, receipt] of Object.entries(expected) as [
				string,
				{ bytes: number; sha256: string }
			][]) {
				const asset = assets.find(
					(asset: { target: string }) => asset.target === `wasm-${group}/${name}`
				);
				if (name === 'runner-worker.js') {
					expect(asset).toBeUndefined();
					continue;
				}
				expect(asset?.decoded || asset).toMatchObject({
					size: receipt.bytes,
					sha256: receipt.sha256
				});
			}
		}
	});
	it('generates current C3 and LFortran workers locally and verifies their committed receipts', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-generated-workers-'));
		temporaryDirectories.push(root);
		const manifestPath = path.join(root, 'manifest.json');
		const manifest = JSON.parse(await readFile('scripts/browser-test-assets.v1.json', 'utf8'));
		await writeFile(manifestPath, JSON.stringify({ ...manifest, assets: [] }));
		const staticDir = path.join(root, 'static');
		const fetchImpl = vi.fn<typeof fetch>();
		const groups = ['c3', 'lfortran'];
		const options = { groups, staticDir, manifestPath, fetchImpl };
		for (const group of groups) {
			const target = path.join(staticDir, `wasm-${group}/runner-worker.js`);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, 'stale downloaded wrapper');
		}
		await expect(prepareBrowserTestAssets(options)).resolves.toMatchObject({ downloaded: 0 });
		expect(fetchImpl).not.toHaveBeenCalled();
		await expect(verifyBrowserTestAssets(options)).resolves.toMatchObject({ assetCount: 2 });
		for (const group of groups) {
			const target = path.join(staticDir, `wasm-${group}/runner-worker.js`);
			expect(await readFile(target, 'utf8')).toContain('protocolVersion !== 2');
			await writeFile(target, 'stale downloaded wrapper');
			await expect(verifyBrowserTestAssets(options)).rejects.toThrow('size/SHA-256 mismatch');
			await prepareBrowserTestAssets(options);
		}
	});
	it('prepares all current clangd assets from local producer receipts without replacing remote pins', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-local-clangd-bootstrap-'));
		temporaryDirectories.push(root);
		const sourceDir = path.join(root, 'producer');
		const staticDir = path.join(root, 'static');
		const receiptPath = path.join(root, 'runtime-build.json');
		const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
		const raw = Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				version: 'test',
				targetTriple: 'wasm32-wasi',
				resourceDir: '/lib/clang/22',
				files: {
					'/usr/include/wasm32-wasi/stdio.h': 'C headers',
					'/usr/include/c++/v1/vector': 'C++ headers',
					'/lib/clang/22/include/stddef.h': 'resource headers'
				}
			})
		);
		const compressed = gzipSync(raw);
		const headers = {
			asset: 'clangd/clangd.headers.json.gz',
			format: 'clangd-headers-v1',
			version: hash(raw),
			targetTriple: 'wasm32-wasi',
			resourceDir: '/lib/clang/22',
			bytes: compressed.length,
			sha256: hash(compressed),
			uncompressedBytes: raw.length,
			uncompressedSha256: hash(raw)
		};
		const contents = new Map([
			['clangd/clangd.js', Buffer.from('local producer JS')],
			['clangd/clangd.wasm.gz', Buffer.from('local producer Wasm')],
			[headers.asset, compressed]
		]);
		await mkdir(path.join(sourceDir, 'clangd'), { recursive: true });
		for (const [asset, bytes] of contents) await writeFile(path.join(sourceDir, asset), bytes);
		await writeFile(
			receiptPath,
			JSON.stringify({
				toolchain: { clangd: { headers } },
				assets: [...contents].map(([asset, bytes]) => ({
					asset,
					size: bytes.length,
					sha256: hash(bytes)
				}))
			})
		);
		const remoteManifestBefore = await readFile('scripts/browser-test-assets.v1.json');
		const fetchImpl = vi.fn<typeof fetch>();
		await expect(
			prepareBrowserTestAssets({
				groups: ['clangd'],
				staticDir,
				clangdReceiptPath: receiptPath,
				clangdSourceDir: sourceDir,
				fetchImpl
			})
		).resolves.toMatchObject({ downloaded: 0, copied: 3, reused: 0 });
		for (const [asset, bytes] of contents)
			expect(await readFile(path.join(staticDir, asset))).toEqual(bytes);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(await readFile('scripts/browser-test-assets.v1.json')).toEqual(remoteManifestBefore);
	});
	it('downloads receipt-verified direct assets once and reuses them', async () => {
		vi.stubEnv('WASM_IDLE_TEST_CLANGD_SOURCE_DIR', '/unavailable-local-producer');
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-test-assets-'));
		temporaryDirectories.push(root);
		const payload = Buffer.from('clangd fixture');
		const manifestPath = path.join(root, 'manifest.json');
		await writeFile(
			manifestPath,
			JSON.stringify({
				format: 'wasm-idle-browser-test-assets-v1',
				defaultBaseUrl: 'https://assets.example.test/runtime/',
				assets: [
					{
						group: 'clangd',
						source: 'clangd/clangd.js',
						target: 'clangd/clangd.js',
						size: payload.byteLength,
						sha256: createHash('sha256').update(payload).digest('hex')
					}
				]
			})
		);
		const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			expect(new Headers(init?.headers).get('cookie')).toBeNull();
			return new Response(payload);
		});
		const staticDir = path.join(root, 'static');

		await expect(
			prepareBrowserTestAssets({
				groups: ['clangd'],
				manifestPath,
				staticDir,
				fetchImpl
			})
		).resolves.toMatchObject({ downloaded: 1, groups: ['clangd'], reused: 0 });
		expect(await readFile(path.join(staticDir, 'clangd/clangd.js'))).toEqual(payload);

		await expect(
			prepareBrowserTestAssets({
				groups: ['clangd'],
				manifestPath,
				staticDir,
				fetchImpl
			})
		).resolves.toMatchObject({ downloaded: 0, groups: ['clangd'], reused: 1 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('installs the pinned Clang delivery bundle directly into the static tree', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-test-assets-'));
		temporaryDirectories.push(root);
		const payload = Buffer.from('clang delivery fixture');
		const manifestPath = path.join(root, 'manifest.json');
		await writeFile(
			manifestPath,
			JSON.stringify({
				format: 'wasm-idle-browser-test-assets-v1',
				defaultBaseUrl: 'https://assets.example.test/runtime/',
				assets: [
					{
						group: 'clang',
						source: 'clang/bin/clang.wasm.gz',
						target: 'clang/bin/clang.wasm.gz',
						size: payload.byteLength,
						sha256: createHash('sha256').update(payload).digest('hex')
					}
				]
			})
		);
		const staticDir = path.join(root, 'static');
		const fetchImpl = vi.fn(async () => new Response(payload));

		await expect(
			prepareBrowserTestAssets({
				groups: ['clang'],
				manifestPath,
				staticDir,
				fetchImpl
			})
		).resolves.toMatchObject({ downloaded: 1, groups: ['clang'], reused: 0 });
		expect(await readFile(path.join(staticDir, 'clang/bin/clang.wasm.gz'))).toEqual(payload);
	});

	it('verifies cached OCaml inputs before deriving the browser wrapper without overwriting input receipts', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-ocaml-inputs-'));
		temporaryDirectories.push(root);
		const payload = Buffer.from('verified producer input');
		const target = 'wasm-of-js-of-ocaml/browser-native/src/index.js';
		const manifestPath = path.join(root, 'manifest.json');
		await writeFile(
			manifestPath,
			JSON.stringify({
				format: 'wasm-idle-browser-test-assets-v1',
				defaultBaseUrl: 'https://assets.example.test/runtime/',
				assets: [
					{
						group: 'ocaml',
						source: target,
						target,
						size: payload.length,
						sha256: createHash('sha256').update(payload).digest('hex')
					}
				]
			})
		);
		const derived = path.join(root, 'derived.js');
		const prepareOcamlWrapper = vi.fn(async ({ sourceRoot }: { sourceRoot: string }) => {
			expect(await readFile(path.join(sourceRoot, target))).toEqual(payload);
			await writeFile(derived, 'corrected browser adapter');
			return {};
		});
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => new Response(payload));
		const options = {
			groups: ['ocaml'],
			manifestPath,
			staticDir: path.join(root, 'static'),
			cacheDir: path.join(root, 'cache'),
			prepareOcamlWrapper,
			fetchImpl
		};
		await expect(prepareBrowserTestAssets(options)).resolves.toMatchObject({
			downloaded: 1,
			reused: 0
		});
		await expect(prepareBrowserTestAssets(options)).resolves.toMatchObject({
			downloaded: 0,
			reused: 1
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(prepareOcamlWrapper).toHaveBeenCalledTimes(2);
		expect(await readFile(derived, 'utf8')).toBe('corrected browser adapter');
	});

	it('rejects assets that escape the trusted source or target roots', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-test-assets-'));
		temporaryDirectories.push(root);
		const payload = Buffer.from('fixture');
		const manifestPath = path.join(root, 'manifest.json');
		const manifest = {
			format: 'wasm-idle-browser-test-assets-v1',
			defaultBaseUrl: 'https://assets.example.test/runtime/',
			assets: [
				{
					group: 'clangd',
					source: '../private/clangd.js',
					target: 'clangd/clangd.js',
					size: payload.byteLength,
					sha256: createHash('sha256').update(payload).digest('hex')
				}
			]
		};
		await writeFile(manifestPath, JSON.stringify(manifest));

		await expect(
			prepareBrowserTestAssets({
				groups: ['clangd'],
				manifestPath,
				staticDir: path.join(root, 'static'),
				fetchImpl: vi.fn()
			})
		).rejects.toThrow('escapes its trusted source');

		manifest.assets[0].source = 'clangd/clangd.js';
		manifest.assets[0].target = '../outside.js';
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(
			prepareBrowserTestAssets({
				groups: ['clangd'],
				manifestPath,
				staticDir: path.join(root, 'static'),
				fetchImpl: vi.fn()
			})
		).rejects.toThrow('escapes the target directory');
	});

	it('pins the complete Clang and OCaml browser asset graphs', async () => {
		const manifest = JSON.parse(
			await readFile('scripts/browser-test-assets.v1.json', 'utf8')
		) as {
			format: string;
			defaultBaseUrl: string;
			assets: Array<{
				group: string;
				source: string;
				target: string;
				size: number;
				sha256: string;
			}>;
		};
		const clangTargets = manifest.assets
			.filter((asset) => asset.group === 'clang')
			.map((asset) => asset.target);
		const ocamlTargets = manifest.assets
			.filter((asset) => asset.group === 'ocaml')
			.map((asset) => asset.target);

		expect(manifest.format).toBe('wasm-idle-browser-test-assets-v1');
		expect(manifest.defaultBaseUrl).toMatch(
			/^https:\/\/raw\.githubusercontent\.com\/seo-rii\/wasm-idle\/[a-f0-9]{40}\/$/u
		);
		expect(clangTargets).toEqual(
			expect.arrayContaining([
				'clang/bin/clang.wasm.gz',
				'clang/bin/lld.wasm.gz',
				'clangd/clangd.js',
				'clangd/clangd.wasm.gz'
			])
		);
		// The small rebuilt MemFS is checked in; fetching the legacy copy would
		// restore the 1,024-node limit and break Objective-C header installation.
		expect(clangTargets).not.toContain('clang/bin/memfs.wasm.gz');
		// All sysroot profiles are checked in; the historical remote archive has trimmed headers.
		expect(clangTargets).not.toContain('clang/bin/sysroot.tar.gz');
		expect(ocamlTargets).toEqual(
			expect.arrayContaining([
				'wasm-of-js-of-ocaml/browser-native/src/index.js',
				'wasm-of-js-of-ocaml/browser-native/src/compiler-worker.js',
				'wasm-of-js-of-ocaml/browser-native/browser-harness/native-tool-worker.js',
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json',
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.index.json',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/ocamlc.byte.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/js_of_ocaml.bc.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm_of_ocaml.bc.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-opt.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-merge.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-metadce.browser.js.gz'
			])
		);
		for (const asset of manifest.assets) {
			expect(asset.size, asset.target).toBeGreaterThan(0);
			expect(asset.sha256, asset.target).toMatch(/^[a-f0-9]{64}$/u);
		}
	});

	it('expands all and rejects unknown groups', () => {
		expect(normalizeBrowserTestAssetGroups([])).toEqual([
			'clang',
			'ocaml',
			'c3',
			'lfortran',
			'lean4',
			'commonlisp'
		]);
		expect(normalizeBrowserTestAssetGroups(['--', 'clangd'])).toEqual(['clangd']);
		expect(normalizeBrowserTestAssetGroups(['clangd', 'clangd'])).toEqual(['clangd']);
		expect(() => normalizeBrowserTestAssetGroups(['missing'])).toThrow(
			'Unknown browser test asset group: missing'
		);
	});

	// The real TypeScript graph can take longer than the default 5 seconds in parallel runs.
	it('rebuilds the OCaml wrapper with its consumer receipt and relative module dependencies', () => {
		// Preparation rebuilds the wrapper from source; the download receipts describe
		// immutable compiler inputs, not the current wrapper's generated module graph.
		const configPath = path.resolve(
			'runtimes/wasm-of-js-of-ocaml/tsconfig.browser-harness.json'
		);
		const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
		expect(configFile.error).toBeUndefined();
		const config = ts.parseJsonConfigFileContent(
			configFile.config,
			ts.sys,
			path.dirname(configPath)
		);
		expect(config.errors).toEqual([]);
		const outputs = new Map<string, string>();
		const program = ts.createProgram(config.fileNames, config.options);
		const result = program.emit(undefined, (fileName, contents) => {
			if (fileName.endsWith('.js')) outputs.set(path.resolve(fileName), contents);
		});
		expect(result.emitSkipped).toBe(false);
		expect(result.diagnostics).toEqual([]);
		const modulePath = path.resolve(config.options.outDir!, 'src/index.js');
		expect(outputs.has(modulePath)).toBe(true);
		const moduleBytes = Buffer.from(outputs.get(modulePath)!, 'utf8');
		expect(moduleBytes.byteLength).toBe(WASM_OCAML_RUNTIME_PROFILE.moduleReceipt.bytes);
		expect(createHash('sha256').update(moduleBytes).digest('hex')).toBe(
			WASM_OCAML_RUNTIME_PROFILE.moduleReceipt.sha256
		);
		for (const relativePath of [
			'src/index.js',
			'src/compiler-worker.js',
			'browser-harness/native-tool-worker.js',
			'runtime/browser-native-asset-cache.js'
		]) {
			expect(outputs.has(path.resolve(config.options.outDir!, relativePath))).toBe(true);
		}
		for (const [target, contents] of outputs) {
			const source = ts.createSourceFile(target, contents, ts.ScriptTarget.Latest, true);
			for (const node of source.statements) {
				if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
				if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) continue;
				if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
				const specifier = node.moduleSpecifier;
				if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.'))
					continue;
				const dependency = path.resolve(path.dirname(target), specifier.text);
				expect(outputs.has(dependency), `${target} requires ${dependency}`).toBe(true);
			}
		}
	}, 30_000);
});
