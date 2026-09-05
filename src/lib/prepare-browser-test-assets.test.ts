// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	normalizeBrowserTestAssetGroups,
	prepareBrowserTestAssets
} from '../../scripts/prepare-browser-test-assets.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('browser test asset preparation', () => {
	it('downloads receipt-verified direct assets once and reuses them', async () => {
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
		expect(manifest.defaultBaseUrl).toBe('https://seorii.page/wasm-idle/');
		expect(clangTargets).toEqual(
			expect.arrayContaining([
				'clang/bin/clang.wasm.gz',
				'clang/bin/lld.wasm.gz',
				'clang/bin/memfs.wasm.gz',
				'clang/bin/sysroot.tar.gz',
				'clangd/clangd.js',
				'clangd/clangd.wasm.gz'
			])
		);
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
		expect(normalizeBrowserTestAssetGroups([])).toEqual(['clang', 'ocaml']);
		expect(normalizeBrowserTestAssetGroups(['--', 'clangd'])).toEqual(['clangd']);
		expect(normalizeBrowserTestAssetGroups(['clangd', 'clangd'])).toEqual(['clangd']);
		expect(() => normalizeBrowserTestAssetGroups(['missing'])).toThrow(
			'Unknown browser test asset group: missing'
		);
	});
});
