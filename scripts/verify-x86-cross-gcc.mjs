#!/usr/bin/env node
// Real acceptance only: a producer bundle and the pinned producer qualification
// suite are required. Small Wasm fixtures are tested separately in packages/gcc/test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { executionCommand } from './verify-x86-cross-native.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: options, positionals: args } = parseArgs({
	options: { help: { type: 'boolean' }, 'runtime-libraries': { type: 'boolean' } },
	allowPositionals: true
});
if (options.help) {
	console.log(
		'Usage: node scripts/verify-x86-cross-gcc.mjs [--runtime-libraries] MANIFEST PRODUCER_QUALIFICATION_DIR [NEW_OUTPUT_DIR]\nRequires built @wasm-idle/core and @wasm-idle/gcc packages, a real GCC Wasm bundle, the matching wasm-llvm qualification sources, Chromium, and Linux x86-64 for native stdin/stdout checks. Install qemu-user when the execution host lacks a requested SIMD profile.'
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
const suiteCases = await import(pathToFileURL(path.join(suite, 'cases.mjs')));
if (options['runtime-libraries'])
	assert(suiteCases.runtimeLibraryCases?.length, 'Missing producer runtime library cases');
const cases = options['runtime-libraries']
	? [...suiteCases.cases, ...suiteCases.runtimeLibraryCases]
	: suiteCases.cases;
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
	consumerPackage: '@wasm-idle/gcc',
	consumerModule: 'packages/gcc/dist/index.js',
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
	for (const name of [
		report.consumerModule,
		'packages/gcc/dist/worker-entry.js',
		'packages/core/dist/runtime-asset-loader.js',
		'packages/core/dist/runtime-tar.js'
	]) {
		await fs.access(path.join(root, name)).catch(() => {
			throw new Error(
				`Missing ${name}; build @wasm-idle/core and @wasm-idle/gcc before real qualification`
			);
		});
	}
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
					find: /^@wasm-idle\/gcc$/,
					replacement: path.join(root, 'packages/gcc/dist/index.js')
				},
				{
					find: /^@wasm-idle\/core$/,
					replacement: path.join(root, 'packages/core/dist/index.js')
				},
				{
					find: /^@wasm-idle\/core\/runtime-asset-loader$/,
					replacement: path.join(root, 'packages/core/dist/runtime-asset-loader.js')
				},
				{
					find: /^@wasm-idle\/core\/runtime-tar$/,
					replacement: path.join(root, 'packages/core/dist/runtime-tar.js')
				}
			]
		},
		server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [root] } },
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
			const { createCrossGccWorker } = await import(`${origin}/packages/gcc/dist/index.js`);
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
			let checkedFallback = false;
			try {
				for (const fixture of fixtures) {
					if (fixture.precompiledHeader && !compiler.manifest.capabilities?.precompiledHeaders) {
						results.push({ id: fixture.id, skipped: 'bundle has no PCH capability' });
						continue;
					}
					const start = performance.now();
					const deadline = new AbortController();
					const timer = setTimeout(() => deadline.abort(), 600_000);
					let result;
					let precompiled;
					try {
						if (fixture.precompiledHeader) {
							const { cpu, standard, optimization, defines } = fixture.request;
							const header = await compiler.precompileHeader({ cpu, standard, optimization, defines }, { signal: deadline.signal });
							if (header.exitCode !== 0 || !header.bytes) throw new Error(`PCH creation failed: ${header.stderr}`);
							precompiled = { bytes: header.bytes };
						}
						const request = precompiled ? { ...fixture.request, traceIncludes: true } : fixture.request;
						result = await compiler.compile(request, { signal: deadline.signal });
						if (precompiled) {
							const pchMarker = /^! \/pch\/bits\/stdc\+\+\.h\.gch\/cached$/m;
							precompiled.used = pchMarker.test(result.stderr);
							if (!checkedFallback) {
								// An ordinary C++ token before the include prevents a PCH load.
								const fallback = await compiler.compile({
									...request,
									emit: 'assembly',
									code: '#if __has_include(<bits/stdc++.h.gch>) || __has_include(<bits/stdc++.h.gch/cached>)\n#error Private PCH is visible as source\n#endif\nstatic_assert(sizeof(int) > 0);\n#include <bits/stdc++.h>\nint fallback;'
								}, { signal: deadline.signal });
								if (fallback.exitCode !== 0 || !fallback.artifact ||
									pchMarker.test(fallback.stderr) ||
									!/^\. \/sysroot\/.*\/bits\/stdc\+\+\.h$/m.test(fallback.stderr))
									throw new Error('GCC did not trace the expected textual PCH fallback');
								precompiled.textualFallbackVerified = true;
								checkedFallback = true;
							}
						}
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
					const { artifact, ...details } = result;
					let encodedArtifact;
					if (artifact) {
						const { bytes, ...metadata } = artifact;
						// CDP expands numeric arrays per byte. Base64 keeps large ELF
						// results compact without changing their binary contents.
						const chunks = [];
						for (let offset = 0; offset < bytes.length; offset += 32_768)
							chunks.push(
								String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
							);
						encodedArtifact = { ...metadata, bytesBase64: btoa(chunks.join('')) };
					}
					results.push({
						id: fixture.id,
						...details,
						...(precompiled ? { precompiled } : {}),
						elapsedMs: performance.now() - start,
						...(encodedArtifact ? { artifact: encodedArtifact } : {})
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
		if (result.skipped) {
			report.cases.push({ id: fixture.id, skipped: result.skipped });
			continue;
		}
		if (result.artifact) {
			const { bytesBase64, ...metadata } = result.artifact;
			result.artifact = { ...metadata, bytes: Buffer.from(bytesBase64, 'base64') };
		}
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
			const emit = fixture.request.emit ?? 'executable';
			const bytes = result.artifact.bytes;
			const extension = emit === 'assembly' ? 's' : emit === 'object' ? 'o' : 'elf';
			const file = path.join(output, `${fixture.id}.${extension}`);
			await fs.writeFile(file, bytes, { mode: 0o700 });
			entry.artifact = {
				file: path.basename(file),
				bytes: bytes.length,
				sha256: digest(bytes),
				format: result.artifact.format
			};
			if (fixture.precompiledHeader) {
				assert(result.precompiled?.bytes > 0);
				const frontend = result.stages.find((stage) => stage.tool === 'cc1plus');
				assert(frontend?.argv.includes('/pch'), 'SDK did not offer the prepared header to GCC');
				assert.equal(result.precompiled.used, true, 'GCC did not load the prepared header');
				const reference = report.cases.find((other) => other.id === fixture.sameAs);
				assert.equal(entry.artifact.sha256, reference?.artifact?.sha256, 'PCH changed the artifact');
				entry.precompiledHeader = { ...result.precompiled, sameOutputAs: reference.id };
			}
			if (emit === 'object') {
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
			if (emit === 'executable') {
				assert(
					process.platform === 'linux' && process.arch === 'x64',
					'Native stdin/stdout qualification requires Linux x86-64'
				);
				const runner = executionCommand(file, fixture.request.cpu);
				entry.executionMode = runner.mode;
				const execution = spawnSync(runner.command, runner.args, {
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
