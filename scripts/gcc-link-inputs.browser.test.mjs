#!/usr/bin/env node
// Binary/Worker contract coverage only. These Wasm fixtures are not a compiler;
// verify-gcc-wasi.mjs separately compiles and runs the real GCC acceptance suite.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.WASM_IDLE_RUN_GCC_LINK_INPUTS_BROWSER === '1';

test(
	'Chromium validates static link inputs in a module Worker with WebCrypto identities',
	{
		timeout: 60_000,
		skip: enabled
			? false
			: 'Set WASM_IDLE_RUN_GCC_LINK_INPUTS_BROWSER=1 after building packages/gcc'
	},
	async (t) => {
		const [{ chromium }, { resolveChromiumExecutable }] = await Promise.all([
			import('playwright-core'),
			import('./rust-browser-probe-lib.mjs')
		]);
		const workerSource = `
import {snapshotWasiGccLinkInputs,validateWasiGccLinkInputs} from '/packages/gcc/dist/wasm-link-inputs.js';
onmessage=async({data})=>{
  try { const inputs=snapshotWasiGccLinkInputs(data.inputs);
    const result=await validateWasiGccLinkInputs(inputs,data.manifest,data.hash,false,'c');
    postMessage({result});
  } catch(error) {postMessage({error:error.message});}
};`;
		const server = createServer(async (request, response) => {
			try {
				const pathname = new URL(request.url, 'http://localhost').pathname;
				response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
				response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
				if (pathname === '/') {
					response.setHeader('Content-Type', 'text/html');
					response.end('<!doctype html><title>GCC link input contract</title>');
				} else if (pathname === '/contract-worker.mjs') {
					response.setHeader('Content-Type', 'text/javascript');
					response.end(workerSource);
				} else if (/^\/packages\/gcc\/dist\/[a-z-]+\.js$/u.test(pathname)) {
					response.setHeader('Content-Type', 'text/javascript');
					response.end(await readFile(path.join(root, pathname)));
				} else {
					response.statusCode = 404;
					response.end();
				}
			} catch {
				response.statusCode = 500;
				response.end();
			}
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		let browser;
		t.after(async () => {
			await browser?.close();
			await new Promise((resolve) => server.close(resolve));
		});
		browser = await chromium.launch({
			executablePath: await resolveChromiumExecutable(),
			headless: true
		});
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${server.address().port}/`);
		const result = await page.evaluate(async () => {
			const { snapshotWasiGccLinkInputs, gccLinkDigest } =
				await import('/packages/gcc/dist/wasm-link-inputs.js');
			// (i32)->i32 identity function, with genuine linking-v2 symbol-table encoding.
			const bytes = Uint8Array.from([
				0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127, 3, 2, 1, 0, 10, 6, 1, 4,
				0, 32, 0, 11, 0, 19, 7, 108, 105, 110, 107, 105, 110, 103, 2, 8, 8, 1, 0, 0, 0, 3,
				97, 100, 100
			]);
			const hash = 'a'.repeat(64),
				sysrootSha256 = 'b'.repeat(64);
			const profile = {
				target: 'wasm32-wasi',
				abi: 'wasm32-wasi-preview1',
				simd: false,
				compatibility: { kind: 'gcc-bundle', manifestSha256: hash, sysrootSha256 }
			};
			const manifest = {
				assets: { sysroot: { sha256: sysrootSha256 } },
				capabilities: { staticInitialization: true }
			};
			const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
			shared.set(bytes);
			const input = {
				path: 'identity.o',
				format: 'wasm-object',
				bytes: shared,
				sha256: await gccLinkDigest(bytes),
				profile
			};
			const snapshot = snapshotWasiGccLinkInputs([input]);
			shared.fill(255);
			const worker = new Worker('/contract-worker.mjs', { type: 'module' });
			const request = (inputs) =>
				new Promise((resolve, reject) => {
					worker.onmessage = (event) => resolve(event.data);
					worker.onerror = (event) => reject(Error(event.message));
					worker.postMessage({ inputs, manifest, hash });
				});
			try {
				const valid = await request(snapshot);
				const corrupt = await request([{ ...snapshot[0], sha256: '0'.repeat(64) }]);
				const module = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
				const nonobject = await request([
					{ ...snapshot[0], bytes: module, sha256: await gccLinkDigest(module) }
				]);
				return {
					valid,
					corrupt,
					nonobject,
					inputBytes: shared.byteLength,
					snapshotBytes: snapshot[0].bytes.byteLength,
					sha256: input.sha256
				};
			} finally {
				worker.terminate();
			}
		});
		assert.equal(result.valid.error, undefined);
		assert.equal(result.valid.result[0].sha256, result.sha256);
		assert.equal(result.valid.result[0].path, 'identity.o');
		assert.match(result.corrupt.error, /SHA-256 mismatch/u);
		assert.match(result.nonobject.error, /linking metadata/u);
		assert.equal(result.inputBytes, result.snapshotBytes);
	}
);
