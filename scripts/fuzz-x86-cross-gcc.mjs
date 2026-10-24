#!/usr/bin/env node
// Real compiler fuzz replay. No synthetic compiler, browser x86 emulator, or
// WebAssembly execution of generated ELF is used by this script.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const errorText = (error) => String(error?.stack || error);
const usage = `Usage: node scripts/fuzz-x86-cross-gcc.mjs MANIFEST CORPUS NEW_OUTPUT_DIR
  --manifest-sha256 HEX  Required independently pinned manifest digest
  --corpus-sha256 HEX    Independently pinned generated corpus digest
  --max-cases N         Replay the first N cases (default: 32, maximum: 256)
  --max-seconds N       Total campaign budget (default: 600, maximum: 3600)
  --case-seconds N      Initialization + compilation budget per case (default: 90)
Requires a real GCC bundle, a wasm-llvm generated corpus, Chromium, and Linux x86-64.
Only baseline executable cases run in separate native Linux processes. A timeout
or failed selected case exits nonzero and preserves all earlier case evidence.`;

export function parseOptions(args) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			help: { type: 'boolean' },
			'manifest-sha256': { type: 'string' },
			'corpus-sha256': { type: 'string' },
			'max-cases': { type: 'string', default: '32' },
			'max-seconds': { type: 'string', default: '600' },
			'case-seconds': { type: 'string', default: '90' }
		}
	});
	if (values.help) return { help: true };
	assert.equal(positionals.length, 3, usage);
	assert(values['manifest-sha256'], 'Required --manifest-sha256 from the trusted build receipt');
	for (const key of ['manifest-sha256', 'corpus-sha256'])
		if (values[key] !== undefined)
			assert.match(values[key], /^[a-f0-9]{64}$/, `Invalid --${key}`);
	for (const [key, maximum] of [
		['max-cases', 256],
		['max-seconds', 3600],
		['case-seconds', 600]
	]) {
		assert.match(values[key], /^[1-9][0-9]*$/, `Invalid --${key}`);
		values[key] = Number(values[key]);
		assert(values[key] <= maximum, `--${key} exceeds ${maximum}`);
	}
	return {
		manifest: positionals[0],
		corpus: positionals[1],
		output: positionals[2],
		manifestSha256: values['manifest-sha256'],
		corpusSha256: values['corpus-sha256'],
		maxCases: values['max-cases'],
		maxSeconds: values['max-seconds'],
		caseSeconds: values['case-seconds']
	};
}

export function validateCorpus(corpus, manifest, manifestSha256) {
	assert.equal(corpus.schemaVersion, 1, 'Unknown corpus schema');
	assert.equal(corpus.kind, 'gcc-generated-fuzz-corpus', 'Not a generated GCC corpus');
	assert(
		(typeof corpus.seed === 'string' && corpus.seed.length > 0 && corpus.seed.length <= 128) ||
			Number.isSafeInteger(corpus.seed),
		'Corpus requires a reproducible seed'
	);
	assert.equal(
		corpus.compilerIdentity?.manifestSha256,
		manifestSha256,
		'Corpus manifest mismatch'
	);
	assert.equal(
		corpus.compilerIdentity?.sysrootSha256,
		manifest.assets.sysroot.sha256,
		'Corpus sysroot mismatch'
	);
	assert.deepEqual(
		corpus.compilerIdentity.compiler,
		manifest.compiler,
		'Corpus compiler mismatch'
	);
	assert.equal(corpus.compilerIdentity.host, manifest.host, 'Corpus host mismatch');
	assert.equal(corpus.compilerIdentity.target, manifest.target, 'Corpus target mismatch');
	assert.deepEqual(corpus.compilerIdentity.assets, manifest.assets, 'Corpus assets mismatch');
	assert(Array.isArray(corpus.cases) && corpus.cases.length > 0 && corpus.cases.length <= 10000);
	const ids = new Set();
	for (const item of corpus.cases) {
		assert.match(item.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/, 'Unsafe case id');
		assert(!ids.has(item.id), `Duplicate case ${item.id}`);
		ids.add(item.id);
		assert(Number.isSafeInteger(item.index) && item.index >= 0, `${item.id}: invalid index`);
		const request = item.request;
		assert(request && typeof request === 'object');
		assert.deepEqual(Object.keys(request).sort(), [
			'code',
			'cpu',
			'emit',
			'language',
			'optimization',
			'standard'
		]);
		assert(typeof request.code === 'string' && Buffer.byteLength(request.code) <= 1024 * 1024);
		assert(['c', 'cpp'].includes(request.language));
		assert(['x86-64', 'avx2-fma'].includes(request.cpu));
		assert(['assembly', 'object', 'executable'].includes(request.emit));
		assert(['0', '1', '2', '3', 's'].includes(request.optimization));
		assert(
			(request.language === 'c'
				? /^(c|gnu)(99|11|17|2x)$/
				: /^(c|gnu)\+\+(11|14|17|20|23)$/
			).test(request.standard)
		);
		for (const key of ['stdin', 'expectedStdout'])
			assert(typeof item[key] === 'string' && Buffer.byteLength(item[key]) <= 65536);
		if (request.emit === 'executable')
			assert.equal(
				request.cpu,
				'x86-64',
				`${item.id}: native execution requires baseline CPU`
			);
		assert(item.check === undefined || item.check === 'avx2-fma');
		if (item.check)
			assert.notEqual(request.emit, 'executable', 'AVX fuzz cases are never executed');
		if (item.assemblyChecks !== undefined) {
			assert.equal(request.emit, 'assembly');
			assert(Array.isArray(item.assemblyChecks) && item.assemblyChecks.length <= 32);
			for (const check of item.assemblyChecks) {
				assert.match(check.function, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
				for (const key of ['require', 'forbid']) {
					assert(Array.isArray(check[key]) && check[key].length <= 32);
					for (const pattern of check[key]) {
						assert(typeof pattern === 'string' && pattern.length <= 256);
						new RegExp(pattern, 'm');
					}
				}
			}
		}
	}
	return corpus.cases;
}

export function assertOutput(item, artifact) {
	assert.equal(artifact?.compiler, 'gcc');
	assert.equal(artifact.compilerHost, 'wasm32-emscripten');
	assert.equal(artifact.target, 'x86_64-linux-gnu');
	assert.equal(artifact.cpu, item.request.cpu);
	const bytes = Buffer.from(artifact.bytes);
	assert(bytes.length > 0, 'Empty compiler artifact');
	if (item.request.emit === 'assembly') {
		assert.equal(artifact.format, 'assembly');
		const assembly = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		assert.match(assembly, /\.ident\s+"GCC:/, 'Assembly lacks GCC identity');
		assert.match(assembly, /\.text\b/, 'Assembly lacks text section');
		if (item.check === 'avx2-fma') {
			assert.match(assembly, /\bvpaddd\b/);
			assert.match(assembly, /%ymm[0-9]+/);
			assert.match(assembly, /\bvfmadd(?:132|213|231)ps\b/);
		}
		for (const check of item.assemblyChecks || []) {
			const body = new RegExp(
				`^${check.function}:\\s*\\n([\\s\\S]*?)^\\s*\\.size\\s+${check.function}\\s*,`,
				'm'
			).exec(assembly)?.[1];
			assert(body, `Missing complete function ${check.function}`);
			for (const pattern of check.require)
				assert.match(
					body,
					new RegExp(pattern, 'm'),
					`${check.function}: missing ${pattern}`
				);
			for (const pattern of check.forbid)
				assert.doesNotMatch(
					body,
					new RegExp(pattern, 'm'),
					`${check.function}: forbidden ${pattern}`
				);
		}
		return;
	}
	assert.equal(artifact.format, item.request.emit === 'object' ? 'elf-object' : 'elf-executable');
	assert(
		bytes.length >= 64 && bytes.subarray(0, 7).equals(Buffer.from([127, 69, 76, 70, 2, 1, 1])),
		'Expected little-endian ELF64'
	);
	assert.equal(bytes.readUInt16LE(16), item.request.emit === 'object' ? 1 : 2);
	assert.equal(bytes.readUInt16LE(18), 62, 'Expected x86-64 ELF');
	assert.equal(bytes.readUInt16LE(52), 64);
	if (item.request.emit === 'executable') {
		assert.notEqual(bytes.readBigUInt64LE(24), 0n, 'Missing ELF entry point');
		const offset = Number(bytes.readBigUInt64LE(32));
		const count = bytes.readUInt16LE(56);
		assert.equal(bytes.readUInt16LE(54), 56);
		assert(
			Number.isSafeInteger(offset) &&
				offset >= 64 &&
				count > 0 &&
				count * 56 <= bytes.length - offset,
			'Invalid ELF program headers'
		);
		let loadable = false;
		for (let i = 0; i < count; i++) {
			const type = bytes.readUInt32LE(offset + i * 56);
			assert.notEqual(type, 3, 'Static ELF contains PT_INTERP');
			loadable ||= type === 1;
		}
		assert(loadable, 'ELF has no loadable segment');
	}
}

async function writeJson(file, value) {
	await fs.writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await fs.rename(`${file}.tmp`, file);
}

export async function runCampaign(options) {
	const manifestPath = await fs.realpath(options.manifest);
	const corpusPath = await fs.realpath(options.corpus);
	const bundle = path.dirname(manifestPath);
	assert((await fs.stat(manifestPath)).size <= 1024 * 1024, 'Oversized manifest');
	assert((await fs.stat(corpusPath)).size <= 32 * 1024 * 1024, 'Oversized corpus');
	const [manifestBytes, corpusBytes] = await Promise.all([
		fs.readFile(manifestPath),
		fs.readFile(corpusPath)
	]);
	const manifestSha256 = hash(manifestBytes),
		corpusSha256 = hash(corpusBytes);
	if (options.manifestSha256)
		assert.equal(manifestSha256, options.manifestSha256, 'Manifest digest mismatch');
	if (options.corpusSha256)
		assert.equal(corpusSha256, options.corpusSha256, 'Corpus digest mismatch');
	const manifest = JSON.parse(manifestBytes),
		corpus = JSON.parse(corpusBytes);
	assert.equal(manifest.kind, 'gcc-x86_64-linux-gnu');
	const cases = validateCorpus(corpus, manifest, manifestSha256).slice(0, options.maxCases);
	assert(
		process.platform === 'linux' && process.arch === 'x64',
		'Native oracle replay requires Linux x86-64'
	);
	const output = path.resolve(options.output);
	await fs.mkdir(path.dirname(output), { recursive: true });
	await fs.mkdir(output, { mode: 0o700 });
	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-browser-fuzz-'));
	const started = performance.now(),
		deadline = started + options.maxSeconds * 1000;
	const report = {
		schemaVersion: 1,
		kind: 'gcc-real-chromium-fuzz',
		startedAt: new Date().toISOString(),
		seed: corpus.seed,
		generatorVersion: corpus.generatorVersion,
		manifestSha256,
		corpusSha256,
		compiler: manifest.compiler,
		compilerHost: manifest.host,
		target: manifest.target,
		sysrootSha256: manifest.assets.sysroot.sha256,
		nativeHost: `${process.platform}-${process.arch}`,
		corpusCases: corpus.cases.length,
		selectedCases: cases.length,
		omittedCases: corpus.cases.length - cases.length,
		limits: {
			maxSeconds: options.maxSeconds,
			caseSeconds: options.caseSeconds,
			nativeSeconds: 10
		},
		isolation: 'fresh dedicated Worker per case; baseline ELF in separate Linux processes',
		replay: {
			cwd: root,
			argv: [
				'node',
				'scripts/fuzz-x86-cross-gcc.mjs',
				manifestPath,
				corpusPath,
				`${output}-replay`,
				'--manifest-sha256',
				manifestSha256,
				'--corpus-sha256',
				corpusSha256,
				'--max-cases',
				String(cases.length),
				'--max-seconds',
				String(options.maxSeconds),
				'--case-seconds',
				String(options.caseSeconds)
			]
		},
		cases: [],
		success: false
	};
	let browser, server, watchdog;
	let active, caseStarted;
	const remaining = () => {
		const milliseconds = Math.floor(deadline - performance.now());
		assert(milliseconds > 0, 'Campaign time budget exhausted');
		return milliseconds;
	};
	try {
		await fs.writeFile(path.join(output, 'corpus.json'), corpusBytes, { mode: 0o600 });
		await fs.writeFile(path.join(output, 'gcc-toolchain.v1.json'), manifestBytes, {
			mode: 0o600
		});
		const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
			timeout: 5000
		});
		assert.ifError(revision.error);
		assert.equal(revision.status, 0, revision.stderr);
		report.consumerRevision = revision.stdout.trim();
		report.consumerFiles = [];
		for (const name of [
			'scripts/fuzz-x86-cross-gcc.mjs',
			...(await fs.readdir(path.join(root, 'packages/llvm-core/runtime/gcc/src')))
				.filter((name) => name.endsWith('.ts'))
				.map((name) => `packages/llvm-core/runtime/gcc/src/${name}`)
		]) {
			report.consumerFiles.push({
				path: name,
				sha256: hash(await fs.readFile(path.join(root, name)))
			});
		}
		await writeJson(path.join(output, 'report.json'), report);
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
			server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [root] } },
			plugins: [
				{
					name: 'gcc-generated-fuzz-replay',
					configureServer(vite) {
						vite.middlewares.use(async (request, response, next) => {
							const url = new URL(request.url || '/', 'http://localhost');
							if (url.pathname === '/gcc-fuzz') {
								response.setHeader('Content-Type', 'text/html');
								response.end(
									'<!doctype html><title>Actual GCC generated corpus replay</title>'
								);
								return;
							}
							if (!url.pathname.startsWith('/gcc-bundle/')) return next();
							try {
								const file = await fs.realpath(
									path.resolve(
										bundle,
										decodeURIComponent(
											url.pathname.slice('/gcc-bundle/'.length)
										)
									)
								);
								assert(
									file.startsWith(bundle + path.sep) &&
										(await fs.stat(file)).isFile()
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
			timeout: Math.min(30000, remaining()),
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		report.browser = browser.version();
		// Isolated loopback origin; this server has no WAF or deployment dependency.
		const page = await browser.newPage();
		await page.goto(`${origin}/gcc-fuzz`, { timeout: Math.min(30000, remaining()) });
		for (const item of cases) {
			caseStarted = performance.now();
			const directory = path.join(output, item.id);
			await fs.mkdir(directory, { mode: 0o700 });
			const sourceName = item.request.language === 'c' ? 'main.c' : 'main.cpp';
			await Promise.all([
				fs.writeFile(path.join(directory, sourceName), item.request.code, { mode: 0o600 }),
				fs.writeFile(path.join(directory, 'stdin.txt'), item.stdin, { mode: 0o600 }),
				fs.writeFile(path.join(directory, 'expected-stdout.txt'), item.expectedStdout, {
					mode: 0o600
				}),
				writeJson(path.join(directory, 'request.json'), item.request)
			]);
			active = {
				id: item.id,
				index: item.index,
				source: `${item.id}/${sourceName}`,
				sourceSha256: hash(item.request.code),
				request: `${item.id}/request.json`,
				stdin: `${item.id}/stdin.txt`,
				expectedStdout: `${item.id}/expected-stdout.txt`,
				state: 'compiling',
				passed: false
			};
			report.cases.push(active);
			await writeJson(path.join(directory, 'case.json'), active);
			await writeJson(path.join(output, 'report.json'), report);
			const budgetMs = Math.min(options.caseSeconds * 1000, remaining());
			const hardDeadline = new Promise((_, reject) => {
				watchdog = setTimeout(() => {
					void browser.close().catch(() => {});
					reject(new Error(`${item.id}: browser did not respond before its deadline`));
				}, budgetMs + 2000);
			});
			let result;
			try {
				result = await Promise.race([
					page.evaluate(
						async ({ origin, manifestName, manifestSha256, request, budgetMs }) => {
							const started = performance.now();
							const deadline = new AbortController();
							const timer = setTimeout(() => deadline.abort(), budgetMs);
							let compiler;
							try {
								const { createCrossGccWorker } = await import(
									`${origin}/packages/llvm-core/runtime/gcc/src/index.ts`
								);
								compiler = await createCrossGccWorker({
									manifestUrl: `${origin}/gcc-bundle/${manifestName}`,
									manifestSha256,
									signal: deadline.signal
								});
								const initialized = performance.now();
								const compiled = await compiler.compile(request, {
									signal: deadline.signal
								});
								return {
									...compiled,
									identity: compiler.identity,
									initializationMs: initialized - started,
									compileMs: performance.now() - initialized,
									...(compiled.artifact
										? {
												artifact: {
													...compiled.artifact,
													bytes: Array.from(compiled.artifact.bytes)
												}
											}
										: {})
								};
							} finally {
								clearTimeout(timer);
								compiler?.dispose();
							}
						},
						{
							origin,
							manifestName: path.basename(manifestPath),
							manifestSha256,
							request: item.request,
							budgetMs
						}
					),
					hardDeadline
				]);
			} finally {
				clearTimeout(watchdog);
			}
			Object.assign(active, {
				identity: result.identity,
				exitCode: result.exitCode,
				initializationMs: result.initializationMs,
				compileMs: result.compileMs,
				stages: result.stages
			});
			await Promise.all([
				fs.writeFile(path.join(directory, 'compiler.stdout'), result.stdout, {
					mode: 0o600
				}),
				fs.writeFile(path.join(directory, 'compiler.stderr'), result.stderr, {
					mode: 0o600
				})
			]);
			let artifactFile;
			if (result.artifact) {
				const extension = { assembly: 's', object: 'o', executable: 'elf' }[
					item.request.emit
				];
				artifactFile = path.join(directory, `program.${extension}`);
				const bytes = Buffer.from(result.artifact.bytes);
				await fs.writeFile(artifactFile, bytes, { mode: 0o600 });
				active.artifact = {
					file: `${item.id}/program.${extension}`,
					bytes: bytes.length,
					sha256: hash(bytes),
					format: result.artifact.format
				};
			}
			// Save diagnostics/artifact before assertions: a wrong artifact is the most
			// useful reproducer, and a later failure must not erase earlier cases.
			await writeJson(path.join(directory, 'case.json'), active);
			await writeJson(path.join(output, 'report.json'), report);
			assert.equal(result.identity.manifestSha256, manifestSha256);
			assert.equal(result.identity.sysrootSha256, manifest.assets.sysroot.sha256);
			if (result.exitCode !== 0)
				assert(!result.artifact, 'Failed compile returned a stale artifact');
			assert.equal(result.exitCode, 0, result.stderr);
			assertOutput(item, result.artifact);
			if (item.request.emit === 'object') {
				const disassembly = spawnSync('objdump', ['-d', artifactFile], {
					encoding: 'utf8',
					timeout: Math.min(10000, remaining()),
					killSignal: 'SIGKILL',
					maxBuffer: 4 * 1024 * 1024
				});
				await fs.writeFile(path.join(directory, 'objdump.txt'), disassembly.stdout || '', {
					mode: 0o600
				});
				assert.ifError(disassembly.error);
				assert.equal(disassembly.status, 0, disassembly.stderr);
				if (item.check === 'avx2-fma') {
					assert.match(disassembly.stdout, /\bvpaddd\b/);
					assert.match(disassembly.stdout, /\bvfmadd(?:132|213|231)ps\b/);
					assert.match(disassembly.stdout, /%ymm[0-9]+/);
				}
				active.disassembly = 'passed';
			}
			if (item.request.emit === 'executable') {
				// /dev/shm evidence directories can be noexec. Execute a private copy
				// from the OS temporary directory, never the browser or Wasm runtime.
				const executable = path.join(temporary, 'program.elf');
				await fs.copyFile(artifactFile, executable);
				await fs.chmod(executable, 0o700);
				const start = performance.now();
				const execution = spawnSync(executable, [], {
					input: item.stdin,
					encoding: 'utf8',
					timeout: Math.min(10000, remaining()),
					killSignal: 'SIGKILL',
					maxBuffer: 1024 * 1024,
					env: { ...process.env, LC_ALL: 'C' }
				});
				active.nativeRun = {
					status: execution.status,
					signal: execution.signal,
					milliseconds: performance.now() - start,
					...(execution.error ? { error: errorText(execution.error) } : {})
				};
				await Promise.all([
					fs.writeFile(path.join(directory, 'native.stdout'), execution.stdout || '', {
						mode: 0o600
					}),
					fs.writeFile(path.join(directory, 'native.stderr'), execution.stderr || '', {
						mode: 0o600
					})
				]);
				assert.ifError(execution.error);
				assert.equal(execution.status, 0, execution.stderr);
				assert.equal(
					execution.stdout,
					item.expectedStdout,
					`${item.id}: generated oracle mismatch`
				);
			}
			remaining();
			active.state = 'complete';
			active.passed = true;
			active.elapsedMs = performance.now() - caseStarted;
			await writeJson(path.join(directory, 'case.json'), active);
			await writeJson(path.join(output, 'report.json'), report);
			active = undefined;
		}
		report.success = true;
		report.qualification = 'actual-gcc-generated-corpus-chromium-worker-native-linux-io';
	} catch (error) {
		report.error = errorText(error);
		if (active) {
			active.state = 'failed';
			active.error = report.error;
			active.elapsedMs = performance.now() - caseStarted;
			await writeJson(path.join(output, active.id, 'case.json'), active);
		}
	} finally {
		clearTimeout(watchdog);
		await browser?.close().catch((error) => {
			report.cleanupError = errorText(error);
			report.success = false;
		});
		await server?.close().catch((error) => {
			report.cleanupError = errorText(error);
			report.success = false;
		});
		await fs.rm(temporary, { recursive: true, force: true });
		report.elapsedMs = performance.now() - started;
		report.nodeMaxRssKiB = process.resourceUsage().maxRSS;
		report.passedCases = report.cases.filter((item) => item.passed).length;
		await writeJson(path.join(output, 'report.json'), report);
	}
	return {
		success: report.success,
		output,
		passedCases: report.passedCases,
		selectedCases: cases.length,
		...(report.error ? { error: report.error } : {})
	};
}

if (process.argv[1] && (await fs.realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
	try {
		const options = parseOptions(process.argv.slice(2));
		if (options.help) console.log(usage);
		else {
			const result = await runCampaign(options);
			console.log(JSON.stringify(result));
			if (!result.success) process.exitCode = 1;
		}
	} catch (error) {
		console.error(errorText(error));
		process.exitCode = 1;
	}
}
