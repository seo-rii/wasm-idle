import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const JDTLS_PROFILES = Object.freeze({
	'1.36.0': Object.freeze({
		version: '1.36.0-202405301306',
		sha256: '028e274d06f4a61cad4ffd56f89ef414a8f65613c6d05d9467651b7fb03dae7b'
	}),
	'1.42.0': Object.freeze({
		version: '1.42.0-202411281516',
		sha256: '75d26dc03f886c089958a668dc8baede1a559a6e83bf12c96070a4ee199dc58e'
	})
});
export const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js';

// These integrations are optional Require-Bundle entries in upstream JDT LS.
// Keep the original JARs byte-for-byte, and change only the Equinox launch set.
const GRADLE_BUNDLES = [
	'org.eclipse.buildship.compat',
	'org.eclipse.buildship.core',
	'org.gradle.toolingapi'
];
const LAUNCH_PROFILES = {
	full: [],
	'upstream-defaults': [],
	'without-gradle': GRADLE_BUNDLES,
	'without-build-integrations': [
		...GRADLE_BUNDLES,
		'org.eclipse.m2e.apt.core',
		'org.eclipse.m2e.core',
		'org.eclipse.m2e.jdt',
		'org.eclipse.m2e.maven.runtime',
		'org.eclipse.m2e.workspace.cli'
	]
};

export function createLaunchConfiguration(original, profile = 'full') {
	assert.ok(Object.hasOwn(LAUNCH_PROFILES, profile), 'Unknown launch profile');
	const excluded = new Set(LAUNCH_PROFILES[profile]);
	const excludedBundles = [];
	const configuration =
		excluded.size === 0
			? original
			: original.replace(/^osgi\.bundles=(.*)$/m, (_line, bundles) => {
					const selected = bundles.split(',').filter((bundle) => {
						const match = /file\\?:([^_/]+)_[^,]+/.exec(bundle);
						assert.ok(match, `Unrecognized original bundle entry: ${bundle}`);
						if (!excluded.has(match[1])) return true;
						excludedBundles.push(match[1]);
						return false;
					});
					return `osgi.bundles=${selected.join(',')}`;
				});
	assert.equal(
		excludedBundles.length,
		excluded.size,
		'Launch profile does not match the pinned upstream bundle set'
	);
	return {
		configuration,
		receipt: {
			profile,
			excludedBundles,
			originalConfigurationSha256: createHash('sha256').update(original).digest('hex'),
			launchConfigurationSha256: createHash('sha256').update(configuration).digest('hex'),
			initializationSettings: profile === 'full' ? 'explicit' : 'upstream-defaults'
		}
	};
}

const FIXTURES = {
	'.project':
		'<?xml version="1.0"?><projectDescription><name>browser-probe</name><comment></comment><projects></projects><buildSpec><buildCommand><name>org.eclipse.jdt.core.javabuilder</name><arguments></arguments></buildCommand></buildSpec><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>',
	'.classpath':
		'<?xml version="1.0"?><classpath><classpathentry kind="src" path="src"/><classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/><classpathentry kind="output" path="bin"/></classpath>',
	'src/Helper.java':
		'public class Helper { public static int doubleValue(int value) { return value * 2; } }\n',
	'src/Main.java':
		'public class Main { public static void main(String[] args) { int answer = Helper.doubleValue(21); System.out.println(answer); } }\n'
};

async function filesBelow(directory, prefix = '') {
	const output = [];
	for (const item of await readdir(directory, { withFileTypes: true })) {
		const relative = `${prefix}${item.name}`;
		if (item.isDirectory())
			output.push(...(await filesBelow(path.join(directory, item.name), `${relative}/`)));
		else if (item.isFile()) output.push(relative);
		else throw new Error(`Unsupported JDT LS asset type: ${relative}`);
	}
	return output.sort();
}

export async function prepareJdtls(directory, archiveFile, serverVersion = '1.36.0') {
	await mkdir(directory, { recursive: true });
	const profile = JDTLS_PROFILES[serverVersion];
	assert.ok(profile, 'Unknown pinned JDT LS version');
	const archivePath = archiveFile
		? path.resolve(archiveFile)
		: path.join(directory, 'jdtls.tar.gz');
	let archive;
	try {
		archive = await readFile(archivePath);
	} catch (error) {
		if (archiveFile || error.code !== 'ENOENT') throw error;
		const response = await fetch(
			`https://download.eclipse.org/jdtls/milestones/${serverVersion}/jdt-language-server-${profile.version}.tar.gz`,
			{ signal: AbortSignal.timeout(120000) }
		);
		assert.ok(response.ok, `JDT LS download returned HTTP ${response.status}`);
		archive = Buffer.from(await response.arrayBuffer());
		await writeFile(archivePath, archive);
	}
	assert.equal(
		createHash('sha256').update(archive).digest('hex'),
		profile.sha256,
		'JDT LS archive identity mismatch'
	);
	const server = path.join(directory, 'server');
	const receiptPath = path.join(directory, 'original-assets.json');
	let prepared = false;
	try {
		const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
		assert.equal(
			receipt.sha256,
			profile.sha256,
			'Assets directory belongs to a different JDT LS release'
		);
		prepared = true;
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	if (!prepared) {
		await mkdir(server, { recursive: true });
		assert.equal(
			(await readdir(server)).length,
			0,
			'Unverified pre-existing JDT LS assets directory'
		);
	}
	if (!prepared) {
		const unpack = spawnSync(
			'tar',
			[
				'--extract',
				'--gzip',
				'--no-same-owner',
				'--file',
				archivePath,
				'--directory',
				server
			],
			{ encoding: 'utf8' }
		);
		assert.equal(unpack.status, 0, unpack.stderr || unpack.stdout || 'Cannot extract JDT LS');
	}
	// Compare bytes against the authenticated archive. Local uid/gid/mode changes made
	// by --no-same-owner and the user's umask are not modifications to upstream code.
	verifyJdtlsArchiveContents(archivePath, server);
	if (!prepared)
		await writeFile(
			receiptPath,
			`${JSON.stringify({ version: profile.version, sha256: profile.sha256 })}\n`
		);
	const classes = path.join(directory, 'classes');
	await mkdir(classes, { recursive: true });
	const compile = spawnSync(
		'javac',
		[
			'--release',
			'17',
			'-d',
			classes,
			path.join(ROOT, 'scripts/java-jdtls/BrowserStreams.java')
		],
		{ encoding: 'utf8' }
	);
	assert.equal(compile.status, 0, compile.stderr || 'Cannot compile browser stream adapter');
	const jarPath = path.join(directory, 'browser-streams.jar');
	const jar = spawnSync(
		'jar',
		['--create', '--file', jarPath, '--date=2024-11-28T15:16:00Z', '-C', classes, '.'],
		{ encoding: 'utf8' }
	);
	assert.equal(jar.status, 0, jar.stderr || 'Cannot package browser stream adapter');
	const files = await filesBelow(server);
	const launcher = files.find((file) =>
		/^plugins\/org\.eclipse\.equinox\.launcher_[^/]+\.jar$/.test(file)
	);
	assert.ok(launcher, 'JDT LS launcher is missing');
	return { directory, server, files, launcher, jarPath };
}

export function verifyJdtlsArchiveContents(archivePath, server) {
	// tarfile understands the official release's PAX headers. Compare payloads only;
	// archive ownership is intentionally not restored into the local workspace.
	const result = spawnSync(
		'python3',
		[
			'-c',
			`
import pathlib, sys, tarfile
root = pathlib.Path(sys.argv[2]).resolve()
expected = set()
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for entry in archive:
        name = pathlib.PurePosixPath(entry.name)
        assert not name.is_absolute() and '..' not in name.parts, 'Unsafe archive path'
        target = root / entry.name
        assert not target.is_symlink() and target.resolve().is_relative_to(root), 'Unsafe cache path'
        if entry.isdir():
            assert target.is_dir(), f'Missing cache directory: {entry.name}'
        else:
            assert entry.isfile(), f'Unsupported archive entry: {entry.name}'
            expected.add(str(name))
            assert target.is_file() and target.stat().st_size == entry.size, f'Wrong cached size: {entry.name}'
            with archive.extractfile(entry) as source, target.open('rb') as actual:
                while chunk := source.read(1024 * 1024):
                    assert actual.read(len(chunk)) == chunk, f'Cached bytes differ: {entry.name}'
actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
assert actual == expected, 'Unexpected files in JDT LS cache'
`,
			archivePath,
			server
		],
		{ encoding: 'utf8' }
	);
	assert.equal(
		result.status,
		0,
		result.stderr || 'JDT LS cached bytes differ from the upstream archive'
	);
}

function lspClient(send, evidence, timeoutMs) {
	let nextId = 0;
	let pending = Buffer.alloc(0);
	let aborted;
	const requests = new Map();
	const notifications = [];
	const sendMessage = (message) => {
		const json = JSON.stringify({ jsonrpc: '2.0', ...message });
		return send(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
	};
	const receive = (data) => {
		pending = Buffer.concat([pending, data]);
		for (;;) {
			const end = pending.indexOf('\r\n\r\n');
			if (end < 0) return;
			const header = pending.subarray(0, end).toString();
			const match = /Content-Length:\s*(\d+)/i.exec(header);
			if (!match) throw new Error(`Invalid LSP stdout header: ${header.slice(0, 500)}`);
			const length = Number(match[1]);
			if (pending.length < end + 4 + length) return;
			const message = JSON.parse(pending.subarray(end + 4, end + 4 + length).toString());
			pending = pending.subarray(end + 4 + length);
			evidence.messages.push(message);
			if (message.method && message.id !== undefined) {
				const result =
					message.method === 'workspace/configuration'
						? message.params.items.map(() => ({}))
						: null;
				void sendMessage({ id: message.id, result });
			} else if (message.id !== undefined) {
				const request = requests.get(message.id);
				if (request) {
					requests.delete(message.id);
					clearTimeout(request.timer);
					if (message.error) request.reject(new Error(JSON.stringify(message.error)));
					else request.resolve(message.result);
				}
			} else notifications.push(message);
		}
	};
	return {
		receive,
		notifications,
		abort(reason) {
			aborted = reason;
			for (const pending of requests.values()) {
				clearTimeout(pending.timer);
				pending.reject(reason);
			}
			requests.clear();
		},
		notify: (method, params) =>
			aborted ? Promise.reject(aborted) : sendMessage({ method, params }),
		request(method, params) {
			if (aborted) return Promise.reject(aborted);
			const id = ++nextId;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					requests.delete(id);
					reject(new Error(`${method} timed out after ${timeoutMs} ms`));
				}, timeoutMs);
				requests.set(id, { resolve, reject, timer });
				Promise.resolve(sendMessage({ id, method, params })).catch((error) => {
					clearTimeout(timer);
					requests.delete(id);
					reject(error);
				});
			});
		}
	};
}

async function exercise(
	client,
	project,
	stage,
	evidence,
	launchProfile,
	diagnosticExpectation = { code: '16777233', message: /cannot convert from int to String/ },
	fixture = { files: FIXTURES, sourceDirectory: 'src' },
	beforeOpen
) {
	const uri = `${project}/${fixture.sourceDirectory}/Main.java`;
	const initialized = await client.request('initialize', {
		processId: null,
		rootUri: project,
		workspaceFolders: [{ uri: project, name: 'browser-probe' }],
		capabilities: {
			textDocument: {
				completion: { completionItem: { snippetSupport: true } },
				hover: { contentFormat: ['plaintext'] },
				publishDiagnostics: {}
			},
			workspace: { configuration: true, workspaceFolders: true }
		},
		initializationOptions:
			launchProfile !== 'full'
				? {}
				: {
						settings: {
							java: {
								import: { gradle: { enabled: false }, maven: { enabled: false } },
								autobuild: { enabled: true }
							}
						}
					}
	});
	evidence.initialize = initialized;
	assert.ok(
		initialized.capabilities.completionProvider,
		'Upstream completion capability missing'
	);
	assert.ok(
		initialized.capabilities.definitionProvider,
		'Upstream definition capability missing'
	);
	await client.notify('initialized', {});
	if (stage === 'initialize') return;
	await beforeOpen?.(client, project);
	const singleFile = stage === 'single-file';
	for (const name of singleFile ? ['Main'] : ['Helper', 'Main'])
		await client.notify('textDocument/didOpen', {
			textDocument: {
				uri: `${project}/${fixture.sourceDirectory}/${name}.java`,
				languageId: 'java',
				version: 1,
				text: fixture.files[`${fixture.sourceDirectory}/${name}.java`]
			}
		});
	const line = fixture.files[`${fixture.sourceDirectory}/Main.java`];
	const positionAt = (offset) => {
		const preceding = line.slice(0, offset).split('\n');
		return { line: preceding.length - 1, character: preceding.at(-1).length };
	};
	const character = singleFile ? line.lastIndexOf('answer') + 2 : line.indexOf('doubleValue') + 3;
	evidence.hover = await client.request('textDocument/hover', {
		textDocument: { uri },
		position: positionAt(character)
	});
	assert.ok(evidence.hover?.contents, 'Cross-file hover missing');
	assert.match(
		JSON.stringify(evidence.hover),
		singleFile ? /int answer/ : /doubleValue/,
		'Hover is missing the original method signature'
	);
	if (!singleFile) {
		evidence.definition = await client.request('textDocument/definition', {
			textDocument: { uri },
			position: positionAt(character)
		});
		assert.match(
			JSON.stringify(evidence.definition),
			/Helper\.java/,
			'Cross-file definition missing'
		);
		evidence.completion = await client.request('textDocument/completion', {
			textDocument: { uri },
			position: positionAt(line.indexOf('Helper.') + 'Helper.'.length)
		});
		assert.match(
			JSON.stringify(evidence.completion),
			/doubleValue/,
			'Cross-file completion missing'
		);
	}
	const baselineStarted = Date.now();
	while (Date.now() - baselineStarted < 30000) {
		const baseline = client.notifications.find(
			(message) =>
				message.method === 'textDocument/publishDiagnostics' &&
				message.params.uri === uri &&
				message.params.diagnostics.length === 0
		);
		if (baseline) {
			evidence.baselineDiagnostics = baseline.params;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.ok(evidence.baselineDiagnostics, 'Valid Java project never received clean diagnostics');
	const diagnosticCursor = client.notifications.length;
	await client.notify('textDocument/didChange', {
		textDocument: { uri, version: 2 },
		contentChanges: [{ text: line.replace('int answer =', 'String answer =') }]
	});
	const started = Date.now();
	while (Date.now() - started < 30000) {
		const found = client.notifications
			.slice(diagnosticCursor)
			.find(
				(message) =>
					message.method === 'textDocument/publishDiagnostics' &&
					message.params.uri === uri &&
					message.params.diagnostics.some(
						(diagnostic) =>
							String(diagnostic.code) === diagnosticExpectation.code &&
							diagnostic.severity === 1 &&
							diagnosticExpectation.message.test(diagnostic.message)
					)
			);
		if (found) {
			evidence.diagnostics = found.params;
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error('Upstream type-mismatch diagnostic missing');
}

export {
	FIXTURES as JAVA_PROBE_FIXTURES,
	lspClient as createJavaLspClient,
	exercise as exerciseJavaLsp
};

async function nativeProbe(assets, options, evidence) {
	const project = path.join(options.outputDirectory, 'native-project');
	for (const [name, text] of Object.entries(FIXTURES)) {
		await mkdir(path.dirname(path.join(project, name)), { recursive: true });
		await writeFile(path.join(project, name), text);
	}
	const configDirectory = path.join(options.outputDirectory, 'native-config');
	await cp(path.join(assets.server, 'config_linux'), configDirectory, { recursive: true });
	await writeFile(path.join(configDirectory, 'config.ini'), assets.launchConfiguration);
	const args = [
		'-Declipse.application=org.eclipse.jdt.ls.core.id1',
		'-Declipse.product=org.eclipse.jdt.ls.core.product',
		'-Dosgi.bundles.defaultStartLevel=4',
		'-Dlog.level=ALL',
		'-Declipse.filesystem.useNatives=false',
		'--add-modules=ALL-SYSTEM',
		'--add-opens=java.base/java.util=ALL-UNNAMED',
		'--add-opens=java.base/java.lang=ALL-UNNAMED',
		'-jar',
		path.join(assets.server, assets.launcher),
		'-configuration',
		configDirectory,
		'-data',
		path.join(options.outputDirectory, 'native-workspace')
	];
	const child = spawn('java', args, { cwd: assets.server, stdio: ['pipe', 'pipe', 'pipe'] });
	evidence.command = ['java', ...args];
	let stderr = '';
	const client = lspClient((data) => child.stdin.write(data), evidence, options.timeoutMs);
	child.stdout.on('data', client.receive);
	child.stderr.on('data', (data) => {
		stderr += data.toString();
	});
	child.on('exit', (code, signal) => {
		evidence.processExit = { code, signal };
		client.abort(new Error(`Original JDT LS exited: ${code ?? signal}`));
	});
	try {
		await exercise(
			client,
			pathToFileURL(project).href,
			options.stage,
			evidence,
			options.launchProfile
		);
	} finally {
		evidence.stderr = stderr.slice(-60000);
		child.kill('SIGTERM');
		evidence.platformLogs = {};
		for (const filename of [
			path.join(options.outputDirectory, 'native-workspace/.metadata/.log'),
			...(await readdir(configDirectory))
				.filter((name) => name.endsWith('.log'))
				.map((name) => path.join(configDirectory, name))
		]) {
			try {
				evidence.platformLogs[filename] = (await readFile(filename, 'utf8')).slice(-60000);
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
		}
	}
}

export function createJdtlsAssetServer(assets, options = {}) {
	return createServer(async (request, response) => {
		try {
			const url = new URL(request.url, 'http://localhost');
			response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			if (options.embedderPolicy !== 'unsafe-none')
				response.setHeader(
					'Cross-Origin-Embedder-Policy',
					options.embedderPolicy || 'require-corp'
				);
			if (url.pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><title>Original JDT LS browser acceptance</title>');
				return;
			}
			const root = url.pathname === '/browser-streams.jar' ? assets.directory : assets.server;
			assert.ok(
				url.pathname === '/browser-streams.jar' ||
					url.pathname === '/server' ||
					url.pathname.startsWith('/server/')
			);
			const relative =
				url.pathname === '/browser-streams.jar'
					? 'browser-streams.jar'
					: decodeURIComponent(url.pathname.slice('/server'.length)).replace(/^\//, '');
			const filename = path.resolve(root, relative);
			assert.ok(filename === root || filename.startsWith(`${root}${path.sep}`));
			if (relative.endsWith('/index.list') || relative === 'index.list') {
				const names = (await readdir(path.dirname(filename))).sort();
				response.setHeader('Content-Type', 'text/plain');
				response.end(`${names.join('\n')}\n`);
				return;
			}
			const info = await stat(filename);
			if (info.isDirectory()) {
				if (!url.pathname.endsWith('/')) {
					response.writeHead(301, { Location: `${url.pathname}/${url.search}` });
					response.end();
				} else {
					response.setHeader('Content-Type', 'text/html');
					response.end('<!doctype html><title>JDT LS assets</title>');
				}
				return;
			}
			assert.ok(info.isFile());
			response.setHeader('Accept-Ranges', 'bytes');
			response.setHeader('Last-Modified', info.mtime.toUTCString());
			response.setHeader(
				'Content-Type',
				filename.endsWith('.jar') ? 'application/java-archive' : 'application/octet-stream'
			);
			let start = 0;
			let end = info.size - 1;
			if (request.headers.range) {
				const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
				if (!range || (!range[1] && !range[2])) {
					response.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
					response.end();
					return;
				}
				start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
				end =
					range[1] && range[2]
						? Math.min(Number(range[2]), info.size - 1)
						: info.size - 1;
				if (
					!Number.isSafeInteger(start) ||
					!Number.isSafeInteger(end) ||
					start > end ||
					start >= info.size
				) {
					response.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
					response.end();
					return;
				}
				response.writeHead(206, {
					'Content-Range': `bytes ${start}-${end}/${info.size}`,
					'Content-Length': end - start + 1
				});
			} else {
				response.setHeader('Content-Length', info.size);
			}
			if (request.method === 'HEAD' || info.size === 0) response.end();
			else
				createReadStream(filename, { start, end })
					.on('error', (error) => response.destroy(error))
					.pipe(response);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
}

async function browserProbe(assets, options, evidence) {
	const { chromium } = await import('playwright-core');
	const server = createJdtlsAssetServer(assets, options);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	let browser;
	let browserServer;
	let page;
	let activeClient;
	let deadlineTimer;
	let stderr = '';
	evidence.phases = [];
	evidence.console = [];
	evidence.failedRequests = [];
	try {
		browserServer = await chromium.launchServer({
			headless: true,
			...(options.executablePath ? { executablePath: options.executablePath } : {}),
			args: ['--disable-dev-shm-usage']
		});
		browser = await chromium.connect(browserServer.wsEndpoint());
		page = await browser.newPage();
		page.on('console', (message) => {
			if (evidence.console.length < 200)
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
		const client = lspClient(
			(data) => page.evaluate((chunk) => globalThis.__jdtlsInput(chunk), data),
			evidence,
			options.timeoutMs
		);
		activeClient = client;
		await page.exposeFunction('__jdtlsPhase', async (phase) => {
			evidence.phases.push({ phase, elapsedMs: Date.now() - evidence.startedAtMs });
			await writeFile(
				path.join(options.outputDirectory, 'progress.json'),
				`${JSON.stringify({ phases: evidence.phases, stderr: stderr.slice(-6000), console: evidence.console, failedRequests: evidence.failedRequests }, null, 2)}\n`
			);
			if (phase.startsWith('error:')) client.abort(new Error(phase.slice('error:'.length)));
			if (phase.startsWith('jdtls-exit:'))
				client.abort(
					new Error(
						`Original JDT LS exited with code ${phase.slice('jdtls-exit:'.length)}`
					)
				);
		});
		await page.exposeFunction('__jdtlsOutput', (data, error) => {
			const bytes = Buffer.from(data, 'latin1');
			if (error) stderr += bytes.toString();
			else client.receive(bytes);
		});
		await page.goto(`http://127.0.0.1:${server.address().port}/`);
		if (options.credentiallessRuntime)
			await page.evaluate(() => {
				const createElement = Document.prototype.createElement;
				Document.prototype.createElement = function (name, elementOptions) {
					const element = createElement.call(this, name, elementOptions);
					if (name.toLowerCase() === 'iframe') element.credentialless = true;
					return element;
				};
			});
		await page.addScriptTag({ url: CHEERPJ_LOADER });
		await page.evaluate(
			({ launcher, files, fixtures, installMode, launchConfiguration }) => {
				globalThis.__jdtlsDescribeError = async (error) => {
					try {
						if (error instanceof Error) return error.stack || error.message;
						if (typeof error?.toString === 'function') return await error.toString();
						return 'Java exception without toString';
					} catch {
						return 'Java exception could not be rendered';
					}
				};
				const queue = [];
				let waiting;
				globalThis.__jdtlsInput = (chunk) => {
					if (waiting) {
						const resolve = waiting;
						waiting = undefined;
						resolve(chunk);
					} else queue.push(chunk);
				};
				globalThis.__jdtlsRun = (async () => {
					await globalThis.__jdtlsPhase('cheerpj-init');
					await cheerpjInit({
						version: 17,
						status: 'none',
						javaProperties: [
							'eclipse.application=org.eclipse.jdt.ls.core.id1',
							'eclipse.product=org.eclipse.jdt.ls.core.product',
							'osgi.bundles.defaultStartLevel=4',
							'osgi.locking=none',
							'eclipse.filesystem.useNatives=false',
							'osgi.configuration.area=file:/files/jdtls/config_linux/',
							'osgi.instance.area=file:/files/jdtls-workspace/',
							'osgi.logfile=/files/jdtls-bootstrap.log',
							`osgi.install.area=file:${installMode === 'copy' ? '/files/jdtls/' : '/app/server/'}`,
							'log.level=ALL'
						],
						natives: {
							Java_org_wasmidle_jdtls_BrowserStreams_readChunk() {
								return queue.length
									? queue.shift()
									: new Promise((resolve) => {
											waiting = resolve;
										});
							},
							Java_org_wasmidle_jdtls_BrowserStreams_writeChunk(_lib, chunk, error) {
								return globalThis.__jdtlsOutput(chunk, error);
							},
							Java_org_wasmidle_jdtls_BrowserStreams_reportPhase(_lib, phase) {
								return globalThis.__jdtlsPhase(phase);
							}
						}
					});
					await globalThis.__jdtlsPhase('cheerpj-ready');
					const classPath = `/app/browser-streams.jar:/app/server/${launcher}`;
					const lib = await cheerpjRunLibrary(classPath);
					globalThis.__jdtlsBridge = await lib.org.wasmidle.jdtls.BrowserStreams;
					await globalThis.__jdtlsPhase('bridge-ready');
					const copiedFiles =
						installMode === 'copy' ? files : ['config_linux/config.ini'];
					for (const [index, file] of copiedFiles.entries()) {
						await globalThis.__jdtlsPhase(`filesystem-copy:${index}:${file}`);
						await globalThis.__jdtlsBridge.copyFile(
							`/app/server/${file}`,
							`/files/jdtls/${file}`
						);
					}
					const expectedConfig = await (
						await fetch('/server/config_linux/config.ini')
					).text();
					const actualConfig = await globalThis.__jdtlsBridge.readFile(
						'/files/jdtls/config_linux/config.ini'
					);
					if (actualConfig !== expectedConfig)
						throw new Error('Java VFS config copy differs from the upstream asset');
					await globalThis.__jdtlsBridge.writeFile(
						'/files/jdtls/config_linux/config.ini',
						launchConfiguration
					);
					for (const [name, text] of Object.entries(fixtures))
						await globalThis.__jdtlsBridge.writeFile(
							`/files/java-project/${name}`,
							text
						);
					await globalThis.__jdtlsPhase('filesystem-ready');
					const result = await cheerpjRunMain(
						'org.wasmidle.jdtls.BrowserStreams',
						classPath,
						'-nosplash',
						'-install',
						installMode === 'copy' ? '/files/jdtls' : '/app/server',
						'-configuration',
						'file:/files/jdtls/config_linux/',
						'-data',
						'/files/jdtls-workspace'
					);
					await globalThis.__jdtlsPhase(`jdtls-exit:${result}`);
				})().catch(async (error) => {
					globalThis.__jdtlsError = await globalThis.__jdtlsDescribeError(error);
					await globalThis.__jdtlsPhase(`error:${globalThis.__jdtlsError}`);
				});
			},
			{
				launcher: assets.launcher,
				files: assets.files,
				fixtures: FIXTURES,
				installMode: options.installMode,
				launchConfiguration: assets.launchConfiguration
			}
		);
		await Promise.race([
			exercise(
				client,
				'file:///files/java-project',
				options.stage,
				evidence,
				options.launchProfile
			),
			new Promise((_, reject) => {
				deadlineTimer = setTimeout(
					() => {
						const error = new Error(
							`Browser probe exceeded its ${options.timeoutMs} ms overall deadline`
						);
						client.abort(error);
						reject(error);
					},
					Math.max(1, options.timeoutMs - (Date.now() - evidence.startedAtMs))
				);
			})
		]);
	} finally {
		clearTimeout(deadlineTimer);
		activeClient?.abort(new Error('Browser probe closed'));
		evidence.stderr = stderr.slice(-60000);
		if (page) {
			evidence.runtimeError = await Promise.race([
				page.evaluate(() => globalThis.__jdtlsError || null).catch(() => 'page closed'),
				new Promise((resolve) =>
					setTimeout(() => resolve('runtime error read timed out'), 3000)
				)
			]);
			evidence.platformLogs = await Promise.race([
				page.evaluate(async () => {
					const bridge = globalThis.__jdtlsBridge;
					if (!bridge) return { unavailable: 'Java bridge was not initialized' };
					const properties = {};
					for (const key of [
						'java.home',
						'os.name',
						'os.arch',
						'os.version',
						'osgi.os',
						'osgi.arch',
						'org.osgi.framework.os.name',
						'org.osgi.framework.processor',
						'user.dir',
						'osgi.configuration.area',
						'osgi.install.area',
						'osgi.instance.area',
						'osgi.logfile',
						'eclipse.exitdata'
					])
						properties[key] = await bridge.property(key);
					const logs = {};
					const candidates = new Set([
						'/files/jdtls-bootstrap.log',
						'/files/jdtls-workspace/.metadata/.log'
					]);
					const listings = {};
					for (const directory of [
						'/files',
						'/files/jdtls/config_linux',
						'/files/jdtls/configuration'
					]) {
						try {
							listings[directory] = await bridge.listFiles(directory);
							for (const file of listings[directory]
								.split('\n')
								.filter((name) => name.endsWith('.log'))
								.slice(0, 6))
								candidates.add(`${directory}/${file}`);
						} catch (error) {
							listings[directory] = await globalThis.__jdtlsDescribeError(error);
						}
					}
					for (const filename of candidates) {
						try {
							logs[filename] = (await bridge.readFile(filename)).slice(-60000);
						} catch (error) {
							logs[filename] = await globalThis.__jdtlsDescribeError(error);
						}
					}
					return { properties, listings, logs };
				}),
				new Promise((resolve) => setTimeout(() => resolve('log read timed out'), 10000))
			]);
		}
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

export async function probeJdtls(options) {
	await mkdir(path.join(ROOT, '.cache'), { recursive: true });
	const output =
		options.outputDirectory || (await mkdtemp(path.join(ROOT, '.cache/java-jdtls-')));
	await mkdir(output, { recursive: true });
	const serverVersion = options.serverVersion || '1.36.0';
	const profile = JDTLS_PROFILES[serverVersion];
	assert.ok(profile, 'Unknown pinned JDT LS version');
	const runOptions = { launchProfile: 'full', ...options, outputDirectory: output };
	const evidence = {
		schema: 'wasm-idle-original-jdtls-browser-v1',
		mode: options.mode,
		stage: options.stage,
		embedderPolicy: options.embedderPolicy,
		credentiallessRuntime: options.credentiallessRuntime,
		installMode: options.installMode,
		jdtlsVersion: profile.version,
		archiveSha256: profile.sha256,
		cheerpjLoader: CHEERPJ_LOADER,
		javaVersion: 17,
		status: 'running',
		startedAtMs: Date.now(),
		messages: []
	};
	try {
		const assets = await prepareJdtls(
			options.assetsDirectory || path.join(output, 'assets'),
			options.archiveFile,
			serverVersion
		);
		evidence.assetFiles = assets.files.length;
		const launch = createLaunchConfiguration(
			await readFile(path.join(assets.server, 'config_linux/config.ini'), 'utf8'),
			runOptions.launchProfile
		);
		assets.launchConfiguration = launch.configuration;
		evidence.launch = launch.receipt;
		await writeFile(
			path.join(output, 'launch-receipt.json'),
			`${JSON.stringify(
				{
					jdtlsVersion: profile.version,
					archiveSha256: profile.sha256,
					...launch.receipt
				},
				null,
				2
			)}\n`
		);
		if (options.mode === 'native') await nativeProbe(assets, runOptions, evidence);
		else await browserProbe(assets, runOptions, evidence);
		evidence.status = 'passed';
	} catch (error) {
		evidence.status = 'failed';
		evidence.error = String(error);
	} finally {
		evidence.completedAt = new Date().toISOString();
		await writeFile(
			path.join(output, 'evidence.json'),
			`${JSON.stringify(evidence, null, 2)}\n`
		);
	}
	return { evidence, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			mode: { type: 'string', default: 'browser' },
			stage: { type: 'string', default: 'features' },
			'embedder-policy': { type: 'string', default: 'require-corp' },
			'credentialless-runtime': { type: 'boolean', default: false },
			'install-mode': { type: 'string', default: 'http' },
			'server-version': { type: 'string', default: '1.36.0' },
			'launch-profile': { type: 'string', default: 'full' },
			'assets-directory': { type: 'string' },
			'archive-file': { type: 'string' },
			'output-directory': { type: 'string' },
			'timeout-ms': { type: 'string', default: '180000' },
			'executable-path': { type: 'string' }
		}
	});
	assert.ok(['browser', 'native'].includes(values.mode), 'mode must be browser or native');
	assert.ok(JDTLS_PROFILES[values['server-version']], 'server-version must be a pinned release');
	assert.ok(Object.hasOwn(LAUNCH_PROFILES, values['launch-profile']), 'Unknown launch-profile');
	assert.ok(
		['initialize', 'features'].includes(values.stage),
		'stage must be initialize or features'
	);
	assert.ok(
		['require-corp', 'credentialless', 'unsafe-none'].includes(values['embedder-policy']),
		'embedder-policy must be require-corp, credentialless, or unsafe-none'
	);
	assert.ok(
		['http', 'copy'].includes(values['install-mode']),
		'install-mode must be http or copy'
	);
	const timeoutMs = Number(values['timeout-ms']);
	assert.ok(
		Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000,
		'timeout-ms must be 1..600000'
	);
	const result = await probeJdtls({
		mode: values.mode,
		stage: values.stage,
		timeoutMs,
		embedderPolicy: values['embedder-policy'],
		credentiallessRuntime: values['credentialless-runtime'],
		installMode: values['install-mode'],
		serverVersion: values['server-version'],
		launchProfile: values['launch-profile'],
		assetsDirectory: values['assets-directory']
			? path.resolve(values['assets-directory'])
			: undefined,
		archiveFile: values['archive-file'],
		outputDirectory: values['output-directory']
			? path.resolve(values['output-directory'])
			: undefined,
		executablePath: values['executable-path']
	});
	console.log(
		JSON.stringify(
			{
				status: result.evidence.status,
				error: result.evidence.error,
				phases: result.evidence.phases,
				evidence: path.join(result.output, 'evidence.json')
			},
			null,
			2
		)
	);
	if (result.evidence.status !== 'passed') process.exitCode = 1;
}
