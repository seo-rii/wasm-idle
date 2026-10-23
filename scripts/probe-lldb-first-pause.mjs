#!/usr/bin/env node
// Exercise the real pinned compiler, LLDB/WAMR, strict CSP, and fresh relaunches.
import { build, transform } from 'esbuild';
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const clangRoot = args.get('--clang-assets') || path.join(root, 'static/clang');
const files = new Map();
const tsModule = async (name) => {
	const transformed = await transform(await readFile(path.join(root, name), 'utf8'), {
		loader: 'ts',
		format: 'esm'
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`
	);
};
const {
	BUNDLED_CLANG_ASSET_INTEGRITY: receipts,
	BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES: profiles
} = await tsModule('src/lib/playground/clangAssetIntegrity.ts');
for (const name of [
	'runtime-manifest.v1.json',
	'bin/clang.wasm.gz',
	'bin/lld.wasm.gz',
	'bin/memfs.wasm.gz',
	'bin/c-sysroot.tar.gz',
	'libc-printscan-long-double.a.gz'
]) {
	const bytes = await readFile(path.join(clangRoot, name));
	if (
		bytes.length !== receipts[name].bytes ||
		createHash('sha256').update(bytes).digest('hex') !== receipts[name].sha256
	)
		throw new Error(`Clang receipt mismatch: ${name}`);
	files.set(`/clang/${name}`, bytes);
}
const manifest = JSON.parse(files.get('/clang/runtime-manifest.v1.json'));
manifest.compiler.sysroot.profiles = profiles;
let { WASM_DEBUG_RUNTIME_PROFILE: debugProfile } = await tsModule(
	'src/lib/playground/wasmDebugVersion.ts'
);
const debugRoot = args.get('--debug-assets') || path.join(root, 'static/wasm-debug');
const debugManifestBytes = await readFile(path.join(debugRoot, 'runtime-manifest.v2.json'));
if (args.has('--debug-assets')) {
	const expected = args.get('--debug-manifest-sha256');
	const actual = createHash('sha256').update(debugManifestBytes).digest('hex');
	if (!expected || actual !== expected)
		throw new Error('Candidate manifest requires its exact --debug-manifest-sha256');
	debugProfile = {
		...debugProfile,
		manifestReceipt: { sha256: actual, bytes: debugManifestBytes.length }
	};
}
const cacheMode = args.get('--cache-mode') || 'off';
if (!['off', 'on', 'both'].includes(cacheMode)) throw new Error('Invalid --cache-mode');
const debugManifest = JSON.parse(debugManifestBytes);
files.set('/wasm-debug/runtime-manifest.v2.json', debugManifestBytes);
for (const group of [debugManifest.debugger.lldb, debugManifest.debugger.targetRuntime]) {
	for (const kind of ['js', 'wasm', 'worker'])
		files.set(`/wasm-debug/${group[kind]}`, await readFile(path.join(debugRoot, group[kind])));
}
const bundle = async (entry, input) => {
	const result = await build({
		...(input
			? { stdin: { contents: input, resolveDir: root, sourcefile: entry, loader: 'ts' } }
			: { entryPoints: [path.join(root, entry)] }),
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		logLevel: 'silent',
		// Test-only observation at our loader boundary. Producer glue and global
		// WebAssembly functions remain untouched.
		plugins: [
			{
				name: 'observe-actual-instantiation',
				setup(builder) {
					builder.onLoad(
						{
							filter: /runtime\/debug\/src\/worker\/(module-loader|lldb-worker|target-worker)\.ts$/
						},
						async ({ path: filename }) => {
							let contents = await readFile(filename, 'utf8');
							const needle = filename.endsWith('module-loader.ts')
								? 'const instance = new WebAssembly.Instance(module, imports);'
								: "type: 'ready',";
							if (contents.split(needle).length !== 2)
								throw new Error('Probe loader instrumentation boundary changed');
							const replacement = filename.endsWith('module-loader.ts')
								? needle +
									'\n(globalThis as any).__probeInstantiationCalls = ((globalThis as any).__probeInstantiationCalls || 0) + 1;'
								: needle +
									'\n__probeInstantiationCalls: (globalThis as any).__probeInstantiationCalls || 0,';
							contents = contents.replace(needle, replacement);
							return { contents, loader: 'ts' };
						}
					);
				}
			}
		],
		tsconfig: path.join(root, 'packages/llvm-core/tsconfig.json'),
		alias: {
			$lib: path.join(root, 'src/lib'),
			'@wasm-idle/llvm-core/debug': path.join(
				root,
				'packages/llvm-core/runtime/debug/src/index.ts'
			),
			'@wasm-idle/core': path.join(root, 'packages/core/src/index.ts')
		}
	});
	return Buffer.from(result.outputFiles[0].contents);
};
files.set('/controller.js', await bundle('src/lib/playground/lldbSession.ts'));
for (const worker of ['lldb', 'target'])
	files.set(
		`/worker/${worker}-worker.js`,
		await bundle(`packages/llvm-core/runtime/debug/src/worker/${worker}-worker.ts`)
	);
files.set(
	'/compiler.js',
	await bundle(
		'compiler-probe.ts',
		`
import Runtime from './packages/llvm-core/runtime/clang/src/artifact-runtime.ts';
self.onmessage = async ({data:{manifest,source}}) => {
 try {
  let diagnostics='';
  const runtime=new Runtime({runtimeBaseUrl:location.origin+'/clang/',manifest,stdout:(text)=>{diagnostics+=text;},persistentCache:{enabled:false}});
  const artifact=await runtime.compileArtifact(source,{language:'C',activePath:'main.c',debugMode:'lldb'});
  postMessage({bytes:artifact.bytes,descriptor:artifact.debug});
 }catch(error){postMessage({error:String(error)});}
};`
	)
);
files.set('/', Buffer.from('<!doctype html><title>LLDB first-pause probe</title>'));
const csp =
	"default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:; style-src 'self'; img-src 'self';";
const server = http.createServer((request, response) => {
	const pathname = new URL(request.url, 'http://localhost').pathname;
	const bytes = files.get(pathname);
	response.writeHead(bytes ? 200 : 404, {
		'Content-Type': /\.(?:m?js)$/.test(pathname)
			? 'text/javascript'
			: pathname.endsWith('.wasm')
				? 'application/wasm'
				: pathname.endsWith('.gz')
					? 'application/gzip'
					: pathname === '/'
						? 'text/html'
						: 'application/json',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Content-Security-Policy': csp,
		'Cache-Control': 'no-store'
	});
	response.end(bytes);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
	const origin = `http://127.0.0.1:${server.address().port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		),
		args: ['--no-sandbox']
	});
	const context = await browser.newContext();
	await addBrowserTestCookies(context, origin);
	const page = await context.newPage();
	page.on('pageerror', (error) => process.stderr.write(`${error.message}\n`));
	await page.goto(origin);
	const report = await page.evaluate(
		async ({ manifest, debugProfile, cacheMode, debugManifest }) => {
			const violations = [];
			document.addEventListener('securitypolicyviolation', (event) =>
				violations.push(event.violatedDirective)
			);
			const { LldbSandboxSession } = await import('/controller.js');
			const source =
				'#include <stdio.h>\n__attribute__((noinline)) int recurse(int n){\n if(n==0){\n  puts("done");\n  return 0;\n }\n return 1+recurse(n-1);\n}\nint main(void){return recurse(120)==120?0:1;}';
			const artifact = await new Promise((resolve, reject) => {
				const worker = new Worker('/compiler.js', { type: 'module' });
				worker.onerror = (error) => {
					worker.terminate();
					reject(new Error(error.message));
				};
				worker.onmessage = ({ data }) => {
					worker.terminate();
					data.error ? reject(new Error(data.error)) : resolve(data);
				};
				worker.postMessage({ manifest, source });
			});
			const results = [];
			const moduleIds = new WeakMap();
			let nextModuleId = 1;
			const seenWorkers = new Set();
			const seenQueues = new Set();
			const modes =
				cacheMode === 'both'
					? [false, false, true, true]
					: [cacheMode === 'on', cacheMode === 'on'];
			const timeout = async (promise, label) => {
				let timer;
				try {
					return await Promise.race([
						promise,
						new Promise((_, reject) => {
							timer = setTimeout(() => reject(new Error(`${label} timeout`)), 120000);
						})
					]);
				} finally {
					clearTimeout(timer);
				}
			};
			for (let iteration = 0; iteration < modes.length; iteration++) {
				const cachedModules = {};
				const instantiationCalls = {};
				let resolvePause, resolveStack, resolveScopes;
				const pausePromise = new Promise((resolve) => {
					resolvePause = resolve;
				});
				const stackPromise = new Promise((resolve) => {
					resolveStack = resolve;
				});
				const scopesPromise = new Promise((resolve) => {
					resolveScopes = resolve;
				});
				const began = performance.now();
				let firstPauseMs,
					fullStackMs,
					scopesMs,
					output = '';
				let pause;
				const lengths = [];
				const session = new LldbSandboxSession({
					compiledModuleCache: modes[iteration],
					workerFactory: (kind) => {
						const worker = new Worker(`/worker/${kind}-worker.js`, { type: 'module' });
						if (seenWorkers.has(worker)) throw new Error('Reused a worker instance');
						seenWorkers.add(worker);
						const listenerWrappers = new Map();
						return {
							postMessage: (message, transfer) => {
								if (message.type.startsWith('initialize-')) {
									const runtime = message.compiledModule;
									const expected =
										modes[iteration] &&
										debugManifest.debugger[
											kind === 'lldb' ? 'lldb' : 'targetRuntime'
										].moduleInstantiation === 'emscripten-instantiate-wasm-v1';
									if (runtime instanceof WebAssembly.Module !== expected)
										throw new Error('Incorrect module capability gate');
									if (runtime && !moduleIds.has(runtime))
										moduleIds.set(runtime, nextModuleId++);
									cachedModules[kind] = runtime ? moduleIds.get(runtime) : null;
									const queue =
										kind === 'lldb'
											? message.dapInput.data
											: message.stdin.data;
									if (seenQueues.has(queue))
										throw new Error('Reused a session queue');
									seenQueues.add(queue);
								}
								worker.postMessage(message, transfer);
							},
							addEventListener: (type, listener) => {
								const wrapped =
									type === 'message'
										? (event) => {
												if (event.data.type === 'ready') {
													const expected =
														modes[iteration] &&
														debugManifest.debugger[
															kind === 'lldb'
																? 'lldb'
																: 'targetRuntime'
														].moduleInstantiation ===
															'emscripten-instantiate-wasm-v1';
													const count =
														event.data.__probeInstantiationCalls;
													if (count !== (expected ? 1 : 0))
														throw new Error(
															`${kind} instantiateWasm callback was not invoked exactly once`
														);
													instantiationCalls[kind] = count;
												}
												listener(event);
											}
										: listener;
								listenerWrappers.set(listener, wrapped);
								worker.addEventListener(type, wrapped);
							},
							removeEventListener: (type, listener) => {
								worker.removeEventListener(
									type,
									listenerWrappers.get(listener) || listener
								);
								listenerWrappers.delete(listener);
							},
							terminate: worker.terminate.bind(worker)
						};
					},
					manifestUrl: location.origin + '/wasm-debug/runtime-manifest.v2.json',
					manifestReceipt: debugProfile.manifestReceipt,
					runtimeBaseUrl: location.origin + '/wasm-debug/',
					persistentCache: { enabled: false },
					artifact: {
						...artifact,
						sources: [{ path: '/workspace/main.c', content: source }]
					},
					sourcePath: '/workspace/main.c',
					breakpoints: [4],
					pauseOnEntry: false,
					onOutput: (text) => {
						output += text;
					},
					onDebugEvent: (event) => {
						if (event.type === 'pause') {
							pause = event;
							firstPauseMs = performance.now() - began;
							resolvePause(event);
						}
						if (event.type === 'pauseDetails' && event.callStack) {
							lengths.push(event.callStack.length);
							if (event.callStack.length === 100) {
								fullStackMs = performance.now() - began;
								resolveStack(event);
							}
						}
						if (event.type === 'pauseDetails' && event.scopes) {
							scopesMs = performance.now() - began;
							resolveScopes(event);
						}
					}
				});
				const completion = session.start();
				void completion.catch(() => undefined);
				try {
					await timeout(
						Promise.race([
							pausePromise,
							completion.then(() => {
								throw new Error('exited before pause');
							})
						]),
						'first pause'
					);
					if (
						pause.callStack.length !== 1 ||
						pause.line !== 4 ||
						pause.sourcePath !== '/workspace/main.c'
					)
						throw new Error(`invalid first pause ${JSON.stringify(pause)}`);
					await timeout(Promise.all([stackPromise, scopesPromise]), 'details');
					const locals = (await scopesPromise).scopes.find(
						(scope) => scope.name === 'Locals'
					);
					if (!locals?.variablesReference) throw new Error('missing Locals reference');
					const variables = await session.variables(locals.variablesReference);
					if (
						!variables.some(
							(variable) => variable.name === 'n' && variable.value === '0'
						)
					)
						throw new Error(
							`incorrect first-frame locals: ${JSON.stringify(variables)}`
						);
					const frames = (await stackPromise).callStack;
					if (new Set(frames.map((frame) => frame.id)).size !== 100)
						throw new Error('duplicate frame IDs');
					const callerScopes = await session.frameScopes(frames[1].id);
					const callerLocals = callerScopes.find((scope) => scope.name === 'Locals');
					if (!callerLocals?.variablesReference) throw new Error('missing caller Locals');
					const callerVariables = await session.variables(
						callerLocals.variablesReference
					);
					if (
						!callerVariables.some(
							(variable) => variable.name === 'n' && variable.value === '1'
						)
					)
						throw new Error(
							`incorrect caller locals: ${JSON.stringify(callerVariables)}`
						);
					await session.debugCommand('continue');
					await timeout(completion, 'continue');
					if (!output.includes('done')) throw new Error(`missing output: ${output}`);
					if (Object.keys(instantiationCalls).length !== 2)
						throw new Error('Missing actual runtime callback observations');
					results.push({
						iteration,
						compiledModuleCache: modes[iteration],
						cachedModules,
						instantiationCalls,
						firstPauseMs,
						fullStackMs,
						scopesMs,
						pageLengths: lengths,
						topFrame: pause.callStack[0],
						variables,
						callerVariables,
						output
					});
				} finally {
					await session.disconnect();
				}
			}
			const reusedModules = {};
			for (const [kind, asset] of [
				['lldb', debugManifest.debugger.lldb],
				['target', debugManifest.debugger.targetRuntime]
			]) {
				const cached = results
					.filter((result) => result.compiledModuleCache)
					.map((result) => result.cachedModules[kind]);
				const supported = asset.moduleInstantiation === 'emscripten-instantiate-wasm-v1';
				reusedModules[kind] =
					supported &&
					cached.length >= 2 &&
					cached.every((id) => id !== null && id === cached[0]);
				if (supported && cached.length >= 2 && !reusedModules[kind])
					throw new Error(`${kind} did not reuse the verified immutable module`);
			}
			if (seenWorkers.size !== modes.length * 2 || seenQueues.size !== modes.length * 2)
				throw new Error('Missing fresh workers or session queues');
			if (violations.length) throw new Error(`CSP violations: ${violations.join(',')}`);
			return {
				crossOriginIsolated,
				violations,
				immutableModuleReuse: reusedModules,
				timingInterpretation:
					'Exploratory sequential samples in one Chromium context; engine warmup is not isolated.',
				freshWorkers: seenWorkers.size,
				freshQueues: seenQueues.size,
				manifestReceipt: debugProfile.manifestReceipt,
				runtimeAssets: debugManifest.debugger,
				results
			};
		},
		{ manifest, debugProfile, cacheMode, debugManifest }
	);
	const output = JSON.stringify({ chromium: browser.version(), ...report }, null, 2) + '\n';
	if (args.has('--json')) await writeFile(args.get('--json'), output);
	else process.stdout.write(output);
} finally {
	await browser?.close();
	await new Promise((resolve) => server.close(resolve));
}
