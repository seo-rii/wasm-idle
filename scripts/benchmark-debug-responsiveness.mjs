#!/usr/bin/env node
import { build, transform } from 'esbuild';
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { createCoreSourceAliasMap } from './core-source-aliases.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
	const key = process.argv[i];
	if (!['--assets', '--samples', '--languages', '--json'].includes(key) || !process.argv[i + 1])
		throw new Error(`Invalid argument: ${key}`);
	args.set(key, process.argv[i + 1]);
}
const samples = Number(args.get('--samples') ?? 10);
if (!Number.isInteger(samples) || samples < 2 || samples > 100)
	throw new Error('--samples must be 2..100 (includes the first session)');
const languages = (args.get('--languages') ?? 'lldb,java').split(',');
if (
	!languages.length ||
	new Set(languages).size !== languages.length ||
	languages.some((value) => !['lldb', 'java'].includes(value))
)
	throw new Error('--languages must be lldb, java, or lldb,java');
const assets = path.resolve(args.get('--assets') ?? path.join(root, 'static'));
const files = new Map();
const receipts = {};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function tsModule(filename) {
	const { code } = await transform(await readFile(path.join(root, filename), 'utf8'), {
		loader: 'ts',
		format: 'esm'
	});
	return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
async function asset(name, receipt) {
	let bytes;
	try {
		bytes = await readFile(path.join(assets, name));
	} catch (error) {
		if (error.code !== 'ENOENT' || name.endsWith('.gz')) throw error;
		bytes = gunzipSync(await readFile(path.join(assets, name + '.gz')));
	}
	const actual = { bytes: bytes.length, sha256: sha256(bytes) };
	if (receipt && (actual.bytes !== receipt.bytes || actual.sha256 !== receipt.sha256))
		throw new Error(`Pinned receipt mismatch: ${name}`);
	receipts[name] = actual;
	files.set('/' + name, bytes);
}
if (languages.includes('lldb')) {
	const { BUNDLED_CLANG_ASSET_INTEGRITY } = await tsModule(
		'src/lib/playground/clangAssetIntegrity.ts'
	);
	for (const name of [
		'runtime-manifest.v1.json',
		'bin/clang.wasm.gz',
		'bin/lld.wasm.gz',
		'bin/memfs.wasm.gz',
		'bin/c-sysroot.tar.gz',
		'libc-printscan-long-double.a.gz'
	])
		await asset('clang/' + name, BUNDLED_CLANG_ASSET_INTEGRITY[name]);
	const { WASM_DEBUG_RUNTIME_PROFILE } = await tsModule('src/lib/playground/wasmDebugVersion.ts');
	await asset('wasm-debug/runtime-manifest.v2.json', WASM_DEBUG_RUNTIME_PROFILE.manifestReceipt);
	const manifest = JSON.parse(files.get('/wasm-debug/runtime-manifest.v2.json'));
	for (const group of [manifest.debugger.lldb, manifest.debugger.targetRuntime]) {
		for (const kind of ['js', 'wasm', 'worker']) await asset('wasm-debug/' + group[kind]);
	}
}
if (languages.includes('java')) {
	const { TEAVM_RUNTIME_ASSET_RECEIPTS } = await tsModule(
		'packages/core/src/teavm-runtime.generated.ts'
	);
	for (const [name, receipt] of Object.entries(TEAVM_RUNTIME_ASSET_RECEIPTS))
		await asset('teavm/' + name, receipt);
}
const bundled = await build({
	absWorkingDir: root,
	entryPoints: {
		client: 'scripts/debug-responsiveness-client.ts',
		'java-worker': 'src/lib/playground/worker/java.ts',
		'worker/lldb-worker': 'packages/llvm-core/runtime/debug/src/worker/lldb-worker.ts',
		'worker/target-worker': 'packages/llvm-core/runtime/debug/src/worker/target-worker.ts',
		compiler: 'benchmark-compiler'
	},
	outdir: 'benchmark-output',
	write: false,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	tsconfigRaw: { compilerOptions: { target: 'ES2022', useDefineForClassFields: true } },
	alias: {
		$lib: path.join(root, 'src/lib'),
		'@wasm-idle/llvm-core/debug': path.join(
			root,
			'packages/llvm-core/runtime/debug/src/index.ts'
		),
		'@wasm-idle/llvm-core/core': path.join(root, 'packages/llvm-core/runtime/core/src'),
		'@wasm-idle/llvm-core': path.join(root, 'packages/llvm-core/runtime/core/src/index.ts'),
		...createCoreSourceAliasMap(root)
	},
	plugins: [
		{
			name: 'benchmark-entrypoints',
			setup(builder) {
				builder.onResolve({ filter: /\/worker\/java\?worker$/ }, () => ({
					path: 'java-worker-constructor',
					namespace: 'benchmark'
				}));
				builder.onResolve({ filter: /^benchmark-compiler$/ }, () => ({
					path: 'compiler',
					namespace: 'benchmark'
				}));
				builder.onLoad({ filter: /.*/, namespace: 'benchmark' }, ({ path: name }) => ({
					loader: 'ts',
					resolveDir: root,
					contents:
						name === 'java-worker-constructor'
							? `export default class extends Worker { constructor(){super(new URL('/java-worker.js', location.href), {type:'module'});} }`
							: `import Runtime from './packages/llvm-core/runtime/clang/src/artifact-runtime.ts';
       self.onmessage = async ({data:{manifest,source}}) => {
        try {
         const runtime = new Runtime({runtimeBaseUrl:location.origin+'/clang/',manifest,stdout:()=>{},persistentCache:{enabled:false}});
         const artifact = await runtime.compileArtifact(source,{language:'C',activePath:'main.c',debugMode:'lldb'});
         postMessage({bytes:artifact.bytes,descriptor:artifact.debug});
        } catch(error) { postMessage({error:String(error)}); }
       };`
				}));
			}
		}
	],
	logLevel: 'silent'
});
for (const file of bundled.outputFiles)
	files.set(
		'/' +
			path.relative(path.join(root, 'benchmark-output'), file.path).split(path.sep).join('/'),
		file.contents
	);
files.set('/', Buffer.from('<!doctype html><title>Debugger responsiveness benchmark</title>'));
const server = createServer((request, response) => {
	const name = new URL(request.url, 'http://localhost').pathname;
	const bytes = files.get(name);
	response.writeHead(bytes ? 200 : 404, {
		'Content-Type': name.endsWith('.js')
			? 'text/javascript'
			: name === '/'
				? 'text/html'
				: name.endsWith('.wasm')
					? 'application/wasm'
					: 'application/octet-stream',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cache-Control': 'no-store'
	});
	response.end(bytes);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const distribution = (values) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: sorted.length,
		p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
		p95: sorted[Math.ceil(sorted.length * 0.95) - 1]
	};
};
async function deadline(promise, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${label} exceeded 180 seconds`)),
					180_000
				);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}
let browser;
try {
	browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		),
		args: ['--no-sandbox', '--enable-precise-memory-info']
	});
	const origin = `http://127.0.0.1:${server.address().port}`;
	const results = [];
	for (const language of languages) {
		const context = await browser.newContext();
		await addBrowserTestCookies(context, origin);
		try {
			const page = await context.newPage();
			const errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto(origin);
			const cdp = await context.newCDPSession(page);
			const heap = async () => {
				await cdp.send('HeapProfiler.collectGarbage');
				return page.evaluate(() => performance.memory.usedJSHeapSize);
			};
			const baseline = await heap();
			await page.evaluate(() => {
				globalThis.__calibration = new ArrayBuffer(96 * 1024 * 1024);
			});
			const retained = await heap();
			await page.evaluate(() => {
				delete globalThis.__calibration;
			});
			const released = await heap();
			if (retained - baseline < 64 * 1024 * 1024 || released - baseline > 16 * 1024 * 1024)
				throw new Error('Chromium heap calibration failed');
			await page.evaluate(async () => {
				globalThis.__benchmark = await import('/client.js');
			});
			const importedHeap = await heap();
			const preparation = await deadline(
				page.evaluate((language) => globalThis.__benchmark.prepare(language), language),
				`${language} preparation`
			);
			const runs = [];
			for (let i = 0; i < samples; i++) {
				const run = await deadline(
					page.evaluate((index) => globalThis.__benchmark.iteration(index), i),
					`${language} iteration ${i}`
				);
				const postRunPageHeapBytes = await heap();
				if (language === 'lldb') {
					const closeDeadline = Date.now() + 2000;
					while (page.workers().length && Date.now() < closeDeadline)
						await new Promise((resolve) => setTimeout(resolve, 25));
					if (page.workers().length)
						throw new Error(
							`LLDB workers survived disconnect: ${page
								.workers()
								.map((worker) => worker.url())
								.join(', ')}`
						);
				}
				runs.push({
					...run,
					postRunPageHeapBytes,
					workersAfterRun: page.workers().length
				});
			}
			await deadline(
				page.evaluate(() => globalThis.__benchmark.dispose()),
				`${language} disposal`
			);
			const postDisposePageHeapBytes = await heap();
			const closeDeadline = Date.now() + 2000;
			while (page.workers().length && Date.now() < closeDeadline)
				await new Promise((resolve) => setTimeout(resolve, 25));
			if (page.workers().length)
				throw new Error(`${page.workers().length} workers survived disposal`);
			if (errors.length) throw new Error(errors.join('\n'));
			results.push({
				language,
				...preparation,
				calibration: { baseline, retained, released },
				importedHeap,
				postDisposePageHeapBytes,
				workersAfterDispose: 0,
				firstSession: runs[0],
				summaryMs: {
					restart: distribution(runs.slice(1).map((run) => run.launchMs)),
					step: distribution(runs.map((run) => run.stepMs)),
					firstWatchPerSession: distribution(
						runs.map((run) => run.firstWatchMs).filter((value) => value !== null)
					),
					repeatedWatch: distribution(runs.flatMap((run) => run.repeatedWatchMs))
				},
				runs
			});
		} finally {
			await context.close();
		}
	}
	const report = {
		schemaVersion: 1,
		capturedAt: new Date().toISOString(),
		commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
		sourceDiffSha256: sha256(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
		benchmarkSourceSha256: Object.fromEntries(
			await Promise.all(
				[
					'scripts/benchmark-debug-responsiveness.mjs',
					'scripts/debug-responsiveness-client.ts'
				].map(async (name) => [name, sha256(await readFile(path.join(root, name)))])
			)
		),
		chromium: browser.version(),
		node: process.version,
		platform: `${process.platform}/${process.arch}`,
		samples,
		receipts,
		methodology:
			'Direct sandbox API latency, no UI paint. First context session is separate from warm same-context restarts; disk/OS/engine caches are not reset. LLDB preparation compiles C once; Java preparation loads its compiler and launch includes compilation. Persistent asset cache disabled; existing compiler/module/evaluator caches retained. Heap is calibrated page performance.memory, excludes worker heaps and process RSS. p95 is nearest-rank and exploratory at small sample counts.',
		results
	};
	const output = JSON.stringify(report, null, 2) + '\n';
	if (args.has('--json')) await writeFile(path.resolve(args.get('--json')), output);
	else process.stdout.write(output);
} finally {
	await browser?.close();
	await new Promise((resolve) => server.close(resolve));
}
