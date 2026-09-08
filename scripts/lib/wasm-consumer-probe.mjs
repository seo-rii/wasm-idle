import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

export async function probeFileIdentity(filename) {
	const bytes = await readFile(filename);
	return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function validateWasmConsumerResult(fixture, result) {
	assert.equal(result.output, fixture.expectedOutput, `wrong output: ${fixture.name}`);
	assert.equal(result.prepared, true, `production worker did not prepare: ${fixture.name}`);
	assert.equal(result.ready, true, `production worker did not report readiness: ${fixture.name}`);
	if (fixture.expectedError) {
		assert.equal(result.error, fixture.expectedError, `wrong runtime error: ${fixture.name}`);
		assert.equal(result.success, false);
	} else {
		assert.equal(result.error, null, `runtime error: ${fixture.name}`);
		assert.equal(result.success, true, `runtime did not complete: ${fixture.name}`);
	}
}

// Acceptance only: build the existing production worker and stdin transport without copying their logic.
export async function runWasmConsumerProbe({
	wasmBytes,
	cases,
	workRoot,
	executablePath,
	modes = ['explicit', 'buffered']
}) {
	assert.ok(wasmBytes instanceof Uint8Array && wasmBytes.length > 0, 'Wasm bytes are required');
	assert.ok(Array.isArray(cases) && cases.length > 0, 'at least one consumer case is required');
	assert.ok(modes.length > 0 && modes.every((mode) => ['explicit', 'buffered'].includes(mode)));
	await WebAssembly.compile(wasmBytes);
	await mkdir(workRoot, { recursive: true });
	const directory = await mkdtemp(path.join(workRoot, 'runner-'));
	const bundles = path.join(directory, 'bundles');
	const sourcePaths = [
		'src/lib/playground/worker/wasm.ts',
		'src/lib/playground/stdinBuffer.ts',
		'src/lib/playground/sharedBuffer.ts',
		'scripts/lib/wasm-consumer-probe.mjs',
		'pnpm-lock.yaml'
	];
	const snapshotSources = () =>
		Promise.all(
			sourcePaths.map(async (relative) => ({
				path: relative,
				...(await probeFileIdentity(path.join(REPO_ROOT, relative)))
			}))
		);
	const sources = await snapshotSources();
	const { build, transformWithOxc } = await import('vite');
	await build({
		root: REPO_ROOT,
		configFile: false,
		publicDir: false,
		logLevel: 'warn',
		cacheDir: path.join(directory, 'vite-cache'),
		// This standalone worker has no Svelte-generated configuration dependency.
		oxc: false,
		plugins: [
			{
				name: 'consumer-worker-typescript',
				enforce: 'pre',
				transform(code, filename) {
					if (filename.endsWith('.ts'))
						return transformWithOxc(code, filename, {
							tsconfig: false,
							target: 'es2022'
						});
				}
			}
		],
		resolve: { alias: { $lib: path.join(REPO_ROOT, 'src/lib') } },
		build: {
			target: 'es2022',
			outDir: bundles,
			emptyOutDir: true,
			minify: false,
			rolldownOptions: { tsconfig: false },
			lib: {
				entry: {
					worker: path.join(REPO_ROOT, 'src/lib/playground/worker/wasm.ts'),
					stdin: path.join(REPO_ROOT, 'src/lib/playground/stdinBuffer.ts')
				},
				formats: ['es'],
				fileName: (_format, entry) => `${entry}.mjs`
			}
		}
	});
	const routes = new Map();
	const bundleEvidence = [];
	for (const name of await readdir(bundles)) {
		assert.match(name, /^[A-Za-z0-9_.-]+\.m?js$/, 'unexpected worker bundle output');
		const filename = path.join(bundles, name);
		routes.set(`/runner/${name}`, await readFile(filename));
		bundleEvidence.push({ path: name, ...(await probeFileIdentity(filename)) });
	}
	const server = createServer((request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cache-Control', 'no-store');
		if (request.url === '/') {
			response.setHeader('Content-Type', 'text/html');
			response.end('<!doctype html><title>WASM consumer acceptance</title>');
		} else if (routes.has(request.url)) {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(routes.get(request.url));
		} else {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	let browser;
	try {
		const { chromium } = await import('playwright-core');
		browser = await chromium.launch({
			headless: true,
			...(executablePath ? { executablePath } : {})
		});
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${server.address().port}/`);
		await page.evaluate((code) => {
			globalThis.__wasmConsumerCode = code;
		}, Buffer.from(wasmBytes).toString('base64'));
		const results = [];
		for (const mode of modes) {
			for (const fixture of cases) {
				const result = await page.evaluate(
					async ({ fixture, mode }) => {
						const { flushQueuedStdin, flushBufferedEof } =
							await import('/runner/stdin.mjs');
						if (mode === 'buffered' && !crossOriginIsolated)
							throw new Error('Shared stdin needs cross-origin isolation');
						return await new Promise((resolve, reject) => {
							const worker = new Worker('/runner/worker.mjs', { type: 'module' });
							const buffer =
								mode === 'buffered' ? new SharedArrayBuffer(16) : undefined;
							const queue = fixture.stdin ? [fixture.stdin] : [];
							let phase = 'load';
							const result = {
								name: fixture.name,
								mode,
								output: '',
								error: null,
								success: false,
								prepared: false,
								ready: false,
								inputRequests: 0,
								eofWrites: 0
							};
							const finish = (error) => {
								clearTimeout(timer);
								worker.terminate();
								if (error) reject(error);
								else resolve(result);
							};
							const timer = setTimeout(
								() =>
									finish(
										new Error(
											`Consumer case timed out: ${fixture.name}/${mode}`
										)
									),
								15000
							);
							worker.onerror = (event) => finish(new Error(event.message));
							worker.onmessageerror = () =>
								finish(new Error('Consumer worker message could not be decoded'));
							worker.onmessage = ({ data }) => {
								if (data.error) {
									if (phase !== 'run') {
										finish(new Error(data.error));
										return;
									}
									result.error = data.error;
									finish();
									return;
								}
								if (data.load && phase === 'load') {
									phase = 'prepare';
									worker.postMessage({
										prepare: true,
										code: globalThis.__wasmConsumerCode
									});
								} else if (data.results && phase === 'prepare') {
									result.prepared = true;
									phase = 'run';
									worker.postMessage({
										code: globalThis.__wasmConsumerCode,
										buffer,
										...(mode === 'explicit' ? { stdin: fixture.stdin } : {})
									});
								} else if (phase === 'run') {
									if (data.buffer) {
										if (!buffer) {
											finish(
												new Error('Explicit stdin requested shared input')
											);
											return;
										}
										result.inputRequests++;
										if (!flushQueuedStdin(queue, buffer)) {
											flushBufferedEof(buffer);
											result.eofWrites++;
										}
									}
									if (data.progress?.kind === 'ready') result.ready = true;
									if (data.output) result.output += data.output;
									if (result.output.length > 65536) {
										finish(new Error('Consumer output exceeded fixture limit'));
										return;
									}
									if (data.results) {
										result.success = true;
										finish();
									}
								}
							};
							worker.postMessage({ load: true });
						});
					},
					{ fixture, mode }
				);
				validateWasmConsumerResult(fixture, result);
				if (mode === 'buffered')
					assert.ok(
						result.inputRequests > 0,
						`shared stdin was not requested: ${fixture.name}`
					);
				results.push(result);
			}
		}
		assert.deepEqual(
			await snapshotSources(),
			sources,
			'consumer source or harness changed during acceptance'
		);
		return {
			browser: await browser.version(),
			runner: { sources, bundles: bundleEvidence },
			results
		};
	} finally {
		try {
			await browser?.close();
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	}
}
