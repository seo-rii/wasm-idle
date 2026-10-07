import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareClangdAssets } from '../../scripts/prepare-clangd-assets.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe('prepareClangdAssets', () => {
	async function headerFixture() {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clangd-headers-assets-'));
		temporaryDirectories.push(root);
		const receiptPath = path.join(root, 'runtime-build.json');
		const staticDir = path.join(root, 'static');
		const raw = Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				version: 'fixture-header-version',
				targetTriple: 'wasm32-wasi',
				resourceDir: '/lib/clang/22',
				files: {
					'/usr/include/wasm32-wasi/stdio.h': 'selected C header',
					'/usr/include/c++/v1/vector': 'shared C++ header',
					'/lib/clang/22/include/stddef.h': 'matching resource header'
				}
			})
		);
		const compressed = gzipSync(raw);
		const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
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
			['clangd/clangd.js', Buffer.from('clangd-js')],
			['clangd/clangd.wasm.gz', Buffer.from([1, 2, 3, 4])],
			[headers.asset, compressed]
		]);
		const receipt = {
			toolchain: { clangd: { headers } },
			assets: [...contents].map(([asset, bytes]) => ({
				asset,
				size: bytes.length,
				sha256: hash(bytes)
			}))
		};
		await writeFile(receiptPath, JSON.stringify(receipt));
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input);
			return new Response(contents.get(url.pathname.slice(1))!);
		});
		return { receiptPath, staticDir, receipt, contents, fetchImpl };
	}

	it('downloads and reuses a verified separately versioned clangd header asset', async () => {
		const fixture = await headerFixture();
		vi.stubEnv('WASM_IDLE_TEST_CLANGD_SOURCE_DIR', '/unavailable-local-producer');
		const options = { ...fixture, baseUrl: 'https://assets.example.com/' };
		await expect(prepareClangdAssets(options)).resolves.toEqual({ downloaded: 3, reused: 0 });
		expect(
			await readFile(
				path.join(fixture.staticDir, fixture.receipt.toolchain.clangd.headers.asset)
			)
		).toEqual(fixture.contents.get(fixture.receipt.toolchain.clangd.headers.asset));
		fixture.fetchImpl.mockClear();
		await expect(prepareClangdAssets(options)).resolves.toEqual({ downloaded: 0, reused: 3 });
		expect(fixture.fetchImpl).not.toHaveBeenCalled();
	});
	it('copies current receipt-pinned assets from a local producer without network requests', async () => {
		const fixture = await headerFixture();
		const sourceDir = path.join(path.dirname(fixture.receiptPath), 'producer');
		await mkdir(path.join(sourceDir, 'clangd'), { recursive: true });
		for (const [asset, bytes] of fixture.contents)
			await writeFile(path.join(sourceDir, asset), bytes);
		const options = { ...fixture, sourceDir };
		await expect(prepareClangdAssets(options)).resolves.toEqual({
			downloaded: 0,
			copied: 3,
			reused: 0
		});
		for (const [asset, bytes] of fixture.contents)
			expect(await readFile(path.join(fixture.staticDir, asset))).toEqual(bytes);
		await expect(prepareClangdAssets(options)).resolves.toEqual({ downloaded: 0, reused: 3 });
		expect(fixture.fetchImpl).not.toHaveBeenCalled();
	});
	it('rejects stale local producer bytes without replacing an existing asset', async () => {
		const fixture = await headerFixture();
		const sourceDir = path.join(path.dirname(fixture.receiptPath), 'stale-producer');
		await mkdir(path.join(sourceDir, 'clangd'), { recursive: true });
		await writeFile(path.join(sourceDir, 'clangd/clangd.js'), 'stale producer');
		await mkdir(path.join(fixture.staticDir, 'clangd'), { recursive: true });
		await writeFile(path.join(fixture.staticDir, 'clangd/clangd.js'), 'preserve existing');
		await expect(prepareClangdAssets({ ...fixture, sourceDir })).rejects.toThrow(
			'failed receipt validation'
		);
		expect(await readFile(path.join(fixture.staticDir, 'clangd/clangd.js'), 'utf8')).toBe(
			'preserve existing'
		);
		expect(fixture.fetchImpl).not.toHaveBeenCalled();
	});

	it('rejects a header asset whose raw identity is stale despite a valid compressed pin', async () => {
		const fixture = await headerFixture();
		fixture.receipt.toolchain.clangd.headers.version = 'a'.repeat(64);
		fixture.receipt.toolchain.clangd.headers.uncompressedSha256 = 'a'.repeat(64);
		await writeFile(fixture.receiptPath, JSON.stringify(fixture.receipt));
		await expect(
			prepareClangdAssets({ ...fixture, baseUrl: 'https://assets.example.com/' })
		).rejects.toThrow('uncompressed receipt');
	});

	it('rejects unreceipted header assets or disagreeing asset pins before downloading', async () => {
		const fixture = await headerFixture();
		await writeFile(fixture.receiptPath, JSON.stringify({ assets: fixture.receipt.assets }));
		await expect(
			prepareClangdAssets({ ...fixture, baseUrl: 'https://assets.example.com/' })
		).rejects.toThrow('supported clangd browser assets');
		fixture.receipt.assets[2].sha256 = 'a'.repeat(64);
		await writeFile(fixture.receiptPath, JSON.stringify(fixture.receipt));
		await expect(
			prepareClangdAssets({ ...fixture, baseUrl: 'https://assets.example.com/' })
		).rejects.toThrow('header receipt does not match');
		expect(fixture.fetchImpl).not.toHaveBeenCalled();
	});

	it('downloads only receipt-pinned assets into the static tree', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clangd-assets-'));
		temporaryDirectories.push(root);
		const receiptPath = path.join(root, 'runtime-build.json');
		const staticDir = path.join(root, 'static');
		const contents = new Map([
			['clangd/clangd.js', new TextEncoder().encode('clangd-js')],
			['clangd/clangd.wasm.gz', new Uint8Array([1, 2, 3, 4])]
		]);
		await writeFile(
			receiptPath,
			JSON.stringify({
				assets: [...contents].map(([asset, bytes]) => ({
					asset,
					size: bytes.byteLength,
					sha256: createHash('sha256').update(bytes).digest('hex')
				}))
			})
		);
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input);
			const bytes = contents.get(url.pathname.replace('/wasm-idle/', ''))!;
			const encoded = url.pathname.endsWith('.js');
			return new Response(bytes, {
				headers: {
					'content-encoding': encoded ? 'gzip' : '',
					'content-length': String(encoded ? 3 : bytes.byteLength)
				}
			});
		});

		await expect(
			prepareClangdAssets({
				receiptPath,
				staticDir,
				baseUrl: 'https://assets.example.com/wasm-idle/',
				fetchImpl
			})
		).resolves.toEqual({ downloaded: 2, reused: 0 });
		expect([
			...new Uint8Array(await readFile(path.join(staticDir, 'clangd/clangd.js')))
		]).toEqual([...contents.get('clangd/clangd.js')!]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('reuses files only when their size and digest match the receipt', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clangd-assets-'));
		temporaryDirectories.push(root);
		const receiptPath = path.join(root, 'runtime-build.json');
		const staticDir = path.join(root, 'static');
		await mkdir(path.join(staticDir, 'clangd'), { recursive: true });
		const js = new TextEncoder().encode('clangd-js');
		const wasm = new Uint8Array([1, 2, 3, 4]);
		await writeFile(path.join(staticDir, 'clangd/clangd.js'), js);
		await writeFile(path.join(staticDir, 'clangd/clangd.wasm.gz'), wasm);
		await writeFile(
			receiptPath,
			JSON.stringify({
				assets: [
					{
						asset: 'clangd/clangd.js',
						size: js.byteLength,
						sha256: createHash('sha256').update(js).digest('hex')
					},
					{
						asset: 'clangd/clangd.wasm.gz',
						size: wasm.byteLength,
						sha256: createHash('sha256').update(wasm).digest('hex')
					}
				]
			})
		);
		const fetchImpl = vi.fn();

		await expect(
			prepareClangdAssets({ receiptPath, staticDir, fetchImpl: fetchImpl as typeof fetch })
		).resolves.toEqual({ downloaded: 0, reused: 2 });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('rejects redirects outside the trusted asset base', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clangd-assets-'));
		temporaryDirectories.push(root);
		const receiptPath = path.join(root, 'runtime-build.json');
		const bytes = new Uint8Array([1]);
		await writeFile(
			receiptPath,
			JSON.stringify({
				assets: ['clangd/clangd.js', 'clangd/clangd.wasm.gz'].map((asset) => ({
					asset,
					size: bytes.byteLength,
					sha256: createHash('sha256').update(bytes).digest('hex')
				}))
			})
		);
		const fetchImpl = vi.fn(async () => {
			const response = new Response(bytes);
			Object.defineProperty(response, 'url', { value: 'https://evil.example.com/clangd.js' });
			return response;
		});

		await expect(
			prepareClangdAssets({
				receiptPath,
				staticDir: path.join(root, 'static'),
				baseUrl: 'https://assets.example.com/wasm-idle/',
				fetchImpl
			})
		).rejects.toThrow('redirected outside its trusted base');
	});
});
