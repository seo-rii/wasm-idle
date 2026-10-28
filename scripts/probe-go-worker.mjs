// Exercise the actual playground Worker against the checked-in Go runtime bundle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'static/wasm-go');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'go-worker-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtures = [
	{
		name: 'shared-stdin',
		chunks: ['8 ', '13\n'],
		expected: '21\n',
		code: 'package main\nimport("bufio";"fmt";"os")\nfunc main(){var a,b int;fmt.Fscan(bufio.NewReader(os.Stdin),&a,&b);fmt.Println(a+b)}'
	},
	{
		name: 'utf8-eof',
		chunks: ['한글 ', '42'],
		expected: '한글 42',
		code: 'package main\nimport("fmt";"io";"os")\nfunc main(){b,e:=io.ReadAll(os.Stdin);if e!=nil{panic(e)};fmt.Print(string(b))}'
	},
	{
		name: 'stdlib',
		chunks: [],
		expected: `${sha256('payload')}\n`,
		code: 'package main\nimport("crypto/sha256";"encoding/hex";"fmt")\nfunc main(){d:=sha256.Sum256([]byte("payload"));fmt.Println(hex.EncodeToString(d[:]))}'
	},
	{
		name: 'diagnostic',
		chunks: [],
		expectedError: true,
		code: 'package main\nfunc main(){missingSymbol()}'
	}
];
let server;
let browser;
try {
	await build({
		root,
		configFile: false,
		publicDir: false,
		logLevel: 'error',
		resolve: { alias: { $lib: path.join(root, 'src/lib') } },
		build: {
			target: 'es2022',
			outDir: temporary,
			emptyOutDir: false,
			minify: false,
			copyPublicDir: false,
			lib: {
				entry: path.join(root, 'src/lib/playground/worker/go.ts'),
				formats: ['es'],
				fileName: () => 'worker.mjs'
			}
		}
	});
	const workerBytes = await readFile(path.join(temporary, 'worker.mjs'));
	const manifestBytes = await readFile(path.join(assets, 'runtime/runtime-manifest.v1.json'));
	const buildBytes = await readFile(path.join(assets, 'runtime/runtime-build.json'));
	const manifest = JSON.parse(manifestBytes);
	const runtimeBuild = JSON.parse(buildBytes);
	const targets = ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'];
	for (const target of targets) assert.ok(manifest.targets[target], `Missing target: ${target}`);
	server = createServer(async (request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		try {
			const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
			if (pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end(
					'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">'
				);
				return;
			}
			if (pathname === '/worker.mjs') {
				response.setHeader('Content-Type', 'text/javascript');
				response.end(workerBytes);
				return;
			}
			const file = path.resolve(assets, pathname.slice('/runtime/'.length));
			if (!pathname.startsWith('/runtime/') || !file.startsWith(`${assets}${path.sep}`)) {
				response.writeHead(404).end();
				return;
			}
			response.setHeader(
				'Content-Type',
				file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
			);
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	browser = await chromium.launch({
		headless: true,
		...(process.env.WASM_IDLE_CHROMIUM_EXECUTABLE
			? { executablePath: process.env.WASM_IDLE_CHROMIUM_EXECUTABLE }
			: {})
	});
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	const results = await page.evaluate(
		async ({ fixtures, targets }) => {
			if (!crossOriginIsolated)
				throw Error('Worker probe requires SharedArrayBuffer isolation');
			const results = [];
			for (const target of targets) {
				const worker = new Worker('/worker.mjs', { type: 'module' });
				try {
					async function request(data, completion, chunks = []) {
						const buffer = new SharedArrayBuffer(1024);
						const control = new Int32Array(buffer);
						const payload = new Uint8Array(buffer, 8);
						const queue = [...chunks];
						return await new Promise((resolve, reject) => {
							const result = {
								output: '',
								diagnostics: [],
								phases: [],
								inputRequests: 0,
								error: null
							};
							const timer = setTimeout(
								() => finish(Error(`${target}: worker timed out`)),
								120000
							);
							function finish(error) {
								clearTimeout(timer);
								worker.onmessage = worker.onerror = null;
								if (error) reject(error);
								else resolve(result);
							}
							worker.onerror = (event) => finish(Error(event.message));
							worker.onmessage = ({ data: message }) => {
								if (message.buffer) {
									result.inputRequests++;
									const chunk = queue.shift();
									const bytes =
										chunk === undefined
											? null
											: new TextEncoder().encode(chunk);
									if (bytes && bytes.length > payload.length)
										return finish(Error('Probe input exceeds shared buffer'));
									payload.fill(0);
									if (bytes) payload.set(bytes);
									Atomics.store(control, 1, bytes?.length ?? -1);
									Atomics.add(control, 0, 1);
									Atomics.notify(control, 0);
								}
								if (message.output) result.output += message.output;
								if (message.diagnostic) result.diagnostics.push(message.diagnostic);
								if (message.phase) result.phases.push(message.phase);
								if (message.error) result.error = message.error;
								if (message[completion] || message.error) finish();
							};
							worker.postMessage({ ...data, buffer });
						});
					}
					const loaded = await request(
						{
							load: true,
							compilerUrl: new URL('/runtime/index.js', location.href).href,
							manifestUrl: new URL(
								'/runtime/runtime/runtime-manifest.v1.json',
								location.href
							).href
						},
						'load'
					);
					if (loaded.error) throw Error(loaded.error);
					for (const fixture of fixtures) {
						if (fixture.name === 'shared-stdin') {
							const prepared = await request(
								{ code: fixture.code, target, prepare: true },
								'results'
							);
							if (prepared.error || prepared.phases.join(',') !== 'compile')
								throw Error(`${target}: preparation failed`);
						}
						const result = await request(
							{ code: fixture.code, target },
							'results',
							fixture.chunks
						);
						if (fixture.expectedError) {
							if (!result.error || !result.diagnostics.length)
								throw Error(`${target}: missing compiler diagnostic`);
						} else {
							if (result.error || result.output !== fixture.expected)
								throw Error(`${target}/${fixture.name}: ${JSON.stringify(result)}`);
							if (fixture.chunks.length && !result.inputRequests)
								throw Error(`${target}: stdin bypassed shared buffer`);
							if (
								fixture.name === 'shared-stdin' &&
								result.phases.join(',') !== 'execute'
							)
								throw Error(`${target}: prepared artifact was recompiled`);
						}
						results.push({ target, fixture: fixture.name, ...result });
					}
				} finally {
					worker.terminate();
				}
			}
			return results;
		},
		{ fixtures, targets }
	);
	assert.deepEqual(pageErrors, []);
	const receipt = {
		format: 'wasm-idle-go-worker-acceptance-v1',
		goVersion: runtimeBuild.goVersion,
		chromiumVersion: browser.version(),
		workerSha256: sha256(workerBytes),
		manifestSha256: sha256(manifestBytes),
		buildMetadataSha256: sha256(buildBytes),
		results
	};
	if (process.env.WASM_IDLE_GO_WORKER_RECEIPT) {
		await writeFile(
			process.env.WASM_IDLE_GO_WORKER_RECEIPT,
			`${JSON.stringify(receipt, null, 2)}\n`
		);
	}
	console.log(JSON.stringify(receipt, null, 2));
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	await rm(temporary, { recursive: true, force: true });
}
