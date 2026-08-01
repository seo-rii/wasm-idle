import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	prepareClangCompilerAssets,
	prepareClangdAssets
} from '../../scripts/prepare-clangd-assets.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe('prepareClangdAssets', () => {
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

describe('prepareClangCompilerAssets', () => {
	it('downloads the four receipt-pinned compiler assets into static/clang/bin', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clang-assets-'));
		temporaryDirectories.push(root);
		const receiptPath = path.join(root, 'runtime-build.json');
		const staticDir = path.join(root, 'static');
		const contents = new Map(
			['clang.wasm.gz', 'lld.wasm.gz', 'memfs.wasm.gz', 'sysroot.tar.gz'].map(
				(asset, index) => [asset, new Uint8Array([index + 1, index + 2])] as const
			)
		);
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
			const asset = path.basename(url.pathname);
			return new Response(contents.get(asset));
		});

		await expect(
			prepareClangCompilerAssets({
				receiptPath,
				staticDir,
				baseUrl: 'https://assets.example.com/wasm-idle/',
				fetchImpl
			})
		).resolves.toEqual({ downloaded: 4, reused: 0 });
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		for (const [asset, bytes] of contents) {
			expect(fetchImpl).toHaveBeenCalledWith(
				new URL(`https://assets.example.com/wasm-idle/clang/bin/${asset}`),
				expect.any(Object)
			);
			expect([
				...new Uint8Array(await readFile(path.join(staticDir, 'clang', 'bin', asset)))
			]).toEqual([...bytes]);
		}
	});
});
