import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
	CHEERPJ_LOADER,
	JAVA_PROBE_FIXTURES,
	createJavaLspClient,
	createJdtlsAssetServer,
	exerciseJavaLsp,
	verifyJdtlsArchiveContents
} from './probe-java-jdtls-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JAVACS = Object.freeze({
	version: '0.2.38',
	commit: '7fffb6c5929fe02c52e1c823ae990bad2b540ad1',
	sha256: 'fb7e94a7594f2e6bc9031b328ac38841d28270043a3dd9cb1f1f23ab7bc46674'
});
const DEPENDENCIES = [
	{
		path: 'com/google/code/gson/gson/2.8.5/gson-2.8.5.jar',
		sha256: '233a0149fc365c9f6edbd683cfe266b19bdc773be98eabdaf6b3c924b48e7d81'
	},
	{
		path: 'com/google/protobuf/protobuf-java/3.9.1/protobuf-java-3.9.1.jar',
		sha256: '5a1e5c225791eccd3d67a598922e637406190c90155fb97f38e4eab29719324d'
	}
];
const EXPORTS = ['api', 'code', 'comp', 'main', 'tree', 'model', 'util'].map(
	(name) => `jdk.compiler/com.sun.tools.javac.${name}=ALL-UNNAMED`
);
const DIAGNOSTIC = {
	code: 'compiler.err.prob.found.req',
	message: /int cannot be converted to (java\.lang\.)?String/
};
const FIXTURE = {
	sourceDirectory: 'src/probe',
	files: Object.fromEntries(
		Object.entries(JAVA_PROBE_FIXTURES).map(([name, text]) =>
			name.endsWith('.java')
				? [
						name.replace('src/', 'src/probe/'),
						`package probe;\n${text.replace('println(answer)', 'println(answer + args.length)')}`
					]
				: [name, text]
		)
	)
};
const SINGLE_FILE_FIXTURE = {
	sourceDirectory: 'src',
	files: {
		'src/Main.java':
			'public class Main { public static void main(String[] args) { int answer = 21; System.out.println(answer + args.length); } }\n'
	}
};
export {
	FIXTURE as JAVACS_PROBE_FIXTURE,
	SINGLE_FILE_FIXTURE as JAVACS_SINGLE_FILE_FIXTURE,
	DIAGNOSTIC as JAVACS_TYPE_MISMATCH
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fetchPinned(url, filename, expected) {
	let bytes;
	try {
		bytes = await readFile(filename);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
		assert.ok(response.ok, `Upstream asset returned HTTP ${response.status}`);
		bytes = Buffer.from(await response.arrayBuffer());
		assert.equal(
			sha256(bytes),
			expected,
			`Unrecognized upstream asset: ${path.basename(filename)}`
		);
		await writeFile(filename, bytes);
	}
	assert.equal(
		sha256(bytes),
		expected,
		`Cached asset differs from upstream: ${path.basename(filename)}`
	);
}

async function sourceFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await sourceFiles(filename)));
		else if (entry.isFile() && entry.name.endsWith('.java')) files.push(filename);
	}
	return files.sort();
}

export async function prepareJavacs(directory, jdkCompilerModule, jdkCompilerSha256) {
	await mkdir(directory, { recursive: true });
	const archive = path.join(directory, 'original.tar.gz');
	await fetchPinned(
		`https://codeload.github.com/georgewfraser/java-language-server/tar.gz/${JAVACS.commit}`,
		archive,
		JAVACS.sha256
	);
	const original = path.join(directory, 'original');
	await mkdir(original, { recursive: true });
	if (!(await readdir(original)).length) {
		const result = spawnSync(
			'tar',
			['--extract', '--gzip', '--no-same-owner', '--file', archive, '--directory', original],
			{ encoding: 'utf8' }
		);
		assert.equal(result.status, 0, result.stderr || 'Cannot extract original javacs source');
	}
	verifyJdtlsArchiveContents(archive, original);
	const source = path.join(original, `java-language-server-${JAVACS.commit}`);
	const server = path.join(directory, 'server');
	// Compile into fresh output directories so an old cache cannot inject classes
	// which are absent from the authenticated upstream source tree.
	const classes = await mkdtemp(path.join(directory, 'classes-'));
	await mkdir(server, { recursive: true });
	for (const dependency of DEPENDENCIES)
		await fetchPinned(
			`https://repo.maven.apache.org/maven2/${dependency.path}`,
			path.join(server, path.basename(dependency.path)),
			dependency.sha256
		);
	const classPath = DEPENDENCIES.map((dependency) =>
		path.join(server, path.basename(dependency.path))
	).join(path.delimiter);
	const javacArgs = [
		'-J-Xmx768m',
		'-source',
		'13',
		'-target',
		'13',
		'-proc:none',
		'-d',
		classes,
		'-cp',
		classPath,
		...EXPORTS.flatMap((value) => ['--add-exports', value]),
		...(await sourceFiles(path.join(source, 'src/main/java')))
	];
	const compile = spawnSync('javac', javacArgs, { encoding: 'utf8', timeout: 60000 });
	assert.equal(compile.status, 0, compile.stderr || 'Cannot compile original javacs with JDK 17');
	const jarPath = path.join(server, 'java-language-server.jar');
	const jar = spawnSync(
		'jar',
		['--create', '--date=2021-01-01T00:00:00Z', '--file', jarPath, '-C', classes, '.'],
		{ encoding: 'utf8' }
	);
	assert.equal(jar.status, 0, jar.stderr || 'Cannot package original javacs');
	const bridgeClasses = await mkdtemp(path.join(directory, 'bridge-classes-'));
	const bridge = spawnSync(
		'javac',
		[
			'--release',
			'17',
			'-d',
			bridgeClasses,
			path.join(ROOT, 'scripts/java-jdtls/BrowserStreams.java')
		],
		{ encoding: 'utf8' }
	);
	assert.equal(bridge.status, 0, bridge.stderr || 'Cannot build browser stdio bridge');
	const bridgeJar = path.join(directory, 'browser-streams.jar');
	const bridgePack = spawnSync(
		'jar',
		['--create', '--date=2021-01-01T00:00:00Z', '--file', bridgeJar, '-C', bridgeClasses, '.'],
		{ encoding: 'utf8' }
	);
	assert.equal(bridgePack.status, 0, bridgePack.stderr || 'Cannot package browser stdio bridge');
	await rm(classes, { recursive: true });
	await rm(bridgeClasses, { recursive: true });
	const files = [
		'java-language-server.jar',
		...DEPENDENCIES.map((dependency) => path.basename(dependency.path))
	];
	let compilerModule;
	if (jdkCompilerModule) {
		assert.match(
			jdkCompilerSha256 || '',
			/^[0-9a-f]{64}$/,
			'An explicit original JDK module SHA-256 is required'
		);
		assert.equal(
			sha256(await readFile(jdkCompilerModule)),
			jdkCompilerSha256,
			'JDK compiler module identity mismatch'
		);
		const description = spawnSync('jmod', ['describe', jdkCompilerModule], {
			encoding: 'utf8'
		});
		assert.equal(
			description.status,
			0,
			description.stderr || 'Cannot inspect original compiler module'
		);
		assert.match(
			description.stdout,
			/^jdk\.compiler@17\./m,
			'Expected original OpenJDK 17 compiler module'
		);
		const providers = [...description.stdout.matchAll(/^provides ([\w.]+) with ([\w.]+)$/gm)];
		assert.ok(
			providers.some((match) => match[1] === 'javax.tools.JavaCompiler'),
			'Original compiler provider is missing'
		);
		// On the classpath, module-info's unchanged provider declarations need the
		// equivalent standard SPI resources. No compiler class bytes are changed.
		const moduleJar = 'jdk-compiler.jar';
		const packed = spawnSync(
			'python3',
			[
				'-c',
				`
import json, pathlib, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as original, zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as target:
    for entry in original.infolist():
        if entry.is_dir(): continue
        if entry.filename.startswith('classes/'):
            name = entry.filename[len('classes/'):]
        elif entry.filename.startswith('legal/'):
            name = entry.filename
        else:
            continue
        assert '..' not in pathlib.PurePosixPath(name).parts, 'Unsafe compiler module entry'
        copied = zipfile.ZipInfo(name, (2021, 1, 1, 0, 0, 0))
        copied.compress_type = zipfile.ZIP_DEFLATED
        target.writestr(copied, original.read(entry))
    for service, implementation in json.loads(sys.argv[3]):
        entry = zipfile.ZipInfo('META-INF/services/' + service, (2021, 1, 1, 0, 0, 0))
        target.writestr(entry, implementation + '\\n')
`,
				jdkCompilerModule,
				path.join(server, moduleJar),
				JSON.stringify(
					providers.map(([, service, implementation]) => [service, implementation])
				)
			],
			{ encoding: 'utf8' }
		);
		assert.equal(packed.status, 0, packed.stderr || 'Cannot package original compiler classes');
		files.push(moduleJar);
		compilerModule = {
			sha256: jdkCompilerSha256,
			description: description.stdout,
			classByteModifications: [],
			providerResourcesFromModuleInfo: providers.map(([, service, implementation]) => ({
				service,
				implementation
			}))
		};
	}
	const receipt = {
		...JAVACS,
		buildJdk: spawnSync('javac', ['-version'], { encoding: 'utf8' }).stdout.trim(),
		buildSource: 13,
		buildTarget: 13,
		sourceModifications: [],
		javacExports: EXPORTS,
		compilerModule,
		assets: await Promise.all(
			files.map(async (file) => ({
				path: file,
				sha256: sha256(await readFile(path.join(server, file)))
			}))
		)
	};
	await writeFile(
		path.join(directory, 'original-assets.json'),
		`${JSON.stringify(receipt, null, 2)}\n`
	);
	return { directory, server, files, receipt };
}

async function nativeProbe(assets, options, evidence) {
	const fixture = options.stage === 'single-file' ? SINGLE_FILE_FIXTURE : FIXTURE;
	const project = path.join(options.outputDirectory, 'project');
	for (const [name, text] of Object.entries(fixture.files)) {
		await mkdir(path.dirname(path.join(project, name)), { recursive: true });
		await writeFile(path.join(project, name), text);
	}
	const args = [
		...EXPORTS.flatMap((value) => ['--add-exports', value]),
		'--add-opens',
		'jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED',
		'-cp',
		assets.files.map((file) => path.join(assets.server, file)).join(path.delimiter),
		'org.javacs.Main'
	];
	const child = spawn('java', args, { stdio: ['pipe', 'pipe', 'pipe'] });
	evidence.command = ['java', ...args];
	let stderr = '';
	const client = createJavaLspClient(
		(data) => child.stdin.write(data),
		evidence,
		options.timeoutMs
	);
	child.stdout.on('data', client.receive);
	child.stderr.on('data', (data) => {
		stderr += data.toString();
	});
	child.on('exit', (code, signal) => {
		evidence.processExit = { code, signal };
		client.abort(new Error(`Original javacs exited: ${code ?? signal}`));
	});
	try {
		await exerciseJavaLsp(
			client,
			pathToFileURL(project).href,
			options.stage,
			evidence,
			'upstream-defaults',
			DIAGNOSTIC,
			fixture
		);
	} finally {
		evidence.stderr = stderr.slice(-60000);
		child.kill('SIGTERM');
	}
}

async function browserProbe(assets, options, evidence) {
	const fixture = options.stage === 'single-file' ? SINGLE_FILE_FIXTURE : FIXTURE;
	const { chromium } = await import('playwright-core');
	const server = createJdtlsAssetServer(assets);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	let browserServer, browser, page, client, deadline;
	let stderr = '';
	evidence.phases = [];
	evidence.console = [];
	evidence.failedRequests = [];
	try {
		browserServer = await chromium.launchServer({
			headless: true,
			args: ['--disable-dev-shm-usage'],
			...(options.executablePath ? { executablePath: options.executablePath } : {})
		});
		browser = await chromium.connect(browserServer.wsEndpoint());
		page = await browser.newPage();
		page.on('console', (message) => {
			if (evidence.console.length < 100)
				evidence.console.push({
					type: message.type(),
					text: message.text().slice(0, 3000)
				});
		});
		page.on('pageerror', (error) =>
			evidence.console.push({ type: 'pageerror', text: String(error) })
		);
		page.on('requestfailed', (request) =>
			evidence.failedRequests.push({
				url: request.url(),
				error: request.failure()?.errorText
			})
		);
		client = createJavaLspClient(
			(data) => page.evaluate((chunk) => globalThis.__javaInput(chunk), data),
			evidence,
			options.timeoutMs
		);
		await page.exposeFunction('__javaOutput', (data, error) => {
			const bytes = Buffer.from(data, 'latin1');
			if (error) stderr += bytes.toString();
			else client.receive(bytes);
		});
		await page.exposeFunction('__javaPhase', async (phase) => {
			evidence.phases.push({ phase, elapsedMs: Date.now() - evidence.startedAtMs });
			if (phase.startsWith('compiler:')) evidence.compiler = phase.slice('compiler:'.length);
			if (phase.startsWith('platform:')) evidence.platform = phase.slice('platform:'.length);
			if (phase.startsWith('system-compiler:'))
				evidence.systemCompiler = phase.slice('system-compiler:'.length);
			await writeFile(
				path.join(options.outputDirectory, 'progress.json'),
				`${JSON.stringify({ phases: evidence.phases, messages: evidence.messages.length }, null, 2)}\n`
			);
			if (phase.startsWith('error:') || phase.startsWith('upstream-exit:'))
				client.abort(new Error(phase));
		});
		await page.goto(`http://127.0.0.1:${server.address().port}/`);
		await page.evaluate(() => {
			const original = Document.prototype.createElement;
			Document.prototype.createElement = function (name, options) {
				const element = original.call(this, name, options);
				if (name.toLowerCase() === 'iframe') element.credentialless = true;
				return element;
			};
		});
		await page.addScriptTag({ url: CHEERPJ_LOADER });
		await page.evaluate(
			({ files, fixtures, exports, stage }) => {
				const input = [];
				let waiting;
				globalThis.__javaInput = (chunk) => {
					if (waiting) {
						const resolve = waiting;
						waiting = undefined;
						resolve(chunk);
					} else input.push(chunk);
				};
				globalThis.__javaRun = (async () => {
					await globalThis.__javaPhase('cheerpj-init');
					await cheerpjInit({
						version: 17,
						status: 'none',
						natives: {
							Java_org_wasmidle_jdtls_BrowserStreams_readChunk() {
								return input.length
									? input.shift()
									: new Promise((resolve) => {
											waiting = resolve;
										});
							},
							Java_org_wasmidle_jdtls_BrowserStreams_writeChunk(_lib, chunk, error) {
								return globalThis.__javaOutput(chunk, error);
							},
							Java_org_wasmidle_jdtls_BrowserStreams_reportPhase(_lib, phase) {
								return globalThis.__javaPhase(phase);
							}
						}
					});
					await globalThis.__javaPhase('cheerpj-ready');
					const classPath = [
						'/app/browser-streams.jar',
						...files.map((file) => `/app/server/${file}`)
					].join(':');
					const lib = await cheerpjRunLibrary(classPath);
					const bridge = await lib.org.wasmidle.jdtls.BrowserStreams;
					globalThis.__javaBridge = bridge;
					await globalThis.__javaPhase('bridge-ready');
					for (const [name, text] of Object.entries(fixtures))
						await bridge.writeFile(`/files/java-project/${name}`, text);
					await globalThis.__javaPhase('filesystem-ready');
					const result = await cheerpjRunMain(
						'org.wasmidle.jdtls.BrowserStreams',
						classPath,
						'--main-class=org.javacs.Main',
						...(stage === 'compiler' ? ['--compiler-check-only'] : [])
					);
					await globalThis.__javaPhase(
						`${stage === 'compiler' ? 'compiler-check-exit' : 'upstream-exit'}:${result}`
					);
				})().catch(async (error) => {
					let description;
					try {
						description =
							error instanceof Error
								? error.stack || error.message
								: await error.toString();
					} catch {
						description = 'Java exception could not be rendered';
					}
					globalThis.__javaError = description;
					await globalThis.__javaPhase(`error:${description}`);
				});
			},
			{
				files: assets.files,
				fixtures: fixture.files,
				exports: EXPORTS,
				stage: options.stage
			}
		);
		await Promise.race([
			options.stage === 'compiler'
				? page.evaluate(() => globalThis.__javaRun)
				: exerciseJavaLsp(
						client,
						'file:///files/java-project',
						options.stage,
						evidence,
						'upstream-defaults',
						DIAGNOSTIC,
						fixture
					),
			new Promise((_, reject) => {
				deadline = setTimeout(
					() => {
						const error = new Error(
							'Browser javacs probe exceeded its overall deadline'
						);
						client.abort(error);
						reject(error);
					},
					Math.max(1, options.timeoutMs - (Date.now() - evidence.startedAtMs))
				);
			})
		]);
		const error = await page.evaluate(() => globalThis.__javaError);
		assert.ok(!error, error);
	} finally {
		clearTimeout(deadline);
		client?.abort(new Error('Browser javacs probe closed'));
		evidence.stderr = stderr.slice(-60000);
		if (page)
			evidence.runtimeError = await Promise.race([
				page.evaluate(() => globalThis.__javaError || null).catch(() => 'page closed'),
				new Promise((resolve) =>
					setTimeout(() => resolve('runtime error read timed out'), 3000)
				)
			]);
		await Promise.race([
			browser?.close().catch(() => {}),
			new Promise((resolve) => setTimeout(resolve, 3000))
		]);
		if (browserServer) {
			await Promise.race([
				browserServer.close().catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, 3000))
			]);
			if (browserServer.process().exitCode === null) browserServer.process().kill('SIGKILL');
		}
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}

export async function probeJavacs(options) {
	await mkdir(options.outputDirectory, { recursive: true });
	const evidence = {
		schema: 'wasm-idle-original-javacs-browser-v1',
		mode: options.mode,
		stage: options.stage,
		upstream: JAVACS,
		javaVersion: 17,
		cheerpjLoader: CHEERPJ_LOADER,
		startedAtMs: Date.now(),
		status: 'running',
		messages: []
	};
	try {
		const assets = await prepareJavacs(
			options.assetsDirectory,
			options.jdkCompilerModule,
			options.jdkCompilerSha256
		);
		evidence.assets = assets.receipt;
		if (options.mode === 'native') await nativeProbe(assets, options, evidence);
		else await browserProbe(assets, options, evidence);
		evidence.status = 'passed';
	} catch (error) {
		evidence.status = 'failed';
		evidence.error = String(error);
	} finally {
		evidence.completedAt = new Date().toISOString();
		await writeFile(
			path.join(options.outputDirectory, 'evidence.json'),
			`${JSON.stringify(evidence, null, 2)}\n`
		);
	}
	return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			mode: { type: 'string', default: 'browser' },
			stage: { type: 'string', default: 'features' },
			'assets-directory': { type: 'string', default: '.cache/java-javacs-assets' },
			'output-directory': { type: 'string', default: '.cache/java-javacs-browser' },
			'timeout-ms': { type: 'string', default: '180000' },
			'executable-path': { type: 'string' },
			'jdk-compiler-module': { type: 'string' },
			'jdk-compiler-sha256': { type: 'string' }
		}
	});
	assert.ok(['native', 'browser'].includes(values.mode));
	assert.ok(['initialize', 'features', 'compiler', 'single-file'].includes(values.stage));
	assert.ok(values.mode === 'browser' || values.stage !== 'compiler');
	const timeoutMs = Number(values['timeout-ms']);
	assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000);
	const evidence = await probeJavacs({
		mode: values.mode,
		stage: values.stage,
		timeoutMs,
		executablePath: values['executable-path'],
		jdkCompilerModule: values['jdk-compiler-module']
			? path.resolve(values['jdk-compiler-module'])
			: undefined,
		jdkCompilerSha256: values['jdk-compiler-sha256'],
		assetsDirectory: path.resolve(values['assets-directory']),
		outputDirectory: path.resolve(values['output-directory'])
	});
	console.log(
		JSON.stringify(
			{
				status: evidence.status,
				error: evidence.error,
				compiler: evidence.compiler,
				phases: evidence.phases,
				evidence: path.join(values['output-directory'], 'evidence.json')
			},
			null,
			2
		)
	);
	if (evidence.status !== 'passed') process.exitCode = 1;
}
