import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { fork, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { createReleasePreviewSecurityHeaders } from './content-security-policy.mjs';
import { exerciseReScriptServer, RESCRIPT_REFERENCE_FILES } from './rescript-lsp-protocol.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP === '1';

function rpc(send) {
	let id = 0;
	const pending = new Map(),
		diagnostics = [],
		waiters = [];
	const handle = (message) => {
		if (message.method === 'textDocument/publishDiagnostics') {
			diagnostics.push(message.params);
			for (let i = 0; i < waiters.length;) {
				if (waiters[i].predicate(message.params)) {
					waiters.splice(i, 1)[0].resolve(message.params);
				} else i++;
			}
		} else if (message.method && message.id !== undefined)
			send({
				jsonrpc: '2.0',
				id: message.id,
				result: message.method === 'workspace/configuration' ? [{}] : null
			});
		else if (message.id !== undefined && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
		}
	};
	return {
		handle,
		request: (method, params) =>
			new Promise((resolve, reject) => {
				const value = ++id,
					timer = setTimeout(
						() => reject(Error('Original ReScript request timeout: ' + method)),
						30000
					);
				pending.set(value, (message) => {
					clearTimeout(timer);
					if (message.error) reject(Error(JSON.stringify(message.error)));
					else resolve(message.result);
				});
				send({ jsonrpc: '2.0', id: value, method, params });
			}),
		notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
		waitForDiagnostics: (predicate) =>
			new Promise((resolve, reject) => {
				const timer = setTimeout(
					() =>
						reject(
							Error(
								'Original ReScript diagnostics timeout: ' +
									JSON.stringify(diagnostics.slice(-3))
							)
						),
					30000
				);
				waiters.push({
					predicate,
					resolve: (value) => {
						clearTimeout(timer);
						resolve(value);
					}
				});
			})
	};
}

async function nativeReference() {
	const cache = path.join(ROOT, '.cache/rescript-lsp-producer');
	const compiler = path.join(cache, 'sources/compiler'),
		buildDir = path.join(cache, 'ocaml-build');
	const opamRoot = process.env.WASM_IDLE_RESCRIPT_LSP_OPAM_ROOT || path.join(cache, 'opam'),
		switchName = process.env.WASM_IDLE_RESCRIPT_LSP_OPAM_SWITCH || 'rescript-lsp';
	const result = spawnSync(
		'opam',
		[
			'exec',
			'--',
			'dune',
			'build',
			'--build-dir',
			buildDir,
			'--profile',
			'release',
			'-j2',
			'compiler/bsc/rescript_compiler_main.exe',
			'analysis/bin/main.exe'
		],
		{
			cwd: compiler,
			env: { ...process.env, OPAMROOT: opamRoot, OPAMSWITCH: switchName },
			stdio: 'inherit'
		}
	);
	assert.equal(result.status, 0, 'original native compiler/reference build');
	const native = path.join(cache, 'native');
	await mkdir(path.join(native, 'server/out'), { recursive: true });
	await mkdir(path.join(native, 'bin'), { recursive: true });
	for (const [name, source] of [
		['bsc.exe', 'compiler/bsc/rescript_compiler_main.exe'],
		['rescript-editor-analysis.exe', 'analysis/bin/main.exe']
	])
		await symlink(path.join(buildDir, 'default', source), path.join(native, 'bin', name)).catch(
			(error) => {
				if (error.code !== 'EEXIST') throw error;
			}
		);
	await writeFile(path.join(native, 'server/package.json'), '{"version":"1.74.0"}');
	const cli = path.join(native, 'server/out/cli.cjs');
	await build({
		entryPoints: [path.join(cache, 'sources/server/server/src/cli.ts')],
		outfile: cli,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node22',
		nodePaths: [path.join(ROOT, 'producers/rescript-language-server/node_modules')],
		tsconfigRaw: { compilerOptions: { target: 'ES2022' } }
	});
	const workspace = await mkdtemp(path.join(cache, 'reference-')),
		output = path.join(workspace, 'lib/bs');
	await mkdir(output, { recursive: true });
	const runtime = await realpath(
		path.join(ROOT, 'producers/rescript-language-server/node_modules/@rescript/runtime')
	);
	const bsc = path.join(native, 'bin/bsc.exe');
	await writeFile(
		path.join(workspace, 'rescript.json'),
		'{"name":"browser-project","sources":[{"dir":".","subdirs":false}],"uncurried":true}'
	);
	await writeFile(
		path.join(output, 'build.ninja'),
		`rule astj\n  command = ${bsc} -bs-ast $i\nrule mij\n  command = ${bsc} $i -I ${runtime}/lib/ocaml -I ${output} -bs-g -uncurried -bs-package-name browser-project\n`
	);
	for (const file of RESCRIPT_REFERENCE_FILES) {
		await writeFile(path.join(workspace, file.path), file.content);
		const compiled = spawnSync(
			bsc,
			[
				'-I',
				path.join(runtime, 'lib/ocaml'),
				'-I',
				output,
				'-bs-g',
				'-uncurried',
				'-bs-package-name',
				'browser-project',
				'-o',
				path.join(
					output,
					file.path.replace(/\.resi?$/, file.path.endsWith('.resi') ? '.cmi' : '.cmj')
				),
				path.join(workspace, file.path)
			],
			{ cwd: workspace, encoding: 'utf8', env: { ...process.env, RESCRIPT_RUNTIME: runtime } }
		);
		assert.equal(compiled.status, 0, compiled.stderr);
	}
	const child = fork(cli, ['--node-ipc'], {
		cwd: workspace,
		stdio: ['ignore', 'ignore', 'pipe', 'ipc']
	});
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr = (stderr + chunk).slice(-16384);
	});
	const client = rpc((message) => child.send(message));
	child.on('message', client.handle);
	const exit = new Promise((resolve) => child.on('exit', resolve));
	try {
		const result = await exerciseReScriptServer({
			...client,
			rootUri: pathToFileURL(workspace).href,
			platformPath: path.join(native, 'bin'),
			runtimePath: runtime
		});
		assert.equal(await exit, 0, stderr);
		const normalize = (value) =>
			typeof value === 'string'
				? value
						.replaceAll(
							pathToFileURL(runtime).href,
							'file:///workspace/node_modules/@rescript/runtime'
						)
						.replaceAll(runtime, '/workspace/node_modules/@rescript/runtime')
						.replaceAll(pathToFileURL(workspace).href, 'file:///workspace')
						.replaceAll(workspace, '/workspace')
				: Array.isArray(value)
					? value.map(normalize)
					: value && typeof value === 'object'
						? Object.fromEntries(
								Object.entries(value).map(([key, item]) => [
									normalize(key),
									normalize(item)
								])
							)
						: value;
		return normalize(result);
	} finally {
		if (child.exitCode === null) child.kill();
	}
}

test(
	'original ReScript server, compiler and analysis match native in strict Chromium',
	{ skip: !enabled, timeout: 300000 },
	async () => {
		const reference = await nativeReference();
		const clientSource = `import {getReScriptLanguageServer} from './packages/lsp/src/rescript/language-server.ts';import {exerciseReScriptServer,RESCRIPT_REFERENCE_FILES} from './scripts/rescript-lsp-protocol.mjs';import {createMessageConnection,CancellationTokenSource} from 'vscode-jsonrpc/browser';export async function run(){const handle=await getReScriptLanguageServer({rootUrl:location.origin+'/',rescript:{workspaceFiles:RESCRIPT_REFERENCE_FILES},persistentCache:{enabled:false}});const connection=createMessageConnection(handle.transport.reader,handle.transport.writer);const notifications=[],waiters=[];connection.onRequest('workspace/configuration',()=>[{}]);connection.onRequest('client/registerCapability',()=>null);connection.onRequest('window/showMessageRequest',()=>null);connection.onNotification('textDocument/publishDiagnostics',params=>{notifications.push(params);for(let i=0;i<waiters.length;){if(waiters[i].predicate(params))waiters.splice(i,1)[0].resolve(params);else i++;}});connection.listen();const early=connection.sendRequest('textDocument/hover',{textDocument:{uri:'file:///workspace/main.res'},position:{line:0,character:5}});const token=new CancellationTokenSource();const cancelled=connection.sendRequest('textDocument/documentSymbol',{textDocument:{uri:'file:///workspace/main.res'}},token.token).then(()=>{throw Error('Cancelled pre-open request unexpectedly completed')},error=>error.code);token.cancel();const client={request:(m,p)=>connection.sendRequest(m,p),notify:(m,p)=>connection.sendNotification(m,p),waitForDiagnostics:predicate=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('diagnostics timeout '+JSON.stringify(notifications.slice(-3)))),30000);waiters.push({predicate,resolve:value=>{clearTimeout(timer);resolve(value)}})})};try{const result=await exerciseReScriptServer(client);return {result,early:await early,cancelled:await cancelled}}finally{connection.dispose();handle.dispose();handle.dispose();}}`;
		const client = await build({
			stdin: {
				contents: clientSource,
				resolveDir: ROOT,
				sourcefile: 'rescript-browser-client.ts'
			},
			alias: {
				'vscode-jsonrpc/browser': path.join(
					ROOT,
					'packages/lsp/node_modules/vscode-jsonrpc/lib/browser/main.js'
				)
			},
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'browser',
			target: 'es2022',
			tsconfigRaw: { compilerOptions: { target: 'ES2022' } }
		});
		const worker = await build({
			entryPoints: [path.join(ROOT, 'packages/lsp/src/rescript/worker.ts')],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'browser',
			target: 'es2022',
			tsconfigRaw: { compilerOptions: { target: 'ES2022' } }
		});
		const errors = [];
		const server = createServer(async (req, res) => {
			for (const [key, value] of Object.entries(createReleasePreviewSecurityHeaders(true)))
				res.setHeader(key, value);
			try {
				const url = new URL(req.url, 'http://localhost');
				if (url.pathname === '/') {
					res.setHeader('Content-Type', 'text/html');
					res.end('<!doctype html><title>Original ReScript LSP</title>');
				} else if (url.pathname === '/client.mjs') {
					res.setHeader('Content-Type', 'text/javascript');
					res.end(client.outputFiles[0].contents);
				} else if (url.pathname.endsWith('/worker.js')) {
					res.setHeader('Content-Type', 'text/javascript');
					res.end(worker.outputFiles[0].contents);
				} else if (/^\/wasm-rescript-lsp\/[A-Za-z0-9_.-]+$/.test(url.pathname)) {
					res.setHeader('Content-Type', 'application/octet-stream');
					res.end(await readFile(path.join(ROOT, 'static', url.pathname)));
				} else {
					res.writeHead(404);
					res.end();
				}
			} catch {
				res.writeHead(500);
				res.end();
			}
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const origin = 'http://127.0.0.1:' + server.address().port;
		let browser;
		try {
			browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable('')
			});
			const context = await browser.newContext();
			await addBrowserTestCookies(context, origin);
			const page = await context.newPage();
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto(origin);
			const outcome = await page.evaluate(async () => {
				const { run } = await import('/client.mjs');
				return run();
			});
			const { result, early, cancelled } = outcome;
			assert.deepEqual(early, result.hover);
			assert.equal(cancelled, -32800);
			await writeFile(
				path.join(ROOT, '.cache/rescript-lsp-browser-evidence.json'),
				JSON.stringify({ reference, result }, null, 2)
			);
			assert.match(result.hover.contents.value, /int/);
			assert.match(result.definition.uri, /Greeting\.resi?$/);
			assert.match(result.stdlibDefinition.uri, /Stdlib_Int\.resi?$/);
			assert.ok(result.completion.some((item) => item.label === 'message'));
			assert.equal(result.references.length, 2);
			assert.equal(result.rename.documentChanges.flatMap((change) => change.edits).length, 2);
			assert.equal(result.error.diagnostics.length, 1);
			assert.equal(result.cleared.diagnostics.length, 0);
			assert.deepEqual(result, reference);
			assert.deepEqual(errors, []);
			await writeFile(
				path.join(ROOT, '.cache/rescript-lsp-browser-evidence.json'),
				JSON.stringify({ reference, result }, null, 2)
			);
		} finally {
			await browser?.close();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		}
	}
);
