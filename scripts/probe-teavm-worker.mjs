import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'vite';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'teavm-worker-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtures = [
	{
		name: 'shared-stdin',
		chunks: ['8 ', '13\n'],
		expected: '21\n',
		prepare: true,
		code: 'import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner in = new Scanner(System.in); System.out.println(in.nextInt() + in.nextInt()); } }'
	},
	{
		name: 'utf8-eof',
		chunks: ['한글 ', '42'],
		expected: '한글 42',
		code: 'public class Main { public static void main(String[] args) throws Exception { byte[] bytes = System.in.readAllBytes(); System.out.write(bytes); System.out.flush(); } }'
	},
	{
		name: 'formatting',
		chunks: ['3.14159\n'],
		expected: '3.14 %\n',
		code: 'import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner in = new Scanner(System.in); System.out.printf("%.2f %%%n", in.nextDouble()); } }'
	},
	{
		name: 'caught-stack',
		chunks: [],
		outputContains: ['java.lang.IllegalStateException: caught', 'Main.fail(Main.java:2)'],
		code: 'public class Main {\n static void fail() { throw new IllegalStateException("caught"); }\n public static void main(String[] args) { try { fail(); } catch (Exception e) { e.printStackTrace(); } }\n}'
	},
	{
		name: 'uncaught-stack',
		chunks: [],
		errorContains: ['java.lang.IllegalArgumentException: uncaught', 'Main.fail(Main.java:2)'],
		code: 'public class Main {\n static void fail() { throw new IllegalArgumentException("uncaught"); }\n public static void main(String[] args) { fail(); }\n}'
	},
	{
		name: 'diagnostic',
		chunks: [],
		diagnostic: true,
		code: 'public class Main { public static void main(String[] args) { missingSymbol(); } }'
	},
	{
		name: 'recovery',
		chunks: [],
		expected: 'fresh\n',
		code: 'public class Main { public static void main(String[] args) { System.out.println("fresh"); } }'
	}
];
let browser;
let server;
try {
	await build({
		root,
		configFile: false,
		publicDir: false,
		logLevel: 'error',
		resolve: {
			alias: {
				$lib: path.join(root, 'src/lib'),
				'@wasm-idle/core': path.join(root, 'packages/core/src/index.ts')
			}
		},
		build: {
			target: 'es2022',
			outDir: temporary,
			emptyOutDir: false,
			minify: false,
			copyPublicDir: false,
			lib: {
				entry: path.join(root, 'src/lib/playground/worker/java.ts'),
				formats: ['es'],
				fileName: () => 'worker.mjs'
			}
		}
	});
	const workerBytes = await readFile(path.join(temporary, 'worker.mjs'));
	const manifestBytes = await readFile(path.join(root, 'static/teavm/runtime-manifest.v2.json'));
	const manifest = JSON.parse(manifestBytes);
	const assets = new Map();
	for (const asset of manifest.assets) {
		const stored = await readFile(path.join(root, 'static/teavm', asset.storage.path));
		assert.equal(stored.length, asset.storage.bytes);
		assert.equal(sha256(stored), asset.storage.sha256);
		const logical = asset.storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
		assert.equal(logical.length, asset.bytes);
		assert.equal(sha256(logical), asset.sha256);
		assets.set(`/teavm/${asset.path}`, logical);
	}
	server = createServer(async (request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		try {
			const pathname = new URL(request.url, 'http://localhost').pathname;
			if (pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end(
					'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">'
				);
				return;
			}
			const asset = assets.get(pathname);
			if (asset) {
				response.setHeader(
					'Content-Type',
					pathname.endsWith('.wasm')
						? 'application/wasm'
						: pathname.endsWith('.js')
							? 'text/javascript'
							: 'application/octet-stream'
				);
				response.end(asset);
				return;
			}
			const file = path.resolve(temporary, `.${pathname}`);
			if (!file.startsWith(`${temporary}${path.sep}`) || !/\.m?js$/u.test(file)) {
				response.writeHead(404).end();
				return;
			}
			response.setHeader('Content-Type', 'text/javascript');
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
	const consoleWarnings = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('console', (message) => {
		if (['warning', 'error'].includes(message.type())) consoleWarnings.push(message.text());
	});
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	const results = await page.evaluate(async (fixtures) => {
		if (!crossOriginIsolated) throw Error('Worker probe requires SharedArrayBuffer isolation');
		const results = [];
		for (const streamCompiler of [false, true]) {
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
							inputRequests: 0,
							assetProgress: [],
							error: null
						};
						const timer = setTimeout(
							() => finish(Error('Java worker timed out')),
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
									chunk === undefined ? null : new TextEncoder().encode(chunk);
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
							if (message.assetProgress)
								result.assetProgress.push(message.assetProgress);
							if (message.error) result.error = message.error;
							if (message[completion] || message.error) finish();
						};
						worker.postMessage({ ...data, buffer });
					});
				}
				const loaded = await request(
					{
						load: true,
						assets: {
							baseUrl: new URL('/teavm/', location.href).href,
							useAssetBridge: false,
							streamCompiler
						}
					},
					'load'
				);
				if (loaded.error)
					throw Error(
						`${streamCompiler ? 'streaming' : 'buffered'} load: ${loaded.error}`
					);
				if (streamCompiler && !loaded.assetProgress.length)
					throw Error('Compiler streaming path was not exercised');
				for (const fixture of fixtures) {
					if (fixture.prepare) {
						const prepared = await request(
							{ code: fixture.code, prepare: true },
							'results'
						);
						if (prepared.error || prepared.output || prepared.inputRequests)
							throw Error(`Java prepare: ${JSON.stringify(prepared)}`);
					}
					const result = await request({ code: fixture.code }, 'results', fixture.chunks);
					// Advanced optimization can omit Main.main from the launcher call chain.
					// Require the original throw site, and reject undecoded placeholder frames.
					if (
						(fixture.outputContains || fixture.errorContains) &&
						/Throwable\$FakeClass|wasm-function\[/u.test(
							result.output + (result.error ?? '')
						)
					)
						throw Error(`Undecoded Java source stack: ${JSON.stringify(result)}`);
					if (fixture.diagnostic) {
						if (
							!result.error ||
							!result.diagnostics.some((item) =>
								item.message.includes('missingSymbol')
							)
						)
							throw Error('Missing Java compiler diagnostic');
					} else if (fixture.errorContains) {
						for (const expected of fixture.errorContains)
							if (!result.error?.includes(expected))
								throw Error(
									`Missing Java exception frame: ${JSON.stringify(result)}`
								);
					} else {
						if (result.error) throw Error(`${fixture.name}: ${result.error}`);
						if (fixture.expected !== undefined && result.output !== fixture.expected)
							throw Error(`${fixture.name}: ${JSON.stringify(result)}`);
						for (const expected of fixture.outputContains ?? [])
							if (!result.output.includes(expected))
								throw Error(`Missing caught Java frame: ${JSON.stringify(result)}`);
						if (fixture.chunks.length && !result.inputRequests)
							throw Error('Java stdin bypassed shared buffer');
					}
					results.push({ streamCompiler, fixture: fixture.name, ...result });
				}
			} finally {
				worker.terminate();
			}
		}
		return results;
	}, fixtures);
	assert.deepEqual(pageErrors, []);
	assert.deepEqual(consoleWarnings, []);
	const receipt = {
		format: 'wasm-idle-teavm-worker-acceptance-v1',
		profileId: manifest.profileId,
		chromiumVersion: browser.version(),
		workerSha256: sha256(workerBytes),
		manifestSha256: sha256(manifestBytes),
		consoleWarnings,
		results
	};
	if (process.env.WASM_IDLE_TEAVM_WORKER_RECEIPT)
		await writeFile(
			process.env.WASM_IDLE_TEAVM_WORKER_RECEIPT,
			`${JSON.stringify(receipt, null, 2)}\n`
		);
	console.log(JSON.stringify(receipt, null, 2));
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	await rm(temporary, { recursive: true, force: true });
}
