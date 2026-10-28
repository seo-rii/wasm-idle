#!/usr/bin/env node
// Real compiler/program qualification. A missing compiler, program, receipt or
// requested feature fails the run; it is never replaced with synthetic output.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	digest,
	inspectWasm,
	measureBundle,
	readBundleFile,
	runNodeWasi
} from './gcc-wasi-artifact.mjs';
import { cases as defaultCases, selectCases } from './gcc-wasi-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = {};
for (let index = 2; index < process.argv.length; index++) {
	const key = process.argv[index];
	if (key === '--save-intermediates') {
		assert(!options.saveIntermediates, 'Duplicate --save-intermediates');
		options.saveIntermediates = true;
		continue;
	}
	if (key === '--reference-clang') {
		assert(!options.referenceClang, 'Duplicate --reference-clang');
		options.referenceClang = true;
		continue;
	}
	if (key === '--help') {
		console.log(
			'Usage: node scripts/verify-gcc-wasi.mjs (--manifest BUNDLE.json [--save-intermediates] | --programs DIR --provenance RECEIPT.json [--reference-clang]) [--suite TRUSTED_LOCAL_MODULE.mjs] [--cases ID,...] [--output NEW_DIR]\nDefault cases: ' +
				defaultCases.map((fixture) => fixture.id).join(',')
		);
		process.exit(0);
	}
	assert(
		['--manifest', '--programs', '--provenance', '--suite', '--cases', '--output'].includes(
			key
		),
		`Unknown argument ${key}`
	);
	assert(!Object.hasOwn(options, key.slice(2)), `Duplicate argument ${key}`);
	const value = process.argv[++index];
	assert(value && !value.startsWith('--'), `Missing value for ${key}`);
	options[key.slice(2)] = value;
}
assert(
	Boolean(options.manifest) !== Boolean(options.programs),
	'Select exactly one of --manifest or --programs'
);
assert(
	!options.programs || options.provenance,
	'--programs requires a source/build --provenance receipt'
);
assert(
	!options.referenceClang || options.programs,
	'--reference-clang is only for precompiled Clang reference artifacts'
);
assert(!options.saveIntermediates || options.manifest, '--save-intermediates requires --manifest');
// A suite is executable local test code, just like this harness. Its complete
// fixture values and file identity are recorded in the qualification receipt.
const suitePath = options.suite ? await fs.realpath(options.suite) : undefined;
const suite = suitePath ? await import(pathToFileURL(suitePath)) : undefined;
assert(!suite || Array.isArray(suite.cases), 'Suite must export a cases array');
assert(
	!suite?.disabledCases || Array.isArray(suite.disabledCases),
	'disabledCases must be an array'
);
const cases = suite ? [...suite.cases, ...(suite.disabledCases || [])] : defaultCases;
assert(Array.isArray(cases) && cases.length, 'Suite must export a nonempty cases array');
assert.equal(
	new Set(cases.map((fixture) => fixture.id)).size,
	cases.length,
	'Duplicate fixture id'
);
for (const fixture of cases) {
	assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fixture.id), 'Unsafe fixture id');
	assert(fixture.request && typeof fixture.request.code === 'string', 'Missing fixture source');
	assert(
		typeof fixture.stdin === 'string' && typeof fixture.stdout === 'string',
		'Missing fixture IO'
	);
}
const fixtures = selectCases(options.cases, cases);
const output = path.resolve(options.output || `out/gcc-wasi-qualification-${Date.now()}`);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-wasi-qualification-'));
const report = {
	schemaVersion: 1,
	kind: options.referenceClang
		? 'clang-wasi-reference-only-not-gcc-qualification'
		: options.manifest
			? 'gcc-wasi-real-chromium-compiler-qualification'
			: 'gcc-wasi-native-produced-program-qualification',
	target: 'wasm32-wasi',
	execution: ['node-wasi-preview1', 'chromium-worker-wasi-preview1'],
	selectedCases: fixtures.map((fixture) => fixture.id),
	unselectedCases: cases
		.filter((fixture) => !fixtures.includes(fixture))
		.map((fixture) => ({ id: fixture.id, status: 'not-run' })),
	fixtures: fixtures.map((fixture) => ({
		id: fixture.id,
		sha256: digest(JSON.stringify(fixture)),
		features: fixture.features
	})),
	cases: fixtures.map((fixture) => ({
		id: fixture.id,
		features: fixture.features,
		status: 'pending',
		success: false
	})),
	success: false
};
report.harness = [];
if (suitePath) {
	const bytes = await fs.readFile(suitePath);
	report.suite = { path: suitePath, bytes: bytes.length, sha256: digest(bytes) };
}
for (const name of [
	'verify-gcc-wasi.mjs',
	'gcc-wasi-fixtures.mjs',
	'gcc-wasi-artifact.mjs',
	'gcc-wasi-node-runner.mjs',
	'gcc-wasi-execution-worker.mjs'
]) {
	const bytes = await fs.readFile(new URL(name, import.meta.url));
	report.harness.push({ path: `scripts/${name}`, bytes: bytes.length, sha256: digest(bytes) });
}
let server;
let browser;
const serverTransfers = [];
try {
	const [{ createServer }, { chromium }, { resolveChromiumExecutable }] = await Promise.all([
		import('vite'),
		import('playwright-core'),
		import('./rust-browser-probe-lib.mjs')
	]);
	const inputDirectories = ['node_modules/@bjorn3/browser_wasi_shim'];
	if (options.manifest) inputDirectories.push('packages/gcc/dist', 'packages/core/dist');
	report.runtimeInputs = [];
	for (const directory of inputDirectories) {
		const files = await fs.readdir(path.join(root, directory), { recursive: true });
		for (const name of files
			.sort()
			.filter((name) => name.endsWith('.js') || name === 'package.json')) {
			const file = path.join(directory, name);
			const bytes = await fs.readFile(path.join(root, file));
			report.runtimeInputs.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
		}
	}
	let bundle;
	let manifest;
	let manifestName;
	let provenance;
	if (options.manifest) {
		const manifestPath = await fs.realpath(options.manifest);
		bundle = path.dirname(manifestPath);
		manifestName = path.basename(manifestPath);
		const manifestBytes = await fs.readFile(manifestPath);
		manifest = JSON.parse(manifestBytes);
		assert.equal(manifest.compiler.family, 'gcc');
		assert.equal(manifest.target, 'wasm32-wasi');
		assert.equal(manifest.host, 'wasm32-emscripten');
		report.manifestSha256 = digest(manifestBytes);
		report.compiler = manifest.compiler;
		report.provenance = manifest.provenance;
		report.toolchain = {
			compiler: manifest.compiler,
			assembler: manifest.assembler,
			linker: manifest.linker,
			sysroot: manifest.sysroot,
			abi: manifest.abi,
			capabilities: manifest.capabilities
		};
		report.compilerHost = manifest.host;
		await fs.writeFile(path.join(output, 'manifest.json'), manifestBytes);
		report.initialAssets = await measureBundle(bundle, manifestBytes, manifest);
		for (const file of ['packages/gcc/dist/index.js', 'packages/core/dist/index.js'])
			await fs.access(path.join(root, file));
	} else {
		bundle = await fs.realpath(options.programs);
		const receiptBytes = await fs.readFile(options.provenance);
		provenance = JSON.parse(receiptBytes);
		assert.equal(provenance.compiler.family, options.referenceClang ? 'clang' : 'gcc');
		assert.equal(provenance.target, 'wasm32-wasi');
		if (!options.referenceClang)
			assert(
				provenance.compiler.commit && /^[a-f0-9]{40}$/.test(provenance.compiler.commit),
				'Native receipt must pin the GCC source commit'
			);
		else
			assert.equal(
				provenance.referenceOnly,
				true,
				'Clang reference receipt must declare referenceOnly'
			);
		report.provenance = provenance;
		report.provenanceSha256 = digest(receiptBytes);
		report.compiler = provenance.compiler;
		report.compilerHost = provenance.host || 'native';
		await fs.writeFile(path.join(output, 'native-provenance.json'), receiptBytes);
	}
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
				name: 'gcc-wasi-real-qualification',
				configureServer(vite) {
					vite.middlewares.use(async (request, response, next) => {
						const url = new URL(request.url || '/', 'http://localhost');
						// Chromium may report zero bytes for a Worker entry script. Count
						// actual server writes too, including the compressed stream chunks.
						let responseBodyBytes = 0;
						const count = (chunk, encoding) => {
							if (typeof chunk === 'string')
								responseBodyBytes += Buffer.byteLength(
									chunk,
									typeof encoding === 'string' ? encoding : 'utf8'
								);
							else if (chunk) responseBodyBytes += chunk.byteLength;
						};
						const write = response.write.bind(response);
						const end = response.end.bind(response);
						response.write = (chunk, ...args) => {
							count(chunk, args[0]);
							return write(chunk, ...args);
						};
						response.end = (chunk, ...args) => {
							count(chunk, args[0]);
							return end(chunk, ...args);
						};
						response.once('finish', () =>
							serverTransfers.push({
								url: url.pathname + url.search,
								status: response.statusCode,
								encoding: response.getHeader('Content-Encoding') || 'identity',
								responseBodyBytes
							})
						);
						if (url.pathname === '/gcc-wasi-probe') {
							response.setHeader('Content-Type', 'text/html');
							response.end(
								'<!doctype html><title>Actual GCC WASI qualification</title>'
							);
							return;
						}
						if (!options.manifest || !url.pathname.startsWith('/gcc-wasi-bundle/'))
							return next();
						try {
							const file = await fs.realpath(
								path.resolve(
									bundle,
									decodeURIComponent(
										url.pathname.slice('/gcc-wasi-bundle/'.length)
									)
								)
							);
							assert(
								file.startsWith(bundle + path.sep) && (await fs.stat(file)).isFile()
							);
							response.setHeader(
								'Content-Type',
								file.endsWith('.wasm')
									? 'application/wasm'
									: file.endsWith('.mjs')
										? 'text/javascript'
										: 'application/octet-stream'
							);
							response.setHeader('Cache-Control', 'no-store');
							const stream = createReadStream(file);
							stream.on('error', () => response.destroy());
							if (/\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
								response.setHeader('Content-Encoding', 'gzip');
								stream
									.pipe(createGzip({ level: 9 }))
									.on('error', () => response.destroy())
									.pipe(response);
							} else stream.pipe(response);
						} catch {
							response.statusCode = 404;
							response.end('Qualification asset not found');
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
	// This server is private loopback with no WAF or application credentials.
	const page = await browser.newPage();
	const transfers = [];
	const pendingTransfers = [];
	page.context().on('requestfinished', (request) => {
		if (!request.url().startsWith(origin + '/')) return;
		pendingTransfers.push(
			(async () => {
				const [response, sizes] = await Promise.all([request.response(), request.sizes()]);
				const headers = response ? await response.allHeaders() : {};
				transfers.push({
					url: request.url().slice(origin.length),
					status: response?.status(),
					encoding: headers['content-encoding'] || 'identity',
					...sizes
				});
			})()
		);
	});
	await page.goto(`${origin}/gcc-wasi-probe`);
	if (manifest) {
		report.identity = await page.evaluate(
			async ({ origin, manifestName, manifestSha256 }) => {
				const { createGccWorker } = await import(`${origin}/packages/gcc/dist/index.js`);
				globalThis.gccWasiQualification = await createGccWorker({
					target: 'wasm32-wasi',
					manifestUrl: `${origin}/gcc-wasi-bundle/${manifestName}`,
					manifestSha256,
					signal: AbortSignal.timeout(300_000)
				});
				return globalThis.gccWasiQualification.identity;
			},
			{ origin, manifestName, manifestSha256: report.manifestSha256 }
		);
		assert.equal(report.identity.compiler, 'gcc');
		assert.equal(report.identity.target, 'wasm32-wasi');
		assert.equal(report.identity.manifestSha256, report.manifestSha256);
		assert.equal(report.identity.compilerCommit, manifest.compiler.commit);
		await Promise.all(pendingTransfers);
		report.initializationTransfers = [...transfers];
		report.initializationServerTransfers = [...serverTransfers];
		const object = await page.evaluate(
			async (request) => {
				const result = await globalThis.gccWasiQualification.compile(
					{ ...request, emit: 'object' },
					{ signal: AbortSignal.timeout(600_000) }
				);
				const { artifact, ...compilation } = result;
				return { compilation, ...(artifact ? { bytes: [...artifact.bytes] } : {}) };
			},
			{ ...fixtures[0].request, sources: undefined }
		);
		assert.equal(
			object.compilation.exitCode,
			0,
			`GCC object milestone failed: ${object.compilation.stderr}`
		);
		const objectBytes = Uint8Array.from(object.bytes || []);
		report.objectMilestone = {
			artifact: inspectWasm(objectBytes, { object: true }),
			compilation: object.compilation
		};
		await fs.writeFile(path.join(output, 'object-milestone.o'), objectBytes);
	}
	for (const fixture of fixtures) {
		const entry = report.cases.find((candidate) => candidate.id === fixture.id);
		entry.status = 'running';
		let bytes;
		let execution;
		if (manifest) {
			const actual = await page.evaluate(
				async ({ fixture, saveIntermediates }) => {
					const compiler = globalThis.gccWasiQualification;
					const started = performance.now();
					const intermediates = [];
					if (saveIntermediates) {
						for (const emit of ['assembly', 'object']) {
							const capture = await compiler.compile(
								{ ...fixture.request, sources: undefined, emit },
								{ signal: AbortSignal.timeout(600_000) }
							);
							const { artifact, ...compilation } = capture;
							const chunks = [];
							if (artifact)
								for (
									let offset = 0;
									offset < artifact.bytes.length;
									offset += 32768
								)
									chunks.push(
										String.fromCharCode(
											...artifact.bytes.subarray(offset, offset + 32768)
										)
									);
							intermediates.push({
								emit,
								compilation,
								base64: artifact ? btoa(chunks.join('')) : null
							});
						}
					}
					const result = await compiler.compile(fixture.request, {
						signal: AbortSignal.timeout(600_000)
					});
					const { artifact, ...compilation } = result;
					if (!artifact) return { compilation, intermediates };
					const { bytes, ...metadata } = artifact;
					const chunks = [];
					for (let offset = 0; offset < bytes.length; offset += 32768)
						chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
					let execution;
					try {
						execution = await compiler.run(artifact, {
							stdin: fixture.stdin,
							signal: AbortSignal.timeout(30_000)
						});
					} catch (error) {
						// Preserve the compiler stages and executable even if the guest
						// traps; Node execution can then distinguish codegen from host bugs.
						execution = { error: String(error?.stack || error) };
					}
					return {
						compilation,
						intermediates,
						artifact: { ...metadata, base64: btoa(chunks.join('')) },
						execution,
						elapsedMs: performance.now() - started
					};
				},
				{ fixture, saveIntermediates: Boolean(options.saveIntermediates) }
			);
			entry.compilation = actual.compilation;
			entry.elapsedMs = actual.elapsedMs;
			if (options.saveIntermediates) {
				entry.intermediates = [];
				for (const capture of actual.intermediates) {
					const { base64, ...metadata } = capture;
					const captured = base64 === null ? undefined : Buffer.from(base64, 'base64');
					entry.intermediates.push({
						...metadata,
						translationUnit: 'main',
						...(captured ? { bytes: captured.length, sha256: digest(captured) } : {})
					});
					if (captured)
						await fs.writeFile(
							path.join(
								output,
								`${fixture.id}.${capture.emit === 'assembly' ? 'wat' : 'o'}`
							),
							captured
						);
					assert.equal(
						capture.compilation.exitCode,
						0,
						`${fixture.id}: ${capture.emit} capture failed: ${capture.compilation.stderr}`
					);
					assert(captured, `${fixture.id}: ${capture.emit} capture returned no artifact`);
				}
			}
			assert.equal(
				actual.compilation.exitCode,
				0,
				`${fixture.id}: GCC failed: ${actual.compilation.stderr}`
			);
			assert(actual.artifact, `${fixture.id}: GCC returned no program`);
			assert.equal(actual.artifact.compiler, 'gcc');
			assert.equal(actual.artifact.target, 'wasm32-wasi');
			assert.equal(actual.artifact.format, 'wasm-executable');
			assert(
				actual.compilation.stages.some(
					(stage) =>
						stage.tool === (fixture.request.language === 'cpp' ? 'cc1plus' : 'cc1')
				),
				'Missing actual GCC stage'
			);
			assert(
				actual.compilation.stages.some((stage) => stage.tool === 'as'),
				'Missing Wasm assembler stage'
			);
			assert(
				actual.compilation.stages.some((stage) => stage.tool === 'ld'),
				'Missing Wasm linker stage'
			);
			assert(
				actual.compilation.stages
					.filter((stage) => /^cc1/.test(stage.tool))
					.every((stage) =>
						stage.argv.includes(`-O${fixture.request.optimization || '2'}`)
					),
				`${fixture.id}: requested optimization was not passed to every GCC frontend invocation`
			);
			for (const define of fixture.request.defines || [])
				assert(
					actual.compilation.stages
						.filter((stage) => /^cc1/.test(stage.tool))
						.every((stage) => stage.argv.includes(`-D${define}`)),
					`Macro ${define} was not passed to every GCC frontend invocation`
				);
			if (manifest.capabilities.simd) {
				const flag = fixture.request.simd ? '-msimd128' : '-mno-simd128';
				assert(
					actual.compilation.stages
						.filter((stage) => /^cc1/.test(stage.tool))
						.every((stage) => stage.argv.includes(flag)),
					`${fixture.id}: ${flag} was not passed to every GCC frontend invocation`
				);
			}
			entry.sdkInspection = actual.artifact.wasm;
			if (fixture.request.simd !== undefined)
				assert.equal(
					actual.artifact.wasm?.features?.simd128,
					fixture.request.simd,
					`${fixture.id}: SIMD instructions/types do not match the requested fixture profile`
				);
			bytes = Buffer.from(actual.artifact.base64, 'base64');
			execution = actual.execution;
		} else {
			const receipt = provenance.programs?.[fixture.id];
			assert(receipt, `Native receipt does not bind ${fixture.id}`);
			bytes = await readBundleFile(bundle, receipt);
			inspectWasm(bytes);
			if (receipt.object) {
				const objectBytes = await readBundleFile(bundle, receipt.object);
				entry.object = inspectWasm(objectBytes, { object: true });
				await fs.writeFile(path.join(output, `${fixture.id}.o`), objectBytes);
			}
			execution = await page.evaluate(
				async ({ origin, base64, stdin }) => {
					const bytes = Uint8Array.from(atob(base64), (character) =>
						character.charCodeAt(0)
					);
					const worker = new Worker(`${origin}/scripts/gcc-wasi-execution-worker.mjs`, {
						type: 'module'
					});
					try {
						return await new Promise((resolve, reject) => {
							const timer = setTimeout(
								() => reject(new Error('WASI program exceeded 30 seconds')),
								30_000
							);
							worker.onmessage = ({ data }) => {
								clearTimeout(timer);
								data.error ? reject(new Error(data.error)) : resolve(data);
							};
							worker.onerror = (event) => {
								clearTimeout(timer);
								reject(new Error(event.message));
							};
							worker.postMessage({ bytes, stdin }, [bytes.buffer]);
						});
					} finally {
						worker.terminate();
					}
				},
				{ origin, base64: bytes.toString('base64'), stdin: fixture.stdin }
			);
			assert.equal(execution.worker, true, 'Program did not execute in a Chromium Worker');
		}
		entry.artifact = inspectWasm(bytes);
		const file = path.join(output, `${fixture.id}.wasm`);
		await fs.writeFile(file, bytes);
		entry.chromiumWorker = execution;
		entry.node = runNodeWasi(file, fixture);
		assert(!execution.error, `${fixture.id}: Chromium Worker failed: ${execution.error}`);
		assert.equal(execution.exitCode, 0, `${fixture.id}: Chromium Worker exit status`);
		assert.equal(execution.stdout, fixture.stdout, `${fixture.id}: Chromium Worker stdout`);
		assert.equal(execution.stderr, '', `${fixture.id}: Chromium Worker stderr`);
		entry.success = true;
		entry.status = 'passed';
		await fs.writeFile(
			path.join(output, 'qualification.json'),
			JSON.stringify(report, null, 2) + '\n'
		);
		console.log(JSON.stringify({ case: fixture.id, passed: true, bytes: bytes.length }));
	}
	if (manifest) {
		report.unsupportedFeatures = await page.evaluate(
			async ({ request, simdSupported }) => {
				const compiler = globalThis.gccWasiQualification;
				const results = [];
				for (const feature of [
					'exceptions',
					'rtti',
					'threads',
					'dynamicLinking',
					...(simdSupported ? [] : ['simd']),
					'cpu'
				]) {
					let diagnostic = '';
					try {
						await compiler.compile({
							...request,
							[feature]: feature === 'cpu' ? 'avx2-fma' : true
						});
					} catch (error) {
						diagnostic = String(error?.message || error);
					}
					results.push({ feature, rejected: diagnostic.length > 0, diagnostic });
				}
				const pragma = await compiler.compile({
					...request,
					emit: 'assembly',
					code: '#pragma GCC target("avx2")\nint add(int n) { return n + 1; }\n'
				});
				results.push({
					feature: 'x86-target-pragma',
					rejected: pragma.exitCode !== 0 && !pragma.artifact,
					diagnostic: pragma.stderr
				});
				return results;
			},
			{ request: defaultCases[0].request, simdSupported: manifest.capabilities.simd }
		);
		assert(
			report.unsupportedFeatures.every((feature) => feature.rejected && feature.diagnostic),
			'Unsupported feature was silently accepted'
		);
		await page.evaluate(() => globalThis.gccWasiQualification.dispose());
	}
	await Promise.all(pendingTransfers);
	report.network = {
		note: 'Server counters include every SDK module and compressed compiler asset. Chromium sizes are retained separately because Worker entry scripts may report zero browser-side body size.',
		transfers,
		serverTransfers,
		responseBodyBytes: serverTransfers.reduce(
			(total, entry) => total + entry.responseBodyBytes,
			0
		),
		chromiumResponseBodyBytes: transfers.reduce(
			(total, entry) => total + entry.responseBodySize,
			0
		),
		responseHeaderBytes: transfers.reduce(
			(total, entry) => total + entry.responseHeadersSize,
			0
		)
	};
	if (manifest) {
		const fetched = new Set(
			serverTransfers
				.filter((entry) => entry.status === 200)
				.map((entry) => entry.url.split('?')[0])
		);
		report.network.missingManifestAssets = Object.values(manifest.assets)
			.filter((asset) => !fetched.has(`/gcc-wasi-bundle/${asset.path}`))
			.map((asset) => asset.path);
		assert.equal(
			report.network.missingManifestAssets.length,
			0,
			'Network measurement did not observe every compiler asset'
		);
		const initialization = report.initializationServerTransfers;
		const sdkTransfers = initialization.filter(
			(entry) => !entry.url.startsWith('/gcc-wasi-bundle/')
		);
		assert(
			sdkTransfers.every((entry) => entry.encoding === 'identity'),
			'Unexpected SDK module transfer encoding'
		);
		report.initialAssets.sdkUncompressedBytes = sdkTransfers.reduce(
			(total, entry) => total + entry.responseBodyBytes,
			0
		);
		report.initialAssets.totalUncompressedBytes =
			report.initialAssets.uncompressedBytes + report.initialAssets.sdkUncompressedBytes;
		report.initialAssets.actualInitialResponseBodyBytes = initialization.reduce(
			(total, entry) => total + entry.responseBodyBytes,
			0
		);
		report.initialAssets.delivery =
			'Bundle gzip level 9; SDK modules uncompressed from the isolated Vite qualification server.';
	}
	for (const input of [...report.harness, ...report.runtimeInputs])
		assert.equal(
			digest(await fs.readFile(path.join(root, input.path))),
			input.sha256,
			`${input.path}: qualification input changed while running`
		);
	if (report.suite)
		assert.equal(
			digest(await fs.readFile(report.suite.path)),
			report.suite.sha256,
			'Suite changed while qualification was running'
		);
	report.success = true;
} catch (error) {
	report.error = String(error?.stack || error);
	for (const entry of report.cases)
		if (entry.status === 'running') {
			entry.status = /does not support|cannot link|unsupported/i.test(report.error)
				? 'unsupported'
				: 'failed';
			entry.error = report.error;
		}
	process.exitCode = 1;
} finally {
	await browser?.close();
	await server?.close();
	await fs.rm(temporary, { recursive: true, force: true });
	report.nodeMaxRssKiB = process.resourceUsage().maxRSS;
	await fs.writeFile(
		path.join(output, 'qualification.json'),
		JSON.stringify(report, null, 2) + '\n'
	);
	console.log(
		JSON.stringify({
			success: report.success,
			output,
			...(report.error ? { error: report.error } : {})
		})
	);
}
