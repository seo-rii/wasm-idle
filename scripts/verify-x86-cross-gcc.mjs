#!/usr/bin/env node
// Real acceptance only: a producer bundle and the pinned producer qualification
// suite are required. Small Wasm fixtures are tested separately in llvm-core.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
	console.log(
		'Usage: node scripts/verify-x86-cross-gcc.mjs MANIFEST PRODUCER_QUALIFICATION_DIR [NEW_OUTPUT_DIR]\nRequires a real GCC Wasm bundle, the matching wasm-llvm qualification sources, Chromium, and Linux x86-64 for native stdin/stdout checks.'
	);
	process.exit(0);
}
assert(
	args.length === 2 || args.length === 3,
	'Expected manifest and producer qualification directory; see --help'
);
const manifestPath = await fs.realpath(args[0]),
	bundle = path.dirname(manifestPath);
const suite = await fs.realpath(args[1]);
const manifestBytes = await fs.readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.kind, 'gcc-x86_64-linux-gnu');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestSha256 = digest(manifestBytes);
const { cases } = await import(pathToFileURL(path.join(suite, 'cases.mjs')));
const { assertCaseResult } = await import(pathToFileURL(path.join(suite, 'assertions.mjs')));
const fixtures = [];
const suiteFiles = [
	'cases.mjs',
	'assertions.mjs',
	...new Set(cases.map((test) => `fixtures/${test.fixture}`))
];
const suiteIdentity = [];
for (const file of suiteFiles) {
	const bytes = await fs.readFile(path.join(suite, file));
	suiteIdentity.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
}
for (const test of cases)
	fixtures.push({
		...test,
		request: {
			...test.request,
			code: await fs.readFile(path.join(suite, 'fixtures', test.fixture), 'utf8')
		}
	});
const output = path.resolve(args[2] || `out/gcc-browser-qualification-${Date.now()}`);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-browser-qualification-'));
const report = {
	schemaVersion: 1,
	kind: 'gcc-real-chromium-qualification',
	manifestSha256,
	compiler: manifest.compiler,
	compilerHost: manifest.host,
	target: manifest.target,
	nativeHost: `${process.platform}-${process.arch}`,
	suite: suiteIdentity,
	cases: [],
	success: false
};
let browser, server;
try {
	const [{ createServer }, { chromium }, { resolveChromiumExecutable }] = await Promise.all([
		import('vite'),
		import('playwright-core'),
		import('./rust-browser-probe-lib.mjs')
	]);
	server = await createServer({
		configFile: false,
		root,
		cacheDir: path.join(temporary, 'vite'),
		logLevel: 'error',
		optimizeDeps: { noDiscovery: true },
		resolve: {
			alias: [
				{
					find: /^@wasm-idle\/core$/,
					replacement: path.join(root, 'packages/core/src/index.ts')
				}
			]
		},
		server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
		plugins: [
			{
				name: 'gcc-real-qualification',
				configureServer(vite) {
					vite.middlewares.use(async (request, response, next) => {
						const url = new URL(request.url || '/', 'http://localhost');
						if (url.pathname === '/gcc-probe') {
							response.setHeader('Content-Type', 'text/html');
							response.end('<!doctype html><title>GCC Worker qualification</title>');
							return;
						}
						if (!url.pathname.startsWith('/gcc-bundle/')) return next();
						try {
							const file = await fs.realpath(
								path.resolve(
									bundle,
									decodeURIComponent(url.pathname.slice('/gcc-bundle/'.length))
								)
							);
							assert(
								file.startsWith(bundle + path.sep) &&
									(await fs.stat(file)).isFile(),
								'Invalid asset'
							);
							response.setHeader(
								'Content-Type',
								file.endsWith('.wasm')
									? 'application/wasm'
									: file.endsWith('.mjs')
										? 'text/javascript'
										: 'application/octet-stream'
							);
							createReadStream(file)
								.on('error', () => response.destroy())
								.pipe(response);
						} catch {
							response.statusCode = 404;
							response.end('Asset not found');
						}
					});
				}
			}
		]
	});
	await server.listen();
	const address = server.httpServer.address();
	assert(address && typeof address === 'object');
	const origin = `http://127.0.0.1:${address.port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		)
	});
	report.browser = await browser.version();
	// This isolated loopback server has no WAF. It never uses a protected dev
	// origin or production compiler assets.
	const page = await browser.newPage();
	await page.goto(`${origin}/gcc-probe`);
	const actual = await page.evaluate(
		async ({ manifestUrl, manifestSha256, fixtures, origin }) => {
			const { createCrossGccWorker } = await import(
				`${origin}/packages/llvm-core/runtime/gcc/src/index.ts`
			);
			const initialization = new AbortController();
			const initializationTimer = setTimeout(() => initialization.abort(), 300_000);
			let compiler;
			try {
				compiler = await createCrossGccWorker({
					manifestUrl,
					manifestSha256,
					signal: initialization.signal
				});
			} finally {
				clearTimeout(initializationTimer);
			}
			const results = [];
			try {
				for (const fixture of fixtures) {
					const start = performance.now();
					const deadline = new AbortController();
					const timer = setTimeout(() => deadline.abort(), 600_000);
					let result;
					try {
						result = await compiler.compile(fixture.request, {
							signal: deadline.signal
						});
					} catch (error) {
						// Return completed cases before reporting this host failure. Throwing
						// out of page.evaluate would discard their artifacts and prevent
						// the native stdin/stdout checks from running on valid earlier ELF.
						return {
							results,
							identity: compiler.identity,
							cancellation: 'not-run-after-compilation-error',
							failure: {
								kind: 'compilation-host-error',
								id: fixture.id,
								elapsedMs: performance.now() - start,
								error: String(error?.stack || error)
							}
						};
					} finally {
						clearTimeout(timer);
					}
					results.push({
						id: fixture.id,
						...result,
						elapsedMs: performance.now() - start,
						...(result.artifact
							? {
									artifact: {
										...result.artifact,
										bytes: Array.from(result.artifact.bytes)
									}
								}
							: {})
					});
				}
				// A real synchronous compiler main() cannot be interrupted by an event
				// on its own Worker. The public API must terminate the Worker instead.
				const abort = new AbortController();
				const pending = compiler.compile(
					fixtures.find((test) => !test.expectFailure).request,
					{ signal: abort.signal }
				);
				setTimeout(() => abort.abort(), 1);
				let cancelled = false;
				try {
					await pending;
				} catch (error) {
					cancelled = error?.name === 'AbortError';
				}
				if (!cancelled)
					throw new Error(
						'Worker cancellation did not reject compilation with AbortError'
					);
				let disposed = false;
				try {
					await compiler.compile(fixtures[0].request);
				} catch {
					disposed = true;
				}
				if (!disposed)
					throw new Error('Terminated GCC Worker accepted another compilation');
				return { results, identity: compiler.identity, cancellation: 'worker-terminated' };
			} finally {
				compiler.dispose();
			}
		},
		{
			manifestUrl: `${origin}/gcc-bundle/${path.basename(manifestPath)}`,
			manifestSha256,
			fixtures,
			origin
		}
	);
	assert.equal(actual.identity.manifestSha256, manifestSha256);
	assert.equal(actual.identity.sysrootSha256, manifest.assets.sysroot.sha256);
	report.identity = actual.identity;
	report.cancellation = actual.cancellation;
	if (actual.failure) report.failure = actual.failure;
	for (const [index, result] of actual.results.entries()) {
		const fixture = fixtures[index];
		assert.equal(result.id, fixture.id);
		assertCaseResult(fixture, result);
		await fs.writeFile(path.join(output, `${fixture.id}.stdout`), result.stdout);
		await fs.writeFile(path.join(output, `${fixture.id}.stderr`), result.stderr);
		const entry = {
			id: fixture.id,
			exitCode: result.exitCode,
			elapsedMs: result.elapsedMs,
			stages: result.stages,
			expectedFailure: Boolean(fixture.expectFailure),
			nativeRun: 'not-applicable',
			disassembly: 'not-applicable'
		};
		if (result.artifact) {
			const bytes = Buffer.from(result.artifact.bytes);
			const extension =
				fixture.request.emit === 'assembly'
					? 's'
					: fixture.request.emit === 'object'
						? 'o'
						: 'elf';
			const file = path.join(output, `${fixture.id}.${extension}`);
			await fs.writeFile(file, bytes, { mode: 0o700 });
			entry.artifact = {
				file: path.basename(file),
				bytes: bytes.length,
				sha256: digest(bytes),
				format: result.artifact.format
			};
			if (fixture.request.emit === 'object') {
				assert(
					process.platform === 'linux' && process.arch === 'x64',
					'Real object qualification requires native Linux x86-64 objdump'
				);
				const disassembly = spawnSync('objdump', ['-d', file], {
					encoding: 'utf8',
					timeout: 15_000,
					maxBuffer: 16 * 1024 * 1024
				});
				assert.ifError(disassembly.error);
				assert.equal(disassembly.status, 0, disassembly.stderr);
				await fs.writeFile(path.join(output, `${fixture.id}.objdump`), disassembly.stdout);
				if (fixture.check === 'pragma-object') {
					assert.match(disassembly.stdout, /\bvpaddd\b/);
					assert.match(disassembly.stdout, /\bvfmadd(?:132|213|231)ps\b/);
				}
				entry.disassembly = 'passed';
			}
			if (fixture.request.emit === 'executable') {
				assert(
					process.platform === 'linux' && process.arch === 'x64',
					'Native stdin/stdout qualification requires Linux x86-64'
				);
				assert.equal(
					fixture.request.cpu,
					'x86-64',
					'Only baseline fixtures are executed natively'
				);
				const execution = spawnSync(file, [], {
					input: fixture.stdin,
					encoding: 'utf8',
					timeout: 15_000,
					maxBuffer: 1024 * 1024
				});
				assert.ifError(execution.error);
				assert.equal(execution.status, 0, execution.stderr);
				assert.equal(execution.stdout, fixture.stdout);
				entry.nativeRun = 'passed';
				entry.nativeStdout = execution.stdout;
			}
		}
		entry.passed = true;
		report.cases.push(entry);
	}
	if (actual.failure) {
		const failedFixture = fixtures[actual.results.length];
		assert.equal(actual.failure.id, failedFixture.id);
		await fs.writeFile(
			path.join(output, `${failedFixture.id}.host-error.json`),
			`${JSON.stringify(actual.failure, null, 2)}\n`
		);
		report.cases.push({
			...actual.failure,
			passed: false,
			expectedFailure: Boolean(failedFixture.expectFailure),
			nativeRun: 'not-run',
			disassembly: 'not-run'
		});
		throw new Error(`${actual.failure.id}: ${actual.failure.error}`);
	}
	report.success = true;
	report.qualification = 'actual-gcc-chromium-worker-and-native-linux-io';
} catch (error) {
	report.error = String(error?.stack || error);
	process.exitCode = 1;
} finally {
	await browser?.close();
	await server?.close();
	await fs.rm(temporary, { recursive: true, force: true });
	report.nodeMaxRssKiB = process.resourceUsage().maxRSS;
	await fs.writeFile(
		path.join(output, 'qualification.json'),
		`${JSON.stringify(report, null, 2)}\n`
	);
	console.log(
		JSON.stringify({
			success: report.success,
			output,
			...(report.error ? { error: report.error } : {})
		})
	);
}
