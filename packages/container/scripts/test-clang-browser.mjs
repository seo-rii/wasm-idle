// Opt-in real producer qualification. Build-only preparation never reports a pass.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { digest, loadClangBrowserInputs } from './clang-browser-inputs.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(packageRoot, '../..');
const buildOnly = process.argv.slice(2).includes('--build-only');
assert(
	process.argv.slice(2).every((value) => value === '--build-only'),
	'Only --build-only is supported'
);
const timeoutMs = Number(process.env.CONTAINER_CLANG_TIMEOUT_MS ?? 120000);
assert(
	Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000,
	'Invalid CONTAINER_CLANG_TIMEOUT_MS'
);
const csp =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
const evidence = {
	schemaVersion: 1,
	startedAt: new Date().toISOString(),
	qualification: 'pending',
	passed: false,
	node: process.version,
	os: { platform: platform(), release: release(), arch: arch() },
	timeoutMs,
	applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: repository,
		encoding: 'utf8'
	}).trim(),
	csp,
	isolated: true,
	httpCache: 'no-store',
	runs: [],
	faults: []
};
let browser, server, failure;
const requests = new Map();
try {
	// Direct source aliases keep this fixture independent of another worktree's dist
	// and resolve bare LLVM/Core imports in module Workers without import maps.
	const bundle = await build({
		absWorkingDir: repository,
		entryPoints: {
			harness: resolve(packageRoot, 'test/browser/clang-entry.mjs'),
			'clang-worker': resolve(packageRoot, 'src/adapters/clang/worker.ts'),
			'wasi-worker': resolve(packageRoot, 'src/adapters/wasi/worker.ts')
		},
		alias: {
			'@wasm-idle/core': resolve(repository, 'packages/core/src/index.ts'),
			'@wasm-idle/llvm-core/tool-host': resolve(
				repository,
				'packages/llvm-core/runtime/clang/src/tool-host.ts'
			)
		},
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		outdir: '/fixture',
		write: false,
		metafile: true,
		logLevel: 'silent'
	});
	assert(
		Object.values(bundle.metafile.outputs).every((output) => output.imports.length === 0),
		'Fixture must not leave unresolved or remote imports'
	);
	const served = new Map(
		bundle.outputFiles.map((file) => [
			`/${file.path.split('/').at(-1)}`,
			{ body: file.contents, type: 'text/javascript' }
		])
	);
	evidence.bundles = Object.fromEntries(
		[...served].map(([name, file]) => [
			name,
			{ bytes: file.body.length, sha256: digest(file.body) }
		])
	);
	evidence.sources = {};
	for (const path of Object.keys(bundle.metafile.inputs).sort()) {
		evidence.sources[path] = digest(await readFile(resolve(repository, path)));
	}
	if (buildOnly) {
		console.log(
			JSON.stringify({
				status: 'prepared',
				qualification: 'not-run',
				bundles: evidence.bundles
			})
		);
	} else {
		assert(process.env.CONTAINER_EVIDENCE, 'Set CONTAINER_EVIDENCE to a new receipt file');
		const inputs = await loadClangBrowserInputs(process.env);
		evidence.producer = {
			receiptSha256: inputs.producerSha256,
			smokeSha256: inputs.producerSmokeSha256,
			source: inputs.producer.source,
			profile: inputs.producer.profile.profileId,
			optimization: inputs.producer.optimization,
			linkTimeOptimization: inputs.producer.linkTimeOptimization
		};
		evidence.assets = Object.fromEntries(
			Object.entries(inputs.assets).map(([name, asset]) => [name, asset.metadata])
		);
		served.set('/', {
			body: '<!doctype html><meta charset="utf-8"><title>Real Clang qualification</title><link rel="icon" href="/favicon.ico"><script type="module" src="/harness.js"></script>',
			type: 'text/html'
		});
		served.set('/favicon.ico', { body: '', type: 'image/x-icon', status: 204 });
		for (const [name, asset] of Object.entries(inputs.assets)) {
			served.set(`/assets/${name}`, {
				body: asset.delivery,
				type: asset.metadata.delivery.mediaType
			});
			requests.set(`/assets/${name}`, { requests: 0, bytes: 0 });
		}
		server = createServer((request, response) => {
			const pathname = new URL(request.url, 'http://localhost').pathname;
			const file = served.get(pathname);
			response.setHeader('Content-Security-Policy', csp);
			response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
			response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
			response.setHeader('Cache-Control', 'no-store');
			response.setHeader('X-Content-Type-Options', 'nosniff');
			if (request.method !== 'GET' || !file) {
				response.writeHead(404).end();
				return;
			}
			if (requests.has(pathname)) {
				const entry = requests.get(pathname);
				entry.requests++;
				entry.bytes += file.body.byteLength;
			}
			response.setHeader('Content-Type', file.type);
			response.statusCode = file.status ?? 200;
			response.end(file.body);
		});
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const origin = `http://127.0.0.1:${server.address().port}`;
		const producer = {
			repository: inputs.producer.source.repository,
			revision: inputs.producer.source.revision,
			receiptSha256: inputs.producerSha256
		};
		const manifest = JSON.stringify({
			schemaVersion: 1,
			distributionId: `clang-browser-${inputs.producerSha256}`,
			packages: [
				{
					id: 'llvm',
					identity: `sha256:${inputs.producerSha256}`,
					producer,
					dependencies: [],
					mount: '/opt/toolchains/fixture',
					capabilities: ['wasi-preview1', 'llvm-tool-host-exec-v1'],
					assets: Object.entries(inputs.assets).map(([name, asset]) => ({
						...asset.metadata,
						url: `${origin}/assets/${name}`
					})),
					files: [
						{ path: 'bin/clang', asset: 'clang', executable: true },
						{ path: 'bin/wasm-ld', asset: 'lld', executable: true },
						{ path: 'fixture-sysroot.tar', asset: 'sysroot', executable: false }
					]
				}
			],
			commands: [
				{
					name: 'clang',
					package: 'llvm',
					adapter: 'llvm-clang-tool-host-v1',
					path: 'bin/clang',
					argv0: 'clang',
					prefixArgs: []
				}
			]
		});
		const manifestSha256 = digest(Buffer.from(manifest));
		evidence.distributionSha256 = manifestSha256;
		served.set('/fixture.json', {
			type: 'application/json',
			body: JSON.stringify({
				manifest,
				manifestSha256,
				timeoutMs,
				producerSha256: inputs.producerSha256,
				assetURLs: [...requests.keys()].map((path) => `${origin}${path}`),
				clangSha256: inputs.assets.clang.metadata.logical.sha256,
				linkerSha256: inputs.assets.lld.metadata.logical.sha256
			})
		});
		browser = await chromium.launch({
			headless: true,
			executablePath: process.env.CHROMIUM_PATH,
			args: ['--no-sandbox', '--js-flags=--wasm-num-compilation-tasks=1']
		});
		evidence.browser = browser.version();
		const context = await browser.newContext();
		await addBrowserTestCookies(context, origin);
		const page = await context.newPage();
		page.on('pageerror', (error) =>
			evidence.faults.push({ type: 'pageerror', message: error.message })
		);
		page.on('console', (message) => {
			if (message.type() === 'error')
				evidence.faults.push({ type: 'console', message: message.text() });
		});
		const unexpected = [];
		context.on('request', (request) => {
			const url = new URL(request.url());
			if (url.origin !== origin || !served.has(url.pathname)) unexpected.push(request.url());
		});
		const snapshot = () =>
			Object.fromEntries([...requests].map(([path, value]) => [path, { ...value }]));
		for (let attempt = 0; attempt < 2; attempt++) {
			const before = snapshot();
			await page.goto(origin);
			await page.waitForFunction(
				() => globalThis.clangBrowserFixture !== undefined,
				undefined,
				{ timeout: 30000 }
			);
			const metadata = await page.evaluate(() => globalThis.clangBrowserFixture.metadata());
			assert.equal(metadata.command, 'clang');
			assert.equal(metadata.isolated, true);
			assert.equal(metadata.startedWorkers, 0);
			assert.equal(metadata.manager.assets.cachedEntries, 0);
			assert.deepEqual(
				snapshot(),
				before,
				'Boot and metadata lookup must not fetch compiler bodies'
			);
			const result = await page.evaluate(
				(full) => globalThis.clangBrowserFixture.run(full),
				attempt === 0
			);
			evidence.runs.push({ attempt, metadata, before, after: snapshot(), ...result });
			assert.equal(result.passed, true, result.error);
			assert.equal(result.liveWorkers, 0);
			assert.equal(result.inspection.processes.length, 0);
			assert.ok(
				result.cacheNames.some((name) => name.includes('container-real-clang-browser'))
			);
			for (const [path, count] of requests) {
				assert.equal(
					count.requests,
					1,
					`${path}: warm reload must reuse the verified persistent body`
				);
				assert.equal(count.bytes, served.get(path).body.byteLength);
			}
			if (attempt)
				assert.deepEqual(
					snapshot(),
					before,
					'Reloaded execution must not redownload any asset body'
				);
		}
		assert.deepEqual(
			unexpected,
			[],
			'Fixture must not refetch unregistered assets or import remote host code'
		);
		assert.deepEqual(
			evidence.faults,
			[],
			'CSP/module/Worker browser errors must fail qualification'
		);
		evidence.passed = true;
		evidence.qualification =
			'Chromium batch snapshot Clang C/C++ CLI; full pinned sysroot mounted; no shell/live/persistence/performance claim';
	}
} catch (error) {
	failure = error;
	evidence.error = error instanceof Error ? error.message : String(error);
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	if (!buildOnly && process.env.CONTAINER_EVIDENCE) {
		evidence.finishedAt = new Date().toISOString();
		evidence.downloads = Object.fromEntries(requests);
		const output = resolve(process.env.CONTAINER_EVIDENCE);
		await mkdir(dirname(output), { recursive: true });
		await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', {
			flag: 'wx',
			mode: 0o600
		});
		console.log(
			JSON.stringify({
				passed: evidence.passed,
				qualification: evidence.qualification,
				evidence: relative(process.cwd(), output),
				error: evidence.error
			})
		);
	}
}
if (failure) throw failure;
