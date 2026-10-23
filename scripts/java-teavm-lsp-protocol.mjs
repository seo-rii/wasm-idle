import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const JAVA_TEAVM_FIXTURE_DIRECTORY = path.join(
	ROOT,
	'packages/lsp/test/fixtures/java-teavm'
);
export const JAVACS_UPSTREAM = Object.freeze({
	version: '0.2.38',
	commit: '7fffb6c5929fe02c52e1c823ae990bad2b540ad1',
	archiveBytes: 6538580,
	archiveSha256: 'fb7e94a7594f2e6bc9031b328ac38841d28270043a3dd9cb1f1f23ab7bc46674'
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
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class JavaLspResponseError extends Error {
	constructor(error) {
		super(`Original javacs error ${error.code}: ${error.message}`);
		this.name = 'JavaLspResponseError';
		this.response = error;
	}
}

/** Shared by the original native server and the public browser SDK acceptance. */
export function createJavaTeavmLspClient(send, options = {}) {
	const timeoutMs = options.timeoutMs || 30000;
	const messages = options.messages || [];
	const notifications = [];
	const pending = new Map();
	let sequence = 0;
	let stopped;
	let framed = Buffer.alloc(0);
	const write = (message) => {
		if (stopped) throw stopped;
		const outgoing = { jsonrpc: '2.0', ...message };
		messages.push({ direction: 'send', message: outgoing });
		return send(outgoing);
	};
	const receive = (message) => {
		messages.push({ direction: 'receive', message });
		if (message.method && Object.hasOwn(message, 'id')) {
			const result =
				message.method === 'workspace/configuration'
					? message.params.items.map(() => ({}))
					: null;
			Promise.resolve(write({ id: message.id, result })).catch(abort);
		} else if (Object.hasOwn(message, 'id')) {
			const request = pending.get(message.id);
			if (!request) return;
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (message.error) request.reject(new JavaLspResponseError(message.error));
			else request.resolve(message.result);
		} else notifications.push(message);
	};
	function abort(reason) {
		stopped = reason;
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(reason);
		}
		pending.clear();
	}
	return {
		messages,
		notifications,
		receive,
		abort,
		receiveBytes(bytes) {
			framed = Buffer.concat([framed, bytes]);
			for (;;) {
				const headerEnd = framed.indexOf('\r\n\r\n');
				if (headerEnd < 0) return;
				assert.ok(headerEnd < 8192, 'Oversized original LSP header');
				const match = /(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i.exec(
					framed.subarray(0, headerEnd).toString('ascii')
				);
				assert.ok(match, 'Invalid original LSP stdout framing');
				const length = Number(match[1]);
				assert.ok(length <= 16 * 1024 * 1024, 'Oversized original LSP message');
				if (framed.length < headerEnd + 4 + length) return;
				const message = JSON.parse(
					framed.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
				);
				framed = framed.subarray(headerEnd + 4 + length);
				receive(message);
			}
		},
		notify(method, params) {
			return Promise.resolve().then(() => write({ method, params }));
		},
		request(method, params) {
			if (stopped) return Promise.reject(stopped);
			const id = ++sequence;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`${method} timed out after ${timeoutMs} ms`));
				}, timeoutMs);
				pending.set(id, { resolve, reject, timer });
				Promise.resolve()
					.then(() => write({ id, method, params }))
					.catch((error) => {
						clearTimeout(timer);
						pending.delete(id);
						reject(error);
					});
			});
		}
	};
}

export function encodeJavaLspMessage(message) {
	// The original stdin reader treats each byte as a character. JSON escapes
	// preserve the exact source string while using its supported ASCII wire form.
	const json = JSON.stringify(message).replace(
		/[\u007f-\uffff]/g,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
	);
	return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
}

export async function loadJavaTeavmFixture(profile = 'project') {
	assert.ok(['project', 'default-package'].includes(profile));
	const files = {};
	async function visit(directory, prefix = '') {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relative = `${prefix}${entry.name}`;
			if (entry.isDirectory()) await visit(path.join(directory, entry.name), `${relative}/`);
			else if (entry.name.endsWith('.java'))
				files[relative] = await readFile(path.join(directory, entry.name), 'utf8');
		}
	}
	await visit(path.join(JAVA_TEAVM_FIXTURE_DIRECTORY, profile));
	return files;
}

export function javaPositionAt(text, offset) {
	assert.ok(offset >= 0 && offset <= text.length, 'Invalid Java fixture offset');
	const preceding = text.slice(0, offset).split('\n');
	return { line: preceding.length - 1, character: preceding.at(-1).length };
}

export function normalizeJavaLspResult(value, projectUri) {
	if (typeof value === 'string') return value.replaceAll(projectUri, 'file:///workspace');
	if (Array.isArray(value))
		return value.map((entry) => normalizeJavaLspResult(entry, projectUri));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				normalizeJavaLspResult(key, projectUri),
				normalizeJavaLspResult(entry, projectUri)
			])
		);
	return value;
}

async function diagnosticsAfter(client, cursor, uri, predicate) {
	const started = Date.now();
	while (Date.now() - started < 30000) {
		const found = client.notifications
			.slice(cursor)
			.find(
				(message) =>
					message.method === 'textDocument/publishDiagnostics' &&
					message.params.uri === uri &&
					predicate(message.params.diagnostics)
			);
		if (found) return found.params;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Original javacs did not publish expected diagnostics for ${uri}`);
}

/** Genuine semantic replies, recorded once from unchanged upstream and compared by the browser. */
export async function exerciseJavaTeavmLsp(client, projectUri, options = {}) {
	const profile = options.profile || 'project';
	const files = options.files || (await loadJavaTeavmFixture(profile));
	const results = {};
	results.initialize = await client.request('initialize', {
		processId: null,
		rootUri: options.monacoInitialize ? null : projectUri,
		...(options.monacoInitialize
			? {}
			: { workspaceFolders: [{ uri: projectUri, name: 'original-javacs-acceptance' }] }),
		capabilities: {
			textDocument: {
				completion: { completionItem: { snippetSupport: true } },
				hover: { contentFormat: ['plaintext'] },
				publishDiagnostics: {}
			},
			workspace: { configuration: true, workspaceFolders: true }
		},
		initializationOptions: {}
	});
	assert.equal(results.initialize.capabilities.textDocumentSync, 2);
	await client.notify('initialized', {});
	const mainPath = profile === 'project' ? 'src/probe/Main.java' : 'Main.java';
	const text = files[mainPath];
	const uri = `${projectUri}/${mainPath}`;
	const textDocument = { uri };
	const baselineCursor = client.notifications.length;
	for (const [relative, contents] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
		await client.notify('textDocument/didOpen', {
			textDocument: {
				uri: `${projectUri}/${relative}`,
				languageId: 'java',
				version: 1,
				text: contents
			}
		});
	results.baselineDiagnostics = await diagnosticsAfter(
		client,
		baselineCursor,
		uri,
		(diagnostics) => diagnostics.length === 0
	);
	const at = (needle, shift = 0, last = false) => ({
		textDocument,
		position: javaPositionAt(
			text,
			(last ? text.lastIndexOf(needle) : text.indexOf(needle)) + shift
		)
	});
	results.localHover = await client.request('textDocument/hover', at('answer', 2, true));
	assert.match(JSON.stringify(results.localHover), /int answer/);
	if (profile === 'project') {
		results.methodHover = await client.request('textDocument/hover', at('doubleValue', 3));
		assert.match(JSON.stringify(results.methodHover), /doubleValue/);
		assert.match(JSON.stringify(results.methodHover), /Doubles a value/);
		results.definition = await client.request('textDocument/definition', at('doubleValue', 3));
		assert.match(JSON.stringify(results.definition), /Helper\.java/);
		results.completion = await client.request('textDocument/completion', at('Helper.', 7));
		const completion = results.completion.items.find((item) => item.label === 'doubleValue');
		assert.ok(completion, 'Original cross-file completion missing');
		results.completionResolve = await client.request('completionItem/resolve', completion);
		results.signatureHelp = await client.request('textDocument/signatureHelp', at('(21)', 2));
		assert.match(JSON.stringify(results.signatureHelp), /doubleValue/);
		results.references = await client.request('textDocument/references', {
			...at('doubleValue', 3),
			context: { includeDeclaration: true }
		});
		assert.ok(results.references.some((location) => location.uri === uri));
		results.prepareRename = await client.request(
			'textDocument/prepareRename',
			at('doubleValue', 3)
		);
		results.rename = await client.request('textDocument/rename', {
			...at('doubleValue', 3),
			newName: 'twice'
		});
		assert.equal(Object.keys(results.rename.changes).length, 2);
		results.documentSymbols = await client.request('textDocument/documentSymbol', {
			textDocument
		});
		results.workspaceSymbols = await client.request('workspace/symbol', { query: 'Helper' });
		results.foldingRanges = await client.request('textDocument/foldingRange', { textDocument });
		results.formatting = await client.request('textDocument/formatting', {
			textDocument,
			options: { tabSize: 4, insertSpaces: true }
		});
	} else {
		try {
			await client.request('textDocument/hover', at('doubleValue', 3));
			throw new Error('Expected original default-package method hover defect');
		} catch (error) {
			if (!(error instanceof JavaLspResponseError)) throw error;
			assert.equal(error.response.code, -32603);
			results.defaultPackageMethodHoverError = error.response;
		}
	}
	const typeOffset = text.indexOf('int answer');
	assert.ok(typeOffset >= 0);
	const typeStart = javaPositionAt(text, typeOffset);
	let cursor = client.notifications.length;
	await client.notify('textDocument/didChange', {
		textDocument: { uri, version: 2 },
		contentChanges: [
			{
				range: {
					start: typeStart,
					end: { ...typeStart, character: typeStart.character + 3 }
				},
				rangeLength: 3,
				text: 'String'
			}
		]
	});
	results.errorDiagnostics = await diagnosticsAfter(client, cursor, uri, (diagnostics) =>
		diagnostics.some((diagnostic) => diagnostic.code === 'compiler.err.prob.found.req')
	);
	assert.match(
		JSON.stringify(results.errorDiagnostics),
		/int cannot be converted to (java\.lang\.)?String/
	);
	cursor = client.notifications.length;
	await client.notify('textDocument/didChange', {
		textDocument: { uri, version: 3 },
		contentChanges: [
			{
				range: {
					start: typeStart,
					end: { ...typeStart, character: typeStart.character + 6 }
				},
				rangeLength: 6,
				text: 'int'
			}
		]
	});
	results.clearedDiagnostics = await diagnosticsAfter(
		client,
		cursor,
		uri,
		(diagnostics) => diagnostics.length === 0
	);
	results.hoverAfterEdit = await client.request('textDocument/hover', at('answer', 2, true));
	assert.deepEqual(results.hoverAfterEdit, results.localHover);
	results.shutdown = await client.request('shutdown', null);
	assert.equal(results.shutdown, null);
	await client.notify('exit', null);
	return normalizeJavaLspResult(results, projectUri);
}

async function javaSources(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory())
			files.push(...(await javaSources(path.join(directory, entry.name))));
		else if (entry.name.endsWith('.java')) files.push(path.join(directory, entry.name));
	}
	return files.sort();
}

export async function prepareOriginalNativeJavacs(options) {
	const source = path.resolve(options.sourceDirectory);
	const output = path.resolve(options.outputDirectory);
	const archive = await readFile(options.sourceArchive);
	assert.equal(archive.length, JAVACS_UPSTREAM.archiveBytes);
	assert.equal(hash(archive), JAVACS_UPSTREAM.archiveSha256);
	const verified = spawnSync(
		'python3',
		[
			'-c',
			`
import pathlib, sys, tarfile
root = pathlib.Path(sys.argv[2]).resolve()
expected = set()
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for entry in archive.getmembers():
        parts = pathlib.PurePosixPath(entry.name).parts[1:]
        if not parts: continue
        assert not any(p in ('..', '.') for p in parts)
        target = root.joinpath(*parts)
        assert not target.is_symlink() and target.resolve().is_relative_to(root)
        if entry.isdir():
            assert target.is_dir()
        else:
            assert entry.isfile()
            assert target.is_file() and target.read_bytes() == archive.extractfile(entry).read(), str(target)
            expected.add('/'.join(parts))
actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
assert actual == expected, 'Unexpected files in original javacs source'
`,
			options.sourceArchive,
			source
		],
		{ encoding: 'utf8' }
	);
	assert.equal(verified.status, 0, verified.stderr);
	const dependencies = path.join(output, 'dependencies');
	await mkdir(dependencies, { recursive: true });
	for (const dependency of DEPENDENCIES) {
		const filename = path.join(dependencies, path.basename(dependency.path));
		let bytes;
		try {
			bytes = await readFile(filename);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			const response = await fetch(
				`https://repo.maven.apache.org/maven2/${dependency.path}`,
				{
					signal: AbortSignal.timeout(60000)
				}
			);
			assert.ok(response.ok, `Original javacs dependency returned HTTP ${response.status}`);
			bytes = Buffer.from(await response.arrayBuffer());
			assert.equal(hash(bytes), dependency.sha256);
			await writeFile(filename, bytes);
		}
		assert.equal(hash(bytes), dependency.sha256);
	}
	const classes = path.join(output, 'classes');
	await mkdir(classes, { recursive: true });
	assert.equal((await readdir(classes)).length, 0, 'Native classes output must be empty');
	const classPath = DEPENDENCIES.map((dependency) =>
		path.join(dependencies, path.basename(dependency.path))
	).join(path.delimiter);
	const build = spawnSync(
		'javac',
		[
			'-J-Xmx768m',
			'-source',
			'13',
			'-target',
			'13',
			'-proc:none',
			'-cp',
			classPath,
			'-d',
			classes,
			...EXPORTS.flatMap((value) => ['--add-exports', value]),
			...(await javaSources(path.join(source, 'src/main/java')))
		],
		{ encoding: 'utf8', timeout: 60000 }
	);
	assert.equal(build.status, 0, build.stderr);
	const javaVersion = spawnSync('java', ['-version'], { encoding: 'utf8' });
	assert.equal(javaVersion.status, 0, javaVersion.stderr);
	return {
		classPath: [classes, classPath].join(path.delimiter),
		receipt: {
			upstream: JAVACS_UPSTREAM,
			originalSourceModifications: [],
			javaVersion: javaVersion.stderr.trim(),
			dependencies: DEPENDENCIES.map(({ path: filename, sha256 }) => ({
				file: path.basename(filename),
				sha256
			}))
		}
	};
}

export async function recordOriginalNativeJavaLsp(options) {
	const evidence = {
		schema: 'wasm-idle-original-javacs-native-v1',
		status: 'running',
		startedAt: new Date().toISOString(),
		runs: []
	};
	await mkdir(options.outputDirectory, { recursive: true });
	try {
		const native = await prepareOriginalNativeJavacs(options);
		evidence.inputs = native.receipt;
		for (const profile of ['project', 'default-package']) {
			const run = { profile, messages: [] };
			evidence.runs.push(run);
			const files = await loadJavaTeavmFixture(profile);
			const project = path.join(options.outputDirectory, profile);
			for (const [relative, text] of Object.entries(files)) {
				await mkdir(path.dirname(path.join(project, relative)), { recursive: true });
				await writeFile(path.join(project, relative), text);
			}
			const child = spawn(
				'java',
				[
					'-Xmx768m',
					...EXPORTS.flatMap((value) => ['--add-exports', value]),
					'--add-opens',
					'jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED',
					'-cp',
					native.classPath,
					'org.javacs.Main'
				],
				{ stdio: ['pipe', 'pipe', 'pipe'] }
			);
			let stderr = '';
			const client = createJavaTeavmLspClient(
				(message) => child.stdin.write(encodeJavaLspMessage(message)),
				{ messages: run.messages, timeoutMs: options.timeoutMs }
			);
			child.stdout.on('data', client.receiveBytes);
			child.stderr.on('data', (bytes) => {
				stderr = (stderr + bytes.toString()).slice(-60000);
			});
			const exited = new Promise((resolve) =>
				child.once('exit', (code, signal) => {
					run.exit = { code, signal };
					client.abort(new Error(`Native original javacs exited ${code ?? signal}`));
					resolve();
				})
			);
			try {
				run.results = await exerciseJavaTeavmLsp(client, pathToFileURL(project).href, {
					profile,
					files
				});
				await Promise.race([
					exited,
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error('Original javacs did not exit after shutdown')),
							5000
						)
					)
				]);
				assert.equal(run.exit.code, 0);
			} finally {
				if (child.exitCode === null) child.kill('SIGTERM');
				run.stderr = stderr;
			}
		}
		evidence.status = 'passed';
		return evidence;
	} catch (error) {
		evidence.status = 'failed';
		evidence.error = String(error.stack || error);
		throw error;
	} finally {
		evidence.completedAt = new Date().toISOString();
		await writeFile(
			path.join(options.outputDirectory, 'native-evidence.json'),
			`${JSON.stringify(evidence, null, 2)}\n`
		);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			'source-directory': { type: 'string', default: '.cache/javacs-teavm/javacs' },
			'source-archive': {
				type: 'string',
				default: '.cache/javacs-teavm/downloads/javacs.tar.gz'
			},
			'output-directory': { type: 'string', default: '.cache/java-teavm-acceptance/native' },
			'timeout-ms': { type: 'string', default: '30000' },
			'write-fixtures': { type: 'boolean', default: false }
		}
	});
	const timeoutMs = Number(values['timeout-ms']);
	assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000);
	const evidence = await recordOriginalNativeJavaLsp({
		sourceDirectory: path.resolve(values['source-directory']),
		sourceArchive: path.resolve(values['source-archive']),
		outputDirectory: path.resolve(values['output-directory']),
		timeoutMs
	});
	if (values['write-fixtures']) {
		const oracle = {
			schema: 'wasm-idle-original-javacs-semantic-oracle-v1',
			inputs: evidence.inputs,
			profiles: Object.fromEntries(evidence.runs.map((run) => [run.profile, run.results]))
		};
		await writeFile(
			path.join(JAVA_TEAVM_FIXTURE_DIRECTORY, 'native-oracle.json'),
			`${JSON.stringify(oracle, null, 2)}\n`
		);
	}
	console.log(
		JSON.stringify({
			status: evidence.status,
			profiles: evidence.runs.map(({ profile }) => profile)
		})
	);
}
