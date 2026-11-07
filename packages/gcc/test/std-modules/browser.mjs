import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { stdModuleCases, unsupportedSetjmp } from './cases.mjs';

// Real compiler qualification. No mocked frontend or synthetic execution path.
const { values } = parseArgs({
	options: {
		manifest: { type: 'string' },
		sha256: { type: 'string' },
		out: { type: 'string' },
		'native-bmi': { type: 'string' },
		candidate: { type: 'boolean', default: false }
	}
});
assert(
	values.manifest &&
		values.out &&
		values['native-bmi'] &&
		/^[a-f0-9]{64}$/u.test(values.sha256 ?? ''),
	'Provide --manifest, independent --sha256, --native-bmi directory and --out. Use --candidate only for recorded private qualification candidates.'
);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(values.out),
	bundleRoot = dirname(resolve(values.manifest));
await mkdir(output, { recursive: true, mode: 0o700 });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(values.manifest);
assert.equal(hash(manifestBytes), values.sha256, 'Independent manifest digest');
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.qualification.status, 'verified');
assert.equal(manifest.stdModules.qualification.status, 'verified');
const report = {
	schemaVersion: 1,
	qualificationCandidate: values.candidate,
	manifestSha256: values.sha256,
	manifestPath: resolve(values.manifest),
	startedAt: new Date().toISOString(),
	status: 'running',
	checks: [],
	requests: [],
	assets: {},
	sdkInputs: {},
	sourceInputs: {},
	memoryMeaning:
		'Stage peakMemoryBytes is final Wasm linear memory, excluding JavaScript/MEMFS allocations; page heap is separate and excludes Worker heaps.'
};
const trackedInputs = new Map([[resolve(values.manifest), values.sha256]]);
const payloads = new Map();
const optional = [
	...manifest.stdModules.modules.map((module) => module.bmi),
	manifest.stdModules.initializerArchive.asset,
	manifest.stdModules.signalArchive
];
for (const asset of [...Object.values(manifest.assets), ...optional]) {
	const path = join(bundleRoot, asset.path),
		bytes = await readFile(path);
	assert.equal(bytes.length, asset.bytes, asset.path);
	assert.equal(hash(bytes), asset.sha256, asset.path);
	trackedInputs.set(path, asset.sha256);
	payloads.set(asset.path, bytes);
	report.assets[asset.path] = { bytes: bytes.length, sha256: hash(bytes) };
	if (optional.includes(asset))
		Object.assign(report.assets[asset.path], {
			gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
			brotli5Bytes: brotliCompressSync(bytes, {
				params: { [constants.BROTLI_PARAM_QUALITY]: 5 }
			}).length
		});
}
const native = new Map();
for (const name of ['std.gcm', 'std.compat.gcm']) {
	const path = resolve(values['native-bmi'], name),
		bytes = await readFile(path);
	trackedInputs.set(path, hash(bytes));
	native.set(`std-modules/${name}`, bytes);
}
async function collect(directory, destination) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules') continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await collect(path, destination);
		else if (entry.isFile()) {
			const digest = hash(await readFile(path));
			destination[relative(root, path)] = digest;
			trackedInputs.set(path, digest);
		}
	}
}
for (const directory of ['packages/gcc/src', 'packages/gcc/test/std-modules', 'packages/core/src'])
	await collect(join(root, directory), report.sourceInputs);
const built = await build({
	absWorkingDir: root,
	entryPoints: {
		index: 'packages/gcc/dist/index.js',
		'worker-entry': 'packages/gcc/dist/worker-entry.js'
	},
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	outdir: join(output, 'sdk'),
	metafile: true,
	sourcemap: true,
	logLevel: 'silent'
});
for (const path of Object.keys(built.metafile.inputs)) {
	const absolute = resolve(root, path),
		digest = hash(await readFile(absolute));
	report.sdkInputs[path] = digest;
	trackedInputs.set(absolute, digest);
}
await collect(join(output, 'sdk'), report.sdkInputs);
await writeFile(join(output, 'bundle-meta.json'), JSON.stringify(built.metafile, null, 2) + '\n', {
	mode: 0o600
});

const variants = new Map();
function variant(name, change) {
	const value = structuredClone(manifest);
	change(value);
	const bytes = Buffer.from(JSON.stringify(value));
	variants.set(name, bytes);
	return { name, sha256: hash(bytes) };
}
const invalidMetadata = [
	variant('wrong-host', (value) => {
		value.stdModules.compilerHost = 'x86_64-pc-linux-gnu';
	}),
	variant('wrong-profile', (value) => {
		value.stdModules.profile.optimization = '0';
	}),
	variant('wrong-source', (value) => {
		value.stdModules.bindings.gccSource.sourceDiffSha256 = 'f'.repeat(64);
	})
];
const unverified = variant('unverified-modules', (value) => {
	value.stdModules.qualification.status = 'unverified';
});
const nativeVariant = variant('native-bmi', (value) => {
	for (const module of value.stdModules.modules) {
		const bytes = native.get(module.bmi.path);
		module.bmi.bytes = bytes.length;
		module.bmi.sha256 = hash(bytes);
	}
});
let fault = '';
const server = createServer(async (request, response) => {
	try {
		const pathname = new URL(request.url, 'http://localhost').pathname;
		let bytes,
			status = 200,
			type = 'application/octet-stream';
		if (pathname === '/') {
			bytes = Buffer.from('<!doctype html><title>GCC std modules qualification</title>');
			type = 'text/html';
		} else if (/^\/sdk\/(?:index|worker-entry)\.js(?:\.map)?$/u.test(pathname)) {
			bytes = await readFile(join(output, pathname.slice(1)));
			type = 'text/javascript';
		} else {
			const [, scope, ...parts] = pathname.split('/'),
				path = parts.join('/');
			if (path === 'manifest.json') {
				bytes = variants.get(scope) ?? manifestBytes;
				type = 'application/json';
			} else {
				bytes =
					scope === 'native-bmi' && native.has(path)
						? native.get(path)
						: payloads.get(path);
				if (
					scope === 'fault' &&
					((fault === 'missing-std' && path === 'std-modules/std.gcm') ||
						(fault === 'missing-compat' && path === 'std-modules/std.compat.gcm'))
				)
					bytes = undefined;
				if (
					scope === 'fault' &&
					fault === 'corrupt-std' &&
					path === 'std-modules/std.gcm'
				) {
					bytes = Buffer.from(bytes);
					bytes[0] ^= 1;
				}
			}
		}
		if (!bytes) {
			bytes = Buffer.from('Missing qualification fixture');
			status = 404;
		}
		report.requests.push({ path: pathname, status, bytes: bytes.length });
		response.writeHead(status, {
			'Content-Type': type,
			'Content-Length': bytes.length,
			'Cache-Control': 'no-store',
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		});
		response.end(bytes);
	} catch (error) {
		response.writeHead(500);
		response.end(String(error));
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const optionalRequests = (start = 0) =>
	report.requests.slice(start).filter((request) => request.path.includes('/std-modules/'));
function passed(id, evidence = {}) {
	report.checks.push({ id, status: 'passed', ...evidence });
}
try {
	browser = await chromium.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-dev-shm-usage']
	});
	report.browser = browser.version();
	const page = await browser.newPage();
	page.setDefaultTimeout(180_000);
	await page.goto(origin);
	await page.evaluate(async () => {
		globalThis.sdk = await import('/sdk/index.js');
	});
	async function initialize(scope = 'qualified', sha256 = values.sha256) {
		return page.evaluate(
			async ({ manifestUrl, manifestSha256 }) => {
				globalThis.compiler?.dispose();
				globalThis.compiler = undefined;
				const started = performance.now();
				globalThis.compiler = await globalThis.sdk.createGccWorker({
					target: 'wasm32-wasi',
					manifestUrl,
					manifestSha256
				});
				return {
					milliseconds: performance.now() - started,
					identity: globalThis.compiler.identity
				};
			},
			{ manifestUrl: `${origin}/${scope}/manifest.json`, manifestSha256: sha256 }
		);
	}
	async function execute(fixture, stdModules = true) {
		return page.evaluate(
			async ({ fixture, stdModules }) => {
				const [main, ...others] = Object.entries(fixture.sources),
					started = performance.now();
				const compiled = await globalThis.compiler.compile({
					code: main[1],
					...(stdModules ? { stdModules: true, standard: 'gnu++23' } : {}),
					files: others.map(([path, contents]) => ({ path, contents })),
					sources: others.map(([path]) => path)
				});
				if (compiled.exitCode !== 0)
					throw new Error(`Compilation failed (${fixture.id}): ${compiled.stderr}`);
				const executed = await globalThis.compiler.run(compiled.artifact, {
					stdin: fixture.stdin
				});
				return {
					milliseconds: performance.now() - started,
					exitCode: executed.exitCode,
					stdout: executed.stdout,
					stderr: executed.stderr,
					stages: compiled.stages,
					artifactBytes: compiled.artifact.bytes.length,
					pageHeapBytes: performance.memory?.usedJSHeapSize
				};
			},
			{ fixture, stdModules }
		);
	}
	const initialized = await initialize();
	assert.equal(optionalRequests().length, 0);
	passed('initialization-zero-module-fetch', initialized);
	const header = {
		id: 'ordinary-header',
		stdin: '41\n',
		stdout: '42\n',
		sources: {
			'main.cpp':
				'#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n+1<<"\\n";}\n'
		}
	};
	const ordinary = await execute(header, false);
	assert.equal(ordinary.exitCode, 0);
	assert.equal(ordinary.stdout, header.stdout);
	assert.equal(optionalRequests().length, 0);
	passed('header-zero-module-fetch', ordinary);
	for (const update of [
		{ standard: undefined },
		{ standard: 'c++23' },
		{ optimization: '0' },
		{ optimization: '3' },
		{ language: 'c', standard: 'gnu17' },
		{ preprocessed: true },
		{ emit: 'object' },
		{ defines: ['_GLIBCXX_USE_CXX11_ABI=0'] },
		{ rtti: true },
		{ exceptions: true },
		{ simd: true },
		{ debug: true },
		{ coverage: true },
		{ linkInputs: [{}] },
		{ flags: ['-frtti'] }
	]) {
		const error = await page.evaluate(async (update) => {
			try {
				await globalThis.compiler.compile({
					code: 'import std;',
					stdModules: true,
					standard: 'gnu++23',
					...update
				});
				return '';
			} catch (error) {
				return error.message;
			}
		}, update);
		assert(error, 'Invalid request must reject');
		assert.equal(optionalRequests().length, 0);
		passed('request-profile-rejection', { update, error });
	}
	for (const fixture of stdModuleCases) {
		const result = await execute(fixture);
		assert.equal(result.exitCode, 0, fixture.id);
		assert.equal(result.stdout, fixture.stdout, fixture.id);
		assert.equal(result.stderr, '', fixture.id);
		assert.equal(optionalRequests().length, 4);
		passed(fixture.id, result);
	}
	const cached = await execute(stdModuleCases[0]);
	assert.equal(cached.stdout, stdModuleCases[0].stdout);
	assert.equal(cached.exitCode, 0);
	assert.equal(optionalRequests().length, 4);
	passed('verified-module-cache-reuse', cached);
	const setjmp = await page.evaluate(async (code) => {
		const result = await globalThis.compiler.compile({
			code,
			stdModules: true,
			standard: 'gnu++23'
		});
		return {
			exitCode: result.exitCode,
			stderr: result.stderr,
			stages: result.stages,
			artifact: !!result.artifact
		};
	}, unsupportedSetjmp);
	assert.notEqual(setjmp.exitCode, 0);
	assert.equal(setjmp.artifact, false);
	assert.match(setjmp.stderr, /undefined symbol.*(?:setjmp|longjmp)/su);
	passed('unsupported-setjmp', setjmp);
	for (const entry of invalidMetadata) {
		const start = report.requests.length;
		await assert.rejects(initialize(entry.name, entry.sha256), /std modules/u);
		assert.equal(
			report.requests
				.slice(start)
				.filter((request) => request.path.startsWith(`/${entry.name}/`)).length,
			1
		);
		passed(entry.name, { assetRequests: 0 });
	}
	const wrongManifestStart = report.requests.length;
	await assert.rejects(initialize('wrong-manifest-hash', '0'.repeat(64)), /integrity|SHA-256/iu);
	assert.equal(
		report.requests
			.slice(wrongManifestStart)
			.filter((request) => request.path.startsWith('/wrong-manifest-hash/')).length,
		1
	);
	passed('wrong-manifest-hash', { assetRequests: 0 });
	await initialize(unverified.name, unverified.sha256);
	const unverifiedStart = report.requests.length;
	await assert.rejects(
		page.evaluate(() =>
			globalThis.compiler.compile({
				code: 'import std;',
				stdModules: true,
				standard: 'gnu++23'
			})
		),
		/separately qualified/u
	);
	assert.equal(optionalRequests(unverifiedStart).length, 0);
	passed('unverified-module-rejection', { optionalRequests: 0 });
	await initialize('fault');
	for (const kind of ['corrupt-std', 'missing-std', 'missing-compat']) {
		fault = kind;
		const start = report.requests.length;
		await assert.rejects(
			page.evaluate(() =>
				globalThis.compiler.compile({
					code: 'import std.compat;',
					stdModules: true,
					standard: 'gnu++23'
				})
			),
			kind === 'corrupt-std' ? /integrity|SHA-256/iu : /404|fetch|load/iu
		);
		passed(kind, { requests: report.requests.slice(start) });
		const beforeHeader = report.requests.length;
		const result = await execute(header, false);
		assert.equal(result.exitCode, 0);
		assert.equal(result.stdout, header.stdout);
		assert.equal(optionalRequests(beforeHeader).length, 0);
		passed(`header-after-${kind}`, result);
	}
	fault = '';
	const retryStart = report.requests.length,
		retried = await execute(stdModuleCases[0]);
	assert.equal(retried.exitCode, 0);
	assert.equal(retried.stdout, stdModuleCases[0].stdout);
	assert.equal(optionalRequests(retryStart).length, 4);
	passed('verified-retry-after-fetch-failures', retried);
	fault = 'corrupt-std';
	const cacheStart = report.requests.length,
		retained = await execute(stdModuleCases[1]);
	assert.equal(retained.exitCode, 0);
	assert.equal(retained.stdout, stdModuleCases[1].stdout);
	assert.equal(optionalRequests(cacheStart).length, 0);
	passed('cache-does-not-refetch', retained);
	fault = '';
	await initialize(nativeVariant.name, nativeVariant.sha256);
	const wrongHost = await page.evaluate(async () => {
		const result = await globalThis.compiler.compile({
			code: 'import std;\nint main(){}',
			stdModules: true,
			standard: 'gnu++23'
		});
		return {
			exitCode: result.exitCode,
			stderr: result.stderr,
			stages: result.stages,
			artifact: !!result.artifact
		};
	});
	assert.notEqual(wrongHost.exitCode, 0);
	assert.equal(wrongHost.artifact, false);
	assert.equal(wrongHost.stages[0].tool, 'cc1plus');
	assert.equal(wrongHost.stages.length, 1);
	assert.match(wrongHost.stderr, /target & host/u);
	assert.match(wrongHost.stderr, /x86_64-pc-linux-gnu/u);
	assert.match(wrongHost.stderr, /wasm32-unknown-emscripten/u);
	passed('real-native-bmi-rejected-by-wasm-gcc', wrongHost);
	await page.evaluate(() => globalThis.compiler.dispose());
	report.status = 'passed';
} catch (error) {
	report.status = 'failed';
	report.error = error.stack ?? String(error);
	process.exitCode = 1;
} finally {
	await browser?.close();
	await new Promise((resolve) => server.close(resolve));
	report.changedInputs = [];
	for (const [path, digest] of trackedInputs)
		if (hash(await readFile(path)) !== digest) report.changedInputs.push(path);
	if (report.changedInputs.length) {
		report.status = 'failed';
		process.exitCode = 1;
	}
	report.inputsUnchanged = !report.changedInputs.length;
	report.inputHashes = Object.fromEntries(trackedInputs);
	report.endedAt = new Date().toISOString();
	await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
		mode: 0o600
	});
	console.log(
		JSON.stringify({
			status: report.status,
			checks: report.checks.length,
			report: join(output, 'report.json'),
			error: report.error
		})
	);
}
