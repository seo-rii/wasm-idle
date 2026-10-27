#!/usr/bin/env node
// Real Zig frontend -> browser Clang/LLD -> LLDB/WAMR, through the public binding.
// Assets must be prepared with the normal consumer sync commands first.
// Usage: node scripts/zig-debug-browser-smoke.mjs [zig-assets] [clang-assets] [debug-assets]
// Set WASM_IDLE_ZIG_DEBUG_CONTAINER_ASSETS to a prepared static/container-app directory
// to exercise the application owner and nested Worker transport.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createCoreSourceAliasMap } from './core-source-aliases.mjs';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

if (process.argv.length > 5) {
	throw new Error(
		'Usage: zig-debug-browser-smoke.mjs [zig-assets] [clang-assets] [debug-assets]'
	);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const zigAssets = path.resolve(process.argv[2] || path.join(root, 'static/wasm-zig'));
const clangAssets = path.resolve(process.argv[3] || path.join(root, 'static/clang'));
const debugAssets = path.resolve(process.argv[4] || path.join(root, 'static/wasm-debug'));
const containerAssets = process.env.WASM_IDLE_ZIG_DEBUG_CONTAINER_ASSETS
	? path.resolve(process.env.WASM_IDLE_ZIG_DEBUG_CONTAINER_ASSETS)
	: undefined;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zig-debug-browser-'));
const requests = [];
const browserMessages = [];
const rawDapEvents = [];
const probeStages = [];
const inspectExceptions = process.env.WASM_IDLE_ZIG_DEBUG_INSPECT_EXCEPTIONS === '1';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
let browser;
let server;
let watchdog;
let evidenceWritten = false;

const source = String.raw`const std = @import("std");
const arithmetic = @import("nested/arithmetic.zig");
pub fn main(init: std.process.Init) !void {
    var input_buffer: [128]u8 = undefined;
    var input_reader = std.Io.File.stdin().reader(init.io, &input_buffer);
    const line = try input_reader.interface.takeDelimiterExclusive('\n');
    const input = try std.fmt.parseInt(i32, line, 10);
    const result = arithmetic.addFive(input); // breakpoint
    const numerator = @as(u128, @intCast(input)) << 64;
    const quotient = numerator / @as(u128, 3);
    var output_buffer: [128]u8 = undefined;
    var output_writer = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output_writer.interface.print("result={d};quotient={d}\n", .{result, quotient});
    try output_writer.interface.flush();
}
`;
const helper = `pub noinline fn addFive(input: i32) i32 {
    var result = input;
    result += 5; // initialized-result
    var wide: i64 = @as(i64, input) * -12884901888; // added-result
    wide -= 5;
    var unsigned: u64 = @as(u64, @intCast(input)) << 40;
    unsigned += 9;
    _ = &wide;
    _ = &unsigned;
    return result; // initialized-widths
}
`;
const markerLine = (code, marker) =>
	code.split('\n').findIndex((line) => line.includes(marker)) + 1;
const breakpointLine = markerLine(source, '// breakpoint');
const initializedResultLine = markerLine(helper, '// initialized-result');
const addedResultLine = markerLine(helper, '// added-result');
const initializedWidthsLine = markerLine(helper, '// initialized-widths');

try {
	const zigReceipt = JSON.parse(
		await readFile(path.join(zigAssets, 'runtime-build.json'), 'utf8')
	);
	assert.match(zigReceipt.profileId, /0\.17\.0/, 'This probe requires the Zig 0.17.0 bundle');
	const debugManifestBytes = await readFile(path.join(debugAssets, 'runtime-manifest.v2.json'));
	const debugManifestSha256 = digest(debugManifestBytes);
	const containerPackage = JSON.parse(
		await readFile(path.join(root, 'packages/container/package.json'), 'utf8')
	);
	const containerAliases = Object.fromEntries(
		Object.entries(containerPackage.exports)
			.filter(([name]) => name !== './package.json')
			.map(([name, entry]) => [
				`@wasm-idle/container${name === '.' ? '' : name.slice(1)}`,
				path.join(
					root,
					'packages/container',
					entry.import.replace('./dist/', './src/').replace(/\.js$/, '.ts')
				)
			])
	);
	const sourceResolver = {
		name: 'zig-debug-public-binding',
		setup(context) {
			context.onLoad(
				{ filter: /runtime\/debug\/src\/session\.ts$/ },
				async ({ path: filename }) => {
					let contents = await readFile(filename, 'utf8');
					const before = 'return new BrowserLldbSession(options);';
					if (contents.split(before).length !== 2)
						throw new Error('LLDB observation boundary changed');
					// Observe genuine DAP events without changing source maps, artifacts or control flow.
					const after = `const session = new BrowserLldbSession(options);
+const report = (value: unknown) => { void fetch(new URL('/__zig-debug-dap',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}); };
+session.onEvent(event => {
+  if(event.event !== 'stopped') return;
+  report({kind:'stopped',event});
+  if(${inspectExceptions} && (event.body as any)?.reason === 'exception') {
+    void session.request('exceptionInfo',{threadId:(event.body as any).threadId}).then(body=>report({kind:'exceptionInfo',body}),error=>report({kind:'exceptionInfo-error',error:String(error)}));
+  }
+});
+return session;`.replaceAll('\n+', '\n');
					return { contents: contents.replace(before, after), loader: 'ts' };
				}
			);
			context.onResolve({ filter: /^zig-debug-client$/ }, () => ({
				path: 'zig-debug-client',
				namespace: 'zig-debug-client'
			}));
			context.onLoad({ filter: /.*/, namespace: 'zig-debug-client' }, () => ({
				contents: `import Zig from ${JSON.stringify(path.join(root, 'src/lib/playground/zig.ts'))};
import { createPlaygroundBinding } from '@wasm-idle/core';
export {BUNDLED_CLANG_ASSET_INTEGRITY as clangIntegrity} from ${JSON.stringify(path.join(root, 'src/lib/playground/clangAssetIntegrity.ts'))};
export default function(assets) {
  return createPlaygroundBinding(assets, async language => {
    if (language !== 'ZIG') throw new Error('This probe only loads Zig');
    return new Zig();
  });
}`,
				loader: 'js',
				resolveDir: root
			}));
			context.onResolve({ filter: /^zig-container-(client|owner)$/ }, ({ path: name }) => ({
				path: name,
				namespace: name
			}));
			context.onLoad({ filter: /.*/, namespace: 'zig-container-client' }, () => ({
				contents: `import {createContainerPlaygroundBinding} from ${JSON.stringify(path.join(root, 'src/lib/container/binding.ts'))};
export {clangIntegrity} from 'zig-debug-client';
export default assets => createContainerPlaygroundBinding(assets, {
  applicationRootURL:location.origin+'/', workspaceId:'zig-debug-acceptance',
  workerFactory:()=>new Worker(new URL('./container-owner.js',import.meta.url),{type:'module'})
});`,
				loader: 'js',
				resolveDir: root
			}));
			context.onLoad({ filter: /.*/, namespace: 'zig-container-owner' }, () => ({
				// Keep the application's real owner, runtime adapter, VFS and SDK profile.
				// The injected registry admits only the language exercised by this fixture.
				contents: `import {serveContainerWorker} from ${JSON.stringify(path.join(root, 'src/lib/container/owner-worker.ts'))};
import {createWebsiteBashConfiguration} from ${JSON.stringify(path.join(root, 'src/lib/playground/container/release.ts'))};
import {BUSYBOX_SHELL_COMMANDS} from ${JSON.stringify(path.join(root, 'runtimes/wasm-busybox/commands.mjs'))};
import createBinding from 'zig-debug-client';
serveContainerWorker({languages:['ZIG'],createBinding,createBashConfiguration:createWebsiteBashConfiguration,shellCommands:BUSYBOX_SHELL_COMMANDS});`,
				loader: 'js',
				resolveDir: root
			}));
			context.onResolve({ filter: /\/worker\/zig\?worker$/ }, () => ({
				path: 'zig-debug-worker-constructor',
				namespace: 'zig-debug-worker-constructor'
			}));
			context.onLoad({ filter: /.*/, namespace: 'zig-debug-worker-constructor' }, () => ({
				// Vite's ?worker wrapper; the production Worker implementation is bundled below.
				contents: `export default class extends Worker {
  constructor() {
    super(new URL('./zig-worker.js', import.meta.url), {type:'module'});
    this.addEventListener('message',({data})=>{
      const artifact=data?.lldbArtifact;
      if(!artifact)return;
      void fetch(new URL('/__zig-debug-artifact',import.meta.url),{method:'POST',body:Uint8Array.from(new Uint8Array(artifact.bytes)),headers:{'X-Zig-Module-Sha256':artifact.descriptor?.moduleSha256 || ''}});
      void fetch(new URL('/__zig-debug-artifact-metadata',import.meta.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({descriptor:artifact.descriptor,sources:artifact.sources})});
    });
  }
}`,
				loader: 'js'
			}));
		}
	};
	await build({
		absWorkingDir: root,
		entryPoints: {
			client: 'zig-debug-client',
			...(containerAssets
				? {
						'container-client': 'zig-container-client',
						'container-owner': 'zig-container-owner'
					}
				: {}),
			'zig-worker': path.join(root, 'src/lib/playground/worker/zig.ts'),
			'worker/lldb-worker': path.join(
				root,
				'packages/llvm-core/runtime/debug/src/worker/lldb-worker.ts'
			),
			'worker/target-worker': path.join(
				root,
				'packages/llvm-core/runtime/debug/src/worker/target-worker.ts'
			)
		},
		outdir: temporary,
		bundle: true,
		platform: 'browser',
		format: 'esm',
		target: 'es2022',
		alias: {
			$lib: path.join(root, 'src/lib'),
			'@wasm-idle/llvm-core/core': path.join(root, 'packages/llvm-core/runtime/core/src'),
			'@wasm-idle/llvm-core/clang': path.join(
				root,
				'packages/llvm-core/runtime/clang/src/index.ts'
			),
			'@wasm-idle/llvm-core/debug': path.join(
				root,
				'packages/llvm-core/runtime/debug/src/index.ts'
			),
			'@wasm-idle/llvm-core': path.join(root, 'packages/llvm-core/runtime/core/src/index.ts'),
			...containerAliases,
			...createCoreSourceAliasMap(root)
		},
		plugins: [sourceResolver],
		tsconfigRaw: { compilerOptions: { target: 'ES2022', useDefineForClassFields: true } },
		logLevel: 'warning'
	});
	server = createServer(async (request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		try {
			const pathname = new URL(request.url, 'http://localhost').pathname;
			requests.push(pathname);
			if (
				request.method === 'POST' &&
				[
					'/__zig-debug-artifact',
					'/__zig-debug-artifact-metadata',
					'/__zig-debug-dap'
				].includes(pathname)
			) {
				const chunks = [];
				let total = 0;
				const limit =
					pathname === '/__zig-debug-artifact' ? 32 * 1024 * 1024 : 2 * 1024 * 1024;
				for await (const chunk of request) {
					total += chunk.length;
					if (total > limit)
						throw new Error('Probe observation exceeded its byte budget');
					chunks.push(chunk);
				}
				const bytes = Buffer.concat(chunks);
				if (pathname === '/__zig-debug-artifact') {
					assert.equal(
						digest(bytes),
						request.headers['x-zig-module-sha256'],
						'Observed artifact must preserve producer bytes'
					);
					if (process.env.WASM_IDLE_ZIG_DEBUG_RESULT)
						await writeFile(`${process.env.WASM_IDLE_ZIG_DEBUG_RESULT}.wasm`, bytes, {
							mode: 0o600
						});
				} else if (pathname === '/__zig-debug-artifact-metadata') {
					JSON.parse(bytes.toString('utf8'));
					if (process.env.WASM_IDLE_ZIG_DEBUG_RESULT)
						await writeFile(
							`${process.env.WASM_IDLE_ZIG_DEBUG_RESULT}.artifact.json`,
							bytes,
							{ mode: 0o600 }
						);
				} else {
					rawDapEvents.push(JSON.parse(bytes.toString('utf8')));
					if (rawDapEvents.length > 128)
						throw new Error('Probe exceeded DAP observation budget');
					if (process.env.WASM_IDLE_ZIG_DEBUG_RESULT)
						await writeFile(
							`${process.env.WASM_IDLE_ZIG_DEBUG_RESULT}.dap.json`,
							`${JSON.stringify(rawDapEvents, null, 2)}\n`,
							{ mode: 0o600 }
						);
				}
				response.writeHead(204);
				response.end();
				return;
			}
			if (pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><title>Zig source debugger qualification</title>');
				return;
			}
			if (pathname === '/favicon.ico') {
				response.writeHead(204);
				response.end();
				return;
			}
			let filename;
			if (
				[
					'/client.js',
					'/zig-worker.js',
					'/container-client.js',
					'/container-owner.js',
					'/worker/lldb-worker.js',
					'/worker/target-worker.js'
				].includes(pathname)
			) {
				filename = path.join(temporary, pathname.slice(1));
			} else {
				for (const [prefix, directory] of [
					['/wasm-zig/', zigAssets],
					['/clang/', clangAssets],
					['/wasm-debug/', debugAssets],
					...(containerAssets ? [['/container-app/', containerAssets]] : [])
				]) {
					if (!pathname.startsWith(prefix)) continue;
					const relative = pathname.slice(prefix.length);
					if (
						!relative ||
						relative.split('/').some((part) => part === '..' || part === '.')
					) {
						throw new Error('Invalid fixture asset path');
					}
					filename = path.join(directory, relative);
					break;
				}
			}
			if (!filename) {
				response.writeHead(404);
				response.end();
				return;
			}
			let bytes;
			try {
				bytes = await readFile(filename);
			} catch (error) {
				if (error.code !== 'ENOENT' || !filename.endsWith('/zig_small.wasm')) throw error;
				bytes = await readFile(`${filename}.gz`);
				response.setHeader('Content-Encoding', 'gzip');
			}
			response.setHeader(
				'Content-Type',
				/\.(js|mjs)$/.test(filename)
					? 'text/javascript'
					: filename.endsWith('.wasm')
						? 'application/wasm'
						: filename.endsWith('.json')
							? 'application/json'
							: 'application/octet-stream'
			);
			response.setHeader('Content-Length', bytes.byteLength);
			response.end(bytes);
		} catch (error) {
			response.writeHead(error.code === 'ENOENT' ? 404 : 500);
			response.end(String(error));
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		)
	});
	const page = await browser.newPage();
	page.setDefaultTimeout(90_000);
	await page.exposeFunction('__zigDebugStage', (stage) => {
		probeStages.push(stage);
		if (process.env.WASM_IDLE_ZIG_DEBUG_RESULT)
			writeFileSync(
				`${process.env.WASM_IDLE_ZIG_DEBUG_RESULT}.stage.json`,
				`${JSON.stringify({ latest: stage, history: probeStages.slice(-64) })}\n`,
				{ mode: 0o600 }
			);
	});
	page.on('console', (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
	page.on('pageerror', (error) => browserMessages.push(`pageerror: ${error.message}`));
	// Isolated loopback fixture, without a protected origin or WAF.
	await page.goto(origin);
	const evaluated = page.evaluate(
		async ({
			source,
			helper,
			debugManifestSha256,
			breakpointLine,
			initializedWidthsLine,
			container
		}) => {
			const reportStage = (stage) => globalThis.__zigDebugStage({ stage, at: Date.now() });
			let lastProgressStage = '';
			const progress = {
				set() {},
				report(event) {
					if (event.stage && event.stage !== lastProgressStage) {
						lastProgressStage = event.stage;
						void reportStage(`progress:${event.stage}:${event.message || ''}`);
					}
				}
			};
			const { default: createZigBinding, clangIntegrity } = await import(
				container ? '/container-client.js' : '/client.js'
			);
			if (!crossOriginIsolated)
				throw new Error('Debugger fixture requires cross-origin isolation');
			const binding = createZigBinding({
				rootUrl: location.origin,
				persistentCache: false,
				clang: { baseUrl: `${location.origin}/clang/`, integrity: clangIntegrity },
				debug: {
					baseUrl: `${location.origin}/wasm-debug/`,
					manifestUrl: `${location.origin}/wasm-debug/runtime-manifest.v2.json`,
					manifestSha256: debugManifestSha256
				}
			});
			const runtime = await binding.load('ZIG');
			const runs = [];
			const terminalCases = [];
			const options = {
				debugMode: 'lldb',
				pauseOnEntry: true,
				activePath: 'solution.zig',
				workspaceFiles: [{ path: 'nested/arithmetic.zig', content: helper }],
				breakpoints: [breakpointLine],
				stdin: '7\n',
				limits: { compileTimeoutMs: 300_000, runTimeoutMs: 90_000 }
			};
			async function execute(cancel) {
				await reportStage(`run:${runs.length}:${cancel ? 'cancel' : 'debug'}:start`);
				const started = performance.now();
				const record = {
					cancel,
					output: '',
					events: [],
					snapshots: [],
					outcome: null,
					error: ''
				};
				runs.push(record);
				const pending = [];
				const pauses = [];
				runtime.output = (chunk) => (record.output += chunk);
				runtime.ondebug = (event) => {
					if (
						event.type === 'pause' ||
						event.type === 'breakpoints' ||
						event.type === 'start'
					) {
						record.events.push(event);
					} else if (event.type === 'pauseDetails') {
						const prior = record.events.find(
							(value) => value.type === 'pause' && value.stopId === event.stopId
						);
						if (prior) Object.assign(prior, event, { type: 'pause' });
					} else {
						record.events.push({ type: event.type });
					}
					if (event.type !== 'pause') return;
					void reportStage({
						kind: 'pause',
						run: runs.length - 1,
						reason: event.reason,
						stoppedReason: event.stoppedReason,
						path: event.sourcePath,
						line: event.line,
						callStack: event.callStack
					});
					if (pending.length) pending.shift()(event);
					else pauses.push(event);
				};
				const finished = runtime.run(source, false, false, progress, [], options).then(
					(value) => {
						void reportStage(`run:${runs.length - 1}:finished`);
						record.outcome = { completed: value };
						return record.outcome;
					},
					(error) => {
						void reportStage(`run:${runs.length - 1}:failed:${String(error)}`);
						record.outcome = { error: String(error) };
						return record.outcome;
					}
				);
				async function nextPause() {
					if (pauses.length) return pauses.shift();
					let timer;
					try {
						return await Promise.race([
							new Promise((resolve, reject) => {
								timer = setTimeout(
									() => reject(new Error('Timed out awaiting Zig pause')),
									90_000
								);
								pending.push(resolve);
							}),
							finished.then((outcome) => {
								throw new Error(
									`Zig run finished before its next pause: ${JSON.stringify(outcome)}`
								);
							})
						]);
					} finally {
						clearTimeout(timer);
					}
				}
				async function snapshot(event) {
					const variables = [];
					// The first milestone qualifies scalar locals in the helper, not stdlib struct formatting.
					for (const scope of event.sourcePath === '/workspace/nested/arithmetic.zig'
						? await runtime.debugScopes(event.frameId)
						: []) {
						if (scope.expensive || !['Locals', 'Arguments'].includes(scope.name))
							continue;
						for (const variable of await runtime.debugVariables(
							scope.variablesReference
						)) {
							variables.push({
								name: variable.name,
								value: variable.value,
								type: variable.type
							});
						}
					}
					const value = {
						line: event.line,
						reason: event.reason,
						sourcePath: event.sourcePath,
						sourceContentSha256: event.sourceContentSha256,
						callStack: event.callStack.slice(0, 8),
						variables
					};
					record.snapshots.push(value);
					return value;
				}
				async function command(value) {
					const paused = nextPause();
					await runtime.debugCommand(value);
					return snapshot(await paused);
				}
				try {
					await snapshot(await nextPause());
					if (cancel) {
						await runtime.terminate();
						await finished;
						return record;
					}
					await command('continue');
					let current = await command('stepInto');
					for (let step = 0; step < 20; step++) {
						if (
							current.sourcePath === '/workspace/nested/arithmetic.zig' &&
							current.line >= initializedWidthsLine
						) {
							break;
						}
						current = await command('nextLine');
					}
					await command('stepOut');
					await runtime.debugCommand('continue');
					await finished;
					return record;
				} catch (error) {
					record.error = String(error);
					await runtime.terminate();
					await finished;
					return record;
				} finally {
					record.durationMs = Math.round(performance.now() - started);
				}
			}
			async function terminalCase(name, code, trap) {
				await reportStage(`case:${name}:start`);
				if (binding.syncWorkspace)
					await binding.syncWorkspace('ZIG', [{ path: name, content: code }]);
				const record = {
					name,
					trap,
					output: '',
					events: [],
					outcome: null,
					settledBeforeCancel: false
				};
				terminalCases.push(record);
				let resolvePause;
				const paused = new Promise((resolve) => {
					resolvePause = resolve;
				});
				runtime.output = (chunk) => (record.output += chunk);
				runtime.ondebug = (event) => {
					record.events.push(event);
					if (event.type === 'pause') resolvePause(event);
				};
				let settled = false;
				const finished = runtime
					.run(code, false, false, progress, [], {
						...options,
						activePath: name,
						workspaceFiles: [],
						breakpoints: [],
						pauseOnEntry: false,
						stdin: ''
					})
					.then(
						(completed) => {
							settled = true;
							record.outcome = { completed };
							return record.outcome;
						},
						(error) => {
							settled = true;
							record.outcome = { error: String(error) };
							return record.outcome;
						}
					);
				if (trap) {
					let timer;
					try {
						record.pause = await Promise.race([
							paused,
							finished.then((value) => {
								throw new Error(
									`@trap finished without a real pause: ${JSON.stringify(value)}`
								);
							}),
							new Promise((_, reject) => {
								timer = setTimeout(
									() =>
										reject(new Error('Timed out waiting for genuine Zig trap')),
									90_000
								);
							})
						]);
						await new Promise((resolve) => setTimeout(resolve, 250));
						record.settledBeforeCancel = settled;
					} finally {
						clearTimeout(timer);
						await runtime.terminate();
						await finished;
					}
				} else await finished;
				await reportStage(`case:${name}:finished`);
				return record;
			}
			try {
				if (binding.syncWorkspace)
					await binding.syncWorkspace('ZIG', [
						{ path: 'solution.zig', content: source },
						{ path: 'nested/arithmetic.zig', content: helper }
					]);
				await reportStage('load:start');
				await runtime.load(source, false, [], options, progress);
				await reportStage('load:done');
				await execute(false);
				if (runs[0].error || runs[0].outcome?.error) return { runs };
				await execute(true);
				// No explicit reload: the public instance must recover after retiring/cancelling Workers.
				await execute(false);
				await terminalCase(
					'exit.zig',
					'const std = @import("std");\npub fn main() void { std.os.wasi.proc_exit(23); }\n',
					false
				);
				await terminalCase('trap.zig', 'pub fn main() void {\n    @trap();\n}\n', true);
				return { runs, terminalCases };
			} finally {
				await runtime.dispose();
				await binding.dispose();
			}
		},
		{
			source,
			helper,
			debugManifestSha256,
			breakpointLine,
			initializedWidthsLine,
			container: !!containerAssets
		}
	);
	const result = await Promise.race([
		evaluated,
		new Promise((_, reject) => {
			watchdog = setTimeout(
				() =>
					reject(new Error('Zig browser qualification exceeded its 10 minute deadline')),
				600_000
			);
		})
	]);
	const evidence = {
		transport: containerAssets ? 'application-container-owner' : 'public-playground-worker',
		profileId: zigReceipt.profileId,
		fingerprint: zigReceipt.fingerprint,
		debugManifestSha256,
		sourceSha256: digest(source),
		helperSha256: digest(helper),
		requests,
		browserMessages,
		rawDapEvents,
		probeStages,
		...result
	};
	if (process.env.WASM_IDLE_ZIG_DEBUG_RESULT) {
		await writeFile(
			process.env.WASM_IDLE_ZIG_DEBUG_RESULT,
			`${JSON.stringify(evidence, null, 2)}\n`,
			{
				mode: 0o600
			}
		);
	}
	evidenceWritten = true;
	console.log(JSON.stringify(evidence, null, 2));
	assert.equal(
		result.runs.length,
		3,
		'Expected successful debug, paused cancellation, and restart'
	);
	for (const run of result.runs.filter((entry) => !entry.cancel)) {
		assert.equal(run.error, '');
		assert.equal(run.outcome.error, undefined, run.output);
		assert.equal(run.outcome.completed, true);
		assert.equal(run.output, `result=12;quotient=${(7n << 64n) / 3n}\n`);
		assert.equal(run.snapshots[0].reason, 'entry');
		assert.equal(run.snapshots[0].sourcePath, '/workspace/solution.zig');
		assert.match(run.snapshots[0].callStack[0].functionName, /solution\.main/);
		assert(
			run.events.some((event) => event.type === 'stop'),
			'Expected debugger stop lifecycle event'
		);
		assert(
			run.events.some(
				(event) =>
					event.type === 'breakpoints' &&
					event.sourcePath === '/workspace/solution.zig' &&
					event.breakpoints.some(
						(breakpoint) => breakpoint.verified && breakpoint.line === breakpointLine
					)
			),
			'Original Zig source breakpoint must resolve'
		);
		const atHelperLine = (line) =>
			run.snapshots.find(
				(snapshot) =>
					snapshot.sourcePath === '/workspace/nested/arithmetic.zig' &&
					snapshot.line === line
			);
		const localAt = (line, name) =>
			atHelperLine(line)?.variables.find((value) => value.name === name)?.value;
		assert.equal(localAt(initializedResultLine, 'input'), '7');
		assert.equal(localAt(initializedResultLine, 'result'), '7');
		assert.equal(localAt(addedResultLine, 'result'), '12');
		assert.equal(localAt(initializedWidthsLine, 'wide'), '-90194313221');
		assert.equal(localAt(initializedWidthsLine, 'unsigned'), '7696581394441');
		assert(
			atHelperLine(initializedWidthsLine)?.callStack.some((frame) =>
				/solution\.main/.test(frame.functionName)
			)
		);
		for (const snapshot of run.snapshots) {
			assert.equal(
				snapshot.sourceContentSha256,
				snapshot.sourcePath === '/workspace/solution.zig' ? digest(source) : digest(helper)
			);
		}
		assert.equal(run.snapshots.at(-1).sourcePath, '/workspace/solution.zig');
	}
	const cancelled = result.runs.find((run) => run.cancel);
	assert.equal(cancelled.error, '');
	assert.equal(cancelled.snapshots.length, 1);
	assert.equal(cancelled.output, '');
	assert.notEqual(
		cancelled.outcome?.completed,
		true,
		'Cancelled run must not report successful execution'
	);
	assert.equal(result.terminalCases?.length, 2, 'Expected nonzero exit and real trap cases');
	const exited = result.terminalCases.find((value) => value.name === 'exit.zig');
	assert.match(
		exited.outcome.error,
		/exited with code 23/,
		'Real nonzero target exit must be preserved'
	);
	assert.notEqual(exited.outcome.completed, true);
	const trapped = result.terminalCases.find((value) => value.name === 'trap.zig');
	assert.equal(trapped.pause.stoppedReason, 'exception');
	assert.equal(trapped.pause.sourcePath, '/workspace/trap.zig');
	assert.equal(trapped.pause.line, 2);
	assert.equal(
		trapped.settledBeforeCancel,
		false,
		'A genuine Zig trap must remain paused until cancellation'
	);
	assert.notEqual(trapped.outcome.completed, true);
	assert(requests.includes('/wasm-zig/std.tar.gz'));
	assert(requests.includes('/clang/runtime-manifest.v1.json'));
	assert(requests.some((entry) => entry.includes('clang.wasm')));
	assert(requests.some((entry) => entry.includes('lld.wasm')));
	assert(requests.includes('/worker/lldb-worker.js'));
	assert(requests.includes('/worker/target-worker.js'));
	assert.equal(browserMessages.filter((message) => message.startsWith('pageerror:')).length, 0);
} catch (error) {
	if (process.env.WASM_IDLE_ZIG_DEBUG_RESULT && !evidenceWritten) {
		await writeFile(
			process.env.WASM_IDLE_ZIG_DEBUG_RESULT,
			`${JSON.stringify({ error: String(error), requests, browserMessages, rawDapEvents }, null, 2)}\n`,
			{ mode: 0o600 }
		);
	}
	throw error;
} finally {
	clearTimeout(watchdog);
	await browser?.close();
	if (server?.listening)
		await new Promise((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	await rm(temporary, { recursive: true, force: true });
}
