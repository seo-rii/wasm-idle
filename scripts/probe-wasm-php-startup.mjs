import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const root = path.resolve(process.argv[2] || 'producers/wasm-php/dist');
const manifest = JSON.parse(await readFile(path.join(root, 'runtime-manifest.v1.json'), 'utf8'));
const loaders = new Set(
	manifest.files
		.filter((file) => /^chunks\/php_8_4-.*\.mjs$/.test(file.path) && file.bytes > 20000)
		.map((file) => '/' + file.path)
);
assert.equal(loaders.size, 2, 'expected both executable engine loader chunks');
let wasmRequested = false;
let releaseLoader;
let gate;
let requests = [];
const reset = () => {
	wasmRequested = false;
	requests = [];
	gate = new Promise((resolve) => {
		releaseLoader = resolve;
	});
};
reset();
const server = createServer(async (req, res) => {
	try {
		const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
		if (pathname === '/') {
			res.setHeader('Content-Type', 'text/html');
			res.end('<!doctype html><title>PHP startup probe</title>');
			return;
		}
		if (pathname === '/favicon.ico') {
			res.writeHead(204);
			res.end();
			return;
		}
		const file = path.resolve(root, '.' + pathname);
		if (!file.startsWith(root + path.sep)) {
			res.writeHead(403);
			res.end();
			return;
		}
		requests.push(pathname);
		// The engine must begin fetching before its large loader is allowed to finish.
		// A JS-loader -> Wasm waterfall cannot pass this test.
		if (pathname.endsWith('.wasm')) {
			wasmRequested = true;
			releaseLoader();
		}
		if (loaders.has(pathname) && !wasmRequested) await gate;
		res.setHeader(
			'Content-Type',
			file.endsWith('.mjs')
				? 'text/javascript'
				: file.endsWith('.wasm')
					? 'application/wasm'
					: 'application/octet-stream'
		);
		res.end(await readFile(file));
	} catch (error) {
		console.error('request failure', req.url, error);
		res.writeHead(404);
		res.end();
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
	for (const mode of ['asyncify', 'jspi']) {
		reset();
		const context = await browser.newContext();
		const page = await context.newPage();
		page.on('console', (message) => console.log(mode, message.type(), message.text()));
		page.on('pageerror', (error) => console.error(mode, error));
		try {
			await page.goto(`http://127.0.0.1:${server.address().port}/`);
			const result = await page.evaluate(async (mode) => {
				const run = async ({ mode, url }) => {
					const api = await import(url);
					let compiles = 0;
					const compile = WebAssembly.compileStreaming;
					WebAssembly.compileStreaming = function (...args) {
						compiles++;
						return compile.apply(this, args);
					};
					const a = await api.createPhp84({ asyncMode: mode });
					a.writeFile('/tmp/private-state.txt', 'owned by first PHP VM');
					const first = await a.run({
						code: '<?php echo json_encode([strlen(file_get_contents("php://input")), file_get_contents("/tmp/private-state.txt")]);',
						body: new TextEncoder().encode('hello')
					});
					const b = await api.createPhp84({ asyncMode: mode });
					const second = await b.run({
						code: '<?php echo (file_exists("/tmp/private-state.txt") ? "leaked" : "isolated") . ":" . (40 + 2);'
					});
					if (compiles !== 1)
						throw Error('native module compiled ' + compiles + ' times');
					if (
						first.exitCode ||
						first.errors ||
						first.text !== '[5,"owned by first PHP VM"]'
					)
						throw Error('first PHP execution failed: ' + JSON.stringify(first));
					if (second.exitCode || second.errors || second.text !== 'isolated:42')
						throw Error('second PHP execution failed: ' + JSON.stringify(second));
					return { mode, compiles, first: first.text, second: second.text };
				};
				const blobUrl = URL.createObjectURL(
					new Blob(
						[
							`self.onmessage=async e=>{try{self.postMessage({result:await (${run.toString()})(e.data)})}catch(e){self.postMessage({error:String(e?.stack||e)})}};`
						],
						{ type: 'text/javascript' }
					)
				);
				const worker = new Worker(blobUrl, { type: 'module' });
				try {
					return await new Promise((resolve, reject) => {
						const timer = setTimeout(() => {
							worker.terminate();
							reject(Error('PHP startup probe timed out'));
						}, 90000);
						worker.onerror = (e) => {
							clearTimeout(timer);
							reject(Error(e.message));
						};
						worker.onmessage = (e) => {
							clearTimeout(timer);
							e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
						};
						worker.postMessage({
							mode,
							url: new URL('/runtime.mjs', location.href).href
						});
					});
				} finally {
					worker.terminate();
					URL.revokeObjectURL(blobUrl);
				}
			}, mode);
			assert.equal(
				requests.filter((url) => url.endsWith('.wasm')).length,
				1,
				'only the selected engine may download, once'
			);
			assert.equal(
				requests.filter((url) => loaders.has(url)).length,
				1,
				'only the selected glue may download'
			);
			assert.equal(
				requests.filter((url) => url.endsWith('.so')).length,
				0,
				'no unused extension download'
			);
			console.log(JSON.stringify({ ...result, requests }));
		} finally {
			releaseLoader();
			await context.close();
		}
	}
} finally {
	releaseLoader();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
