// Qualify receipt-pinned upstream BusyBox through production batch/live adapters.
// Bundles source or prebuilt dist into a fresh evidence directory; never builds
// or changes the user's checkout or installed dependencies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { parseArgs } from 'node:util';
import { exerciseCommands } from '../test/command-container.mjs';
import { createCommandMatrix } from '../test/command-cases.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';

const { values } = parseArgs({
	options: {
		artifact: { type: 'string' },
		'producer-work': { type: 'string' },
		'smoke-receipt': { type: 'string' },
		stage: { type: 'string', default: '1' },
		'source-root': { type: 'string' },
		'container-dist': { type: 'string' },
		'core-dist': { type: 'string' },
		'dependency-root': { type: 'string' },
		work: { type: 'string' },
		output: { type: 'string' },
		'node-only': { type: 'boolean', default: false },
		profiles: { type: 'string', default: 'batch,live' }
	}
});
for (const key of ['work', 'output']) assert.ok(values[key], `Required: --${key}`);
assert.ok(values.artifact || values['producer-work'], 'Required: --artifact or --producer-work');
assert.ok(
	values['smoke-receipt'] || values['producer-work'],
	'Required: --smoke-receipt or --producer-work'
);
assert.ok(
	values['source-root'] || values['container-dist'],
	'Required: --source-root or --container-dist'
);
assert.ok(!(values['source-root'] && values['container-dist']), 'Select source or dist, not both');
const profiles = values.profiles.split(',');
assert.ok(
	profiles.length &&
		new Set(profiles).size === profiles.length &&
		profiles.every((name) => ['batch', 'live'].includes(name)),
	'Invalid --profiles'
);
const repository = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const work = resolve(values.work),
	output = resolve(values.output),
	stage = Number(values.stage);
const matrix = createCommandMatrix(stage),
	sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifact = await readFile(
	resolve(values.artifact ?? join(values['producer-work'], 'busybox.wasm'))
);
const smokePath = resolve(
	values['smoke-receipt'] ?? join(values['producer-work'], 'command-smoke.json')
);
const smokeBytes = await readFile(smokePath),
	smoke = JSON.parse(smokeBytes);
assert.equal(
	smoke.passed,
	true,
	'Native/WASI producer qualification must pass before container qualification'
);
assert.equal(smoke.stage, stage);
assert.equal(smoke.artifact.sha256, sha(artifact));
assert.equal(smoke.artifact.bytes, artifact.length);
assert.ok(smoke.nativeSha256, 'A native differential receipt is required');
assert.equal(smoke.matrix.cases, matrix.cases.length);
assert.equal(smoke.cases.length, matrix.cases.length * 2);
assert.ok(smoke.cases.every((test) => test.passed));
const pinnedMatrix = await readFile(resolve(dirname(smokePath), smoke.matrix.path));
assert.equal(sha(pinnedMatrix), smoke.matrix.sha256);
assert.deepEqual(
	JSON.parse(pinnedMatrix),
	matrix,
	'Qualification must execute the same matrix as its producer'
);

const dependencyRequire = createRequire(
	pathToFileURL(resolve(values['dependency-root'] ?? repository, 'package.json'))
);
const { build } = dependencyRequire('esbuild');
const sourceRoot = values['source-root'] ? resolve(values['source-root']) : undefined;
const containerRoot = sourceRoot
	? join(sourceRoot, 'packages/container/src')
	: resolve(values['container-dist']);
const coreRoot = sourceRoot
	? join(sourceRoot, 'packages/core/src')
	: resolve(values['core-dist'] ?? join(containerRoot, '../../core/dist'));
const extension = sourceRoot ? 'ts' : 'js';
const entries = { container: join(containerRoot, `index.${extension}`) };
for (const profile of profiles) {
	const directory = profile === 'live' ? 'wasi-live' : 'wasi';
	entries[`${profile}-adapter`] = join(containerRoot, `adapters/${directory}/index.${extension}`);
	entries[`${profile}-worker`] = join(containerRoot, `adapters/${directory}/worker.${extension}`);
}
const bundled = await build({
	absWorkingDir: repository,
	entryPoints: entries,
	bundle: true,
	// Owner FS errors and live RPC errors must use the same constructor identity.
	// Production ESM shares these modules; shared chunks preserve that contract.
	splitting: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	outdir: join(work, 'bundle'),
	write: false,
	metafile: true,
	alias: { '@wasm-idle/core': join(coreRoot, `index.${extension}`) },
	logLevel: 'silent'
});
await mkdir(work, { mode: 0o700 });
await mkdir(join(work, 'bundle'), { mode: 0o700 });
const files = new Map();
const bundleHashes = {};
for (const file of bundled.outputFiles) {
	await writeFile(file.path, file.contents, { flag: 'wx', mode: 0o600 });
	const name = file.path.slice(file.path.lastIndexOf('/') + 1);
	files.set(`/bundle/${name}`, { type: 'text/javascript', body: file.contents });
	bundleHashes[name] = sha(file.contents);
}
const sources = {};
for (const input of Object.keys(bundled.metafile.inputs).sort())
	sources[input] = sha(await readFile(resolve(repository, input)));
for (const name of ['command-cases', 'command-container']) {
	const bytes = await readFile(new URL(`../test/${name}.mjs`, import.meta.url));
	files.set(`/test/${name}.mjs`, { type: 'text/javascript', body: bytes });
	sources[`test/${name}.mjs`] = sha(bytes);
}
files.set('/', {
	type: 'text/html',
	body: '<!doctype html><meta charset="utf-8"><title>BusyBox commands qualification</title>'
});
const contentSecurityPolicy =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'";
const bodyRequests = {},
	runs = [],
	pageErrors = [];
const server = createServer((request, response) => {
	response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	response.setHeader('Content-Security-Policy', contentSecurityPolicy);
	response.setHeader('X-Content-Type-Options', 'nosniff');
	const path = new URL(request.url, 'http://localhost').pathname;
	const match = /^\/assets\/(node|chromium)-(batch|live)\/[a-f0-9]{64}\.wasm$/u.exec(path);
	if (match && path.endsWith(`/${sha(artifact)}.wasm`)) {
		const key = `${match[1]}-${match[2]}`;
		bodyRequests[key] = (bodyRequests[key] ?? 0) + 1;
		response.setHeader('Content-Type', 'application/wasm');
		response.setHeader('Cache-Control', 'no-store');
		response.end(artifact);
		return;
	}
	const item = files.get(path);
	if (!item) {
		response.writeHead(404).end();
		return;
	}
	response.setHeader('Content-Type', item.type);
	response.end(item.body);
});
let origin;
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
	cwd: sourceRoot ?? repository,
	encoding: 'utf8'
}).trim();
function config(host, profile) {
	const assetURL = `${origin}/assets/${host}-${profile}/${sha(artifact)}.wasm`,
		adapterId = profile === 'live' ? 'wasi-preview1-live' : 'wasi-preview1';
	const identity = {
		sha256: sha(artifact),
		bytes: artifact.length,
		mediaType: 'application/wasm'
	};
	const distribution = JSON.stringify({
		schemaVersion: 1,
		distributionId: `busybox-command-stage-${stage}-${host}-${profile}-${sha(artifact)}`,
		packages: [
			{
				id: 'busybox',
				identity: `sha256:${sha(artifact)}`,
				dependencies: [],
				mount: '/opt/toolchains/busybox',
				producer: {
					repository: 'https://github.com/seo-rii/wasm-idle',
					revision: sourceRevision,
					receiptSha256: sha(smokeBytes)
				},
				capabilities: ['wasi-preview1'],
				assets: [
					{
						id: 'busybox',
						url: assetURL,
						encoding: 'identity',
						delivery: identity,
						logical: identity
					}
				],
				files: [{ path: 'bin/busybox', asset: 'busybox', executable: true }]
			}
		],
		commands: ['busybox', ...matrix.applets].map((name) => ({
			name,
			package: 'busybox',
			adapter: adapterId,
			path: 'bin/busybox',
			argv0: name,
			prefixArgs: []
		}))
	});
	return {
		artifactBytes: artifact.length,
		matrix,
		profile,
		distribution,
		distributionSha256: sha(distribution),
		assetURL
	};
}
const evidence = {
	schemaVersion: 1,
	fixture: 'busybox-expanded-commands',
	stage,
	generatedAt: new Date().toISOString(),
	artifact: { sha256: sha(artifact), bytes: artifact.length },
	smokeReceiptSha256: sha(smokeBytes),
	matrixSha256: smoke.matrix.sha256,
	sourceRevision,
	sources,
	bundleHashes,
	node: process.version,
	contentSecurityPolicy,
	runs,
	bodyRequests,
	pageErrors,
	passed: false
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ ...evidence, status: 'running' }, null, 2) + '\n', {
	flag: 'wx',
	mode: 0o600
});
const save = (status) =>
	writeFile(output, JSON.stringify({ ...evidence, status }, null, 2) + '\n', { mode: 0o600 });
let browser;
try {
	await new Promise((done, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', done);
	});
	origin = `http://127.0.0.1:${server.address().port}`;
	for (const profile of profiles) {
		const workerModule = pathToFileURL(join(work, 'bundle', `${profile}-worker.js`)).href;
		const result = await exerciseCommands({
			...config('node', profile),
			containerModule: pathToFileURL(join(work, 'bundle/container.js')).href,
			adapterModule: pathToFileURL(join(work, 'bundle', `${profile}-adapter.js`)).href,
			workerFactory() {
				const worker = new Worker(
					new URL('../test/live-container-worker.mjs', import.meta.url),
					{ workerData: { module: workerModule } }
				);
				const wrapper = {
					onmessage: null,
					onerror: null,
					onmessageerror: null,
					postMessage: (data) => worker.postMessage(data),
					terminate: () => worker.terminate()
				};
				worker.on('message', (data) => wrapper.onmessage?.({ data }));
				worker.on('error', (error) => wrapper.onerror?.({ error }));
				worker.on('messageerror', (error) => wrapper.onmessageerror?.({ error }));
				return wrapper;
			}
		});
		runs.push({ host: 'node', profile, ...result });
		await save('node-in-progress');
	}
	if (!values['node-only']) {
		const { chromium } = dependencyRequire('playwright-core');
		browser = await chromium.launch({
			headless: true,
			executablePath: process.env.CHROMIUM_PATH,
			args: ['--no-sandbox']
		});
		evidence.chromium = browser.version();
		const context = await browser.newContext();
		await addBrowserTestCookies(context, origin);
		const page = await context.newPage();
		page.on('pageerror', (error) => pageErrors.push(error.message));
		page.on('console', (message) => {
			if (
				message.type() === 'error' &&
				/Content Security Policy|Refused to/u.test(message.text())
			)
				pageErrors.push(message.text());
		});
		const response = await page.goto(origin);
		assert.equal(response.headers()['content-security-policy'], contentSecurityPolicy);
		for (const profile of profiles) {
			const result = await page.evaluate(
				async (data) => {
					const { exerciseCommands } = await import('/test/command-container.mjs');
					return exerciseCommands(data);
				},
				{
					...config('chromium', profile),
					containerModule: '/bundle/container.js',
					adapterModule: `/bundle/${profile}-adapter.js`,
					workerModule: `/bundle/${profile}-worker.js`
				}
			);
			runs.push({ host: 'chromium', profile, ...result });
			await save('chromium-in-progress');
		}
	}
	evidence.passed =
		runs.length === profiles.length * (values['node-only'] ? 1 : 2) &&
		runs.every(
			(run) =>
				run.passed &&
				run.cases.length === matrix.cases.length * 2 &&
				run.cachedAssets === 1 &&
				bodyRequests[`${run.host}-${run.profile}`] === 1 &&
				(run.host !== 'chromium' || run.isolated)
		) &&
		!pageErrors.length;
	await save(evidence.passed ? 'passed' : 'failed');
} catch (error) {
	evidence.error = { name: error.name, code: error.code, message: error.message };
	evidence.passed = false;
	await save('failed');
} finally {
	await browser?.close();
	if (server.listening) await new Promise((done) => server.close(done));
}
console.log(
	JSON.stringify(
		{
			passed: evidence.passed,
			stage,
			runs: runs.map((run) => ({
				host: run.host,
				profile: run.profile,
				passed: run.passed,
				cases: run.cases.length,
				failed: run.cases
					.filter((test) => !test.passed)
					.map((test) => `${test.id}:${test.invocation}`),
				failedChecks: run.checks.filter((test) => !test.passed).map((test) => test.id),
				...(run.error ? { error: run.error } : {})
			})),
			output
		},
		null,
		2
	)
);
if (!evidence.passed) process.exitCode = 1;
