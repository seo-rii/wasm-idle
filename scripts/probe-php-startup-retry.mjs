// Execute the production PHP worker against the checked-in, verified PHP distribution.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { validatePhpRuntimeAssets } from './sync-wasm-php.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assetRoot = path.join(root, 'static/wasm-php');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'php-worker-retry-'));
let server, browser;
let failNextWasm = true,
	wasmRequests = 0;
try {
	await validatePhpRuntimeAssets(assetRoot, { allowCompressed: true });
	await build({
		entryPoints: [path.join(root, 'src/lib/playground/worker/php.ts')],
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		alias: { $lib: path.join(root, 'src/lib') },
		outfile: path.join(tmp, 'worker.mjs')
	});
	const workerSource = await readFile(path.join(tmp, 'worker.mjs'));
	server = createServer(async (req, res) => {
		res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		res.setHeader('Cache-Control', 'no-store');
		try {
			const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
			if (name === '/') {
				res.setHeader('Content-Type', 'text/html');
				res.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">');
				return;
			}
			if (name === '/worker.mjs') {
				res.setHeader('Content-Type', 'text/javascript');
				res.end(workerSource);
				return;
			}
			if (name === '/delayed.mjs') {
				// Keep the older import unresolved until a replacement startup owns the worker.
				await new Promise((resolve) => setTimeout(resolve, 250));
				res.setHeader('Content-Type', 'text/javascript');
				res.end("export {createPhp84} from './startup.mjs';");
				return;
			}
			const file = path.resolve(assetRoot, '.' + name);
			if (!file.startsWith(assetRoot + path.sep)) {
				res.writeHead(403);
				res.end();
				return;
			}
			if (name.endsWith('.wasm')) {
				wasmRequests++;
				if (failNextWasm) {
					failNextWasm = false;
					res.writeHead(503);
					res.end('injected first-attempt asset failure');
					return;
				}
			}
			let bytes;
			try {
				bytes = await readFile(file);
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
				bytes = await readFile(file + '.gz');
				res.setHeader('Content-Encoding', 'gzip');
			}
			res.setHeader(
				'Content-Type',
				name.endsWith('.wasm')
					? 'application/wasm'
					: /\.m?js$/.test(name)
						? 'text/javascript'
						: 'application/octet-stream'
			);
			res.end(bytes);
		} catch (error) {
			res.writeHead(404);
			res.end(String(error));
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	browser = await chromium.launch(
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
			? { headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
			: { headless: true }
	);
	const page = await browser.newPage();
	page.on('pageerror', (error) => console.error(error));
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	const result = await page.evaluate(async () => {
		const check = (condition, message) => {
			if (!condition) throw Error(message);
		};
		const worker = new Worker('/worker.mjs', { type: 'module' });
		function call(data, completion) {
			return new Promise((resolve, reject) => {
				const messages = [];
				const timer = setTimeout(
					() => reject(Error('PHP worker request timed out')),
					45000
				);
				worker.onerror = (event) => {
					clearTimeout(timer);
					reject(Error(event.message));
				};
				worker.onmessage = ({ data: response }) => {
					messages.push(response);
					if (response.error || response[completion] === true) {
						clearTimeout(timer);
						worker.onmessage = worker.onerror = null;
						resolve({ messages, error: response.error });
					}
				};
				worker.postMessage(data);
			});
		}
		const output = (result) =>
			result.messages
				.filter((message) => message.output)
				.map((message) => message.output)
				.join('');
		try {
			const moduleUrl = new URL('/startup.mjs', location.href).href;
			const failed = await call({ load: true, moduleUrl, log: false }, 'load');
			check(!!failed.error, 'The injected download failure did not reach the caller');
			const recovered = await call({ load: true, moduleUrl, log: false }, 'load');
			check(
				!recovered.error,
				'The failed startup promise poisoned retry: ' + recovered.error
			);
			const options = {
				buffer: new SharedArrayBuffer(4096),
				log: false,
				args: ['argument'],
				stdin: 'input\n',
				activePath: 'main.php',
				workspaceFiles: [{ path: 'data.txt', content: 'workspace' }]
			};
			const prepared = await call(
				{
					...options,
					prepare: true,
					code: '<?php throw new Exception("prepare ran code");'
				},
				'results'
			);
			check(!prepared.error && !output(prepared), 'Prepare executed user PHP');
			const first = await call(
				{
					...options,
					code: '<?php echo trim(file_get_contents("php://input")) . ":" . $argv[1] . ":" . file_get_contents("/workspace/data.txt") . "\\n";'
				},
				'results'
			);
			check(
				!first.error && output(first) === 'input:argument:workspace\n',
				'Recovered worker execution failed: ' + JSON.stringify(first)
			);
			const second = await call(
				{
					...options,
					workspaceFiles: [],
					stdin: '',
					code: '<?php if (file_exists("/workspace/data.txt")) throw new Exception("workspace leaked"); echo "isolated\\n";'
				},
				'results'
			);
			check(!second.error && output(second) === 'isolated\n', 'Workspace isolation failed');
			return {
				crossOriginIsolated,
				firstAttemptError: failed.error,
				outputs: [output(first), output(second)]
			};
		} finally {
			worker.terminate();
		}
	});
	assert.equal(result.crossOriginIsolated, true);
	assert.ok(wasmRequests >= 2, 'Same URL was not retried after the injected 503');
	const superseded = await page.evaluate(async () => {
		const worker = new Worker('/worker.mjs', { type: 'module' }),
			messages = [];
		try {
			await new Promise((resolve, reject) => {
				const timer = setTimeout(
					() => reject(Error('Replacement startup timed out')),
					45000
				);
				worker.onerror = (event) => {
					clearTimeout(timer);
					reject(Error(event.message));
				};
				worker.onmessage = ({ data }) => {
					messages.push(data);
					if (data.error) {
						clearTimeout(timer);
						reject(Error(data.error));
					} else if (data.load) {
						clearTimeout(timer);
						resolve();
					}
				};
				worker.postMessage({
					load: true,
					moduleUrl: new URL('/delayed.mjs', location.href).href,
					log: false
				});
				worker.postMessage({
					load: true,
					moduleUrl: new URL('/startup.mjs', location.href).href,
					log: false
				});
			});
			await new Promise((resolve) => setTimeout(resolve, 500));
			if (
				messages.some((message) => message.error) ||
				messages.filter((message) => message.load).length !== 1
			)
				throw Error(
					'A superseded initializer published a stale error/ready: ' +
						JSON.stringify(messages)
				);
			return {
				readyMessages: messages.filter((message) => message.load).length,
				errors: messages.filter((message) => message.error)
			};
		} finally {
			worker.terminate();
		}
	});
	console.log(JSON.stringify({ ...result, wasmRequests, superseded }, null, 2));
} finally {
	await browser?.close();
	if (server?.listening) await new Promise((resolve) => server.close(resolve));
	await rm(tmp, { recursive: true, force: true });
}
