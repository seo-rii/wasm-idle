import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const root = path.resolve(process.argv[2] ?? new URL('../dist/', import.meta.url).pathname);
const requests = [];
async function probe({ mode, entry = 'startup.mjs', failInstantiation = false }) {
	const api = await import('/' + entry);
	await new Promise((resolve) => setTimeout(resolve, 50));
	postMessage({ stage: 'imported' });
	const nativeCompile = WebAssembly.compileStreaming,
		nativeInstantiate = WebAssembly.instantiate;
	let compiles = 0;
	WebAssembly.compileStreaming = function (...args) {
		compiles++;
		return nativeCompile.apply(this, args);
	};
	if (failInstantiation)
		WebAssembly.instantiate = () => Promise.reject(new Error('injected instantiate failure'));
	try {
		const outputs = [];
		for (let i = 0; i < 2; i++) {
			postMessage({ stage: 'create-' + i });
			const php = await api.createPhp84({ asyncMode: mode });
			if (failInstantiation) throw Error('Instantiation failure was swallowed');
			php.mkdir('/workspace');
			if (php.fileExists('/workspace/input.txt')) throw Error('PHP instances shared files');
			php.writeFile('/workspace/input.txt', 'file' + i);
			const result = await php.run({
				code: '<?php echo json_encode([file_get_contents("php://input"), file_get_contents("/workspace/input.txt"), json_decode("{\\"n\\":3}")->n, preg_match("/a+/", "baa")]);',
				body: 'input' + i
			});
			if (result.exitCode !== 0 || result.errors)
				throw Error(JSON.stringify({ code: result.exitCode, errors: result.errors }));
			const parsed = JSON.parse(result.text);
			if (JSON.stringify(parsed) !== JSON.stringify(['input' + i, 'file' + i, 3, 1]))
				throw Error(result.text);
			outputs.push(result.text);
			php.exit();
		}
		return { mode, entry, compiles, outputs };
	} catch (error) {
		if (failInstantiation && String(error).includes('injected instantiate failure'))
			return { mode, failedAsExpected: true };
		throw error;
	} finally {
		WebAssembly.compileStreaming = nativeCompile;
		WebAssembly.instantiate = nativeInstantiate;
	}
}
const source = `self.onmessage=async({data})=>{try{postMessage({result:await(${probe.toString()})(data)})}catch(e){postMessage({error:e?.stack||String(e)})}};`;
const server = createServer(async (req, res) => {
	try {
		const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
		requests.push({ path: pathname, start: performance.now() });
		const record = requests.at(-1);
		res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		if (pathname === '/') {
			res.setHeader('Content-Type', 'text/html');
			res.end('<!doctype html><link rel="icon" href="data:,">');
			return;
		}
		if (pathname === '/probe.worker.mjs') {
			res.setHeader('Content-Type', 'text/javascript');
			res.end(source);
			return;
		}
		const file = path.resolve(root, '.' + pathname);
		if (!file.startsWith(root + path.sep)) {
			res.writeHead(403);
			res.end();
			return;
		}
		const bytes = await readFile(file);
		if (/^\/chunks\/php_8_4-/.test(pathname))
			await new Promise((resolve) => setTimeout(resolve, 200));
		res.setHeader(
			'Content-Type',
			file.endsWith('.wasm')
				? 'application/wasm'
				: file.endsWith('.mjs')
					? 'text/javascript'
					: 'application/octet-stream'
		);
		record.sent = performance.now();
		res.end(bytes);
	} catch (error) {
		console.error(req.url, error.message);
		res.writeHead(404);
		res.end();
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
		? { headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
		: { headless: true }
);
try {
	for (const scenario of [
		{ mode: 'jspi' },
		{ mode: 'asyncify' },
		{ mode: 'auto' },
		{ mode: 'auto', entry: 'runtime.mjs' },
		{ mode: 'asyncify', failInstantiation: true }
	]) {
		const context = await browser.newContext(),
			page = await context.newPage();
		const start = requests.length;
		page.on('console', (message) => console.log(scenario.mode, message.type(), message.text()));
		page.on('pageerror', console.error);
		await page.goto('http://127.0.0.1:' + server.address().port + '/');
		try {
			const result = await page.evaluate(
				(scenario) =>
					new Promise((resolve, reject) => {
						const worker = new Worker('/probe.worker.mjs', { type: 'module' });
						let stage = 'import';
						const finish = (error, value) => {
							clearTimeout(timer);
							worker.terminate();
							error ? reject(error) : resolve(value);
						};
						const timer = setTimeout(
							() => finish(Error('PHP timeout at ' + stage)),
							90000
						);
						worker.onmessage = ({ data }) => {
							if (data.stage) {
								stage = data.stage;
								console.log('PHP', stage);
							} else if (data.error) finish(Error(data.error));
							else finish(null, data.result);
						};
						worker.onerror = (e) => finish(Error(e.message));
						worker.postMessage(scenario);
					}),
				scenario
			);
			const own = requests.slice(start),
				wasm = own.filter((r) => r.path.endsWith('.wasm')),
				glue = own.filter((r) => /^\/chunks\/php_8_4-/.test(r.path));
			assert.equal(glue.length, 1, 'more than one PHP async-mode loader requested');
			assert.equal(
				own.filter((r) => r.path.endsWith('.so')).length,
				0,
				'unused extension requested'
			);
			if (!scenario.entry) {
				assert.equal(wasm.length, 1, 'duplicate/unchosen Wasm fetched');
				assert.ok(wasm[0].start < glue[0].sent, 'Wasm request waited for the loader body');
				if (!scenario.failInstantiation)
					assert.equal(result.compiles, 1, 'native module was not reused');
			}
			console.log(
				JSON.stringify({
					...result,
					wasmRequests: wasm.length,
					loaderRequests: glue.length
				})
			);
		} finally {
			await context.close();
		}
	}
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
