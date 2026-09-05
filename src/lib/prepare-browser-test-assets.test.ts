// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	normalizeBrowserTestAssetGroups,
	prepareBrowserTestAssets
} from '../../scripts/prepare-browser-test-assets.mjs';
import { WASM_OCAML_RUNTIME_PROFILE } from './playground/wasmOcamlVersion';

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

	it('keeps OCaml outer receipts aligned with the consumer integrity profile', async () => {
		const manifest = JSON.parse(await readFile('scripts/browser-test-assets.v1.json', 'utf8'));
		for (const [target, receipt] of [
			[
				'wasm-of-js-of-ocaml/browser-native/src/index.js',
				WASM_OCAML_RUNTIME_PROFILE.moduleReceipt
			],
			[
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json',
				WASM_OCAML_RUNTIME_PROFILE.manifestReceipt
			]
		] as const) {
			expect(
				manifest.assets.find((asset: { target: string }) => asset.target === target)
			).toMatchObject({
				size: receipt.bytes,
				sha256: receipt.sha256
			});
		}
	});

	it('includes the relative module dependencies of the pinned OCaml producer graph', async () => {
		const manifest = JSON.parse(
			await readFile('scripts/browser-test-assets.v1.json', 'utf8')
		) as {
			assets: Array<{ group: string; target: string }>;
		};
		const prefix = 'wasm-of-js-of-ocaml/browser-native/';
		const targets = new Set(
			manifest.assets.filter((asset) => asset.group === 'ocaml').map((asset) => asset.target)
		);
		for (const target of targets) {
			if (!target.startsWith(prefix) || !target.endsWith('.js')) continue;
			const sourcePath = `runtimes/wasm-of-js-of-ocaml/${target.slice(prefix.length).replace(/\.js$/u, '.ts')}`;
			const source = ts.createSourceFile(
				sourcePath,
				await readFile(sourcePath, 'utf8'),
				ts.ScriptTarget.Latest,
				true
			);
			for (const node of source.statements) {
				if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
				if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) continue;
				if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
				const specifier = node.moduleSpecifier;
				if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.'))
					continue;
				const dependency = path.posix.normalize(
					path.posix.join(path.posix.dirname(target), specifier.text)
				);
				expect(targets.has(dependency), `${target} requires ${dependency}`).toBe(true);
			}
		}
	});
});
