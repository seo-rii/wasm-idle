#!/usr/bin/env node
// Real pinned Clang/LLD in Chromium; no application build or mutable guest reuse.
import { build, transform } from 'esbuild';
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const baselineRef = args.get('--baseline-ref') || 'origin/main';
const baselineSha = execFileSync('git', ['rev-parse', baselineRef], {
	cwd: root,
	encoding: 'utf8'
}).trim();
const repeats = Number(args.get('--repeats') || 4);
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('Invalid --repeats');
const temp = await mkdtemp(path.join(tmpdir(), 'clang-host-probe-'));
let browser;
let server;
try {
	const transformed = await transform(
		await readFile(path.join(root, 'src/lib/playground/clangAssetIntegrity.ts'), 'utf8'),
		{ loader: 'ts', format: 'esm' }
	);
	const {
		BUNDLED_CLANG_ASSET_INTEGRITY: integrity,
		BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES: profiles
	} = await import(
		`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`
	);
	const assets = new Map();
	const receipts = {};
	for (const name of [
		'runtime-manifest.v1.json',
		'bin/clang.wasm.gz',
		'bin/lld.wasm.gz',
		'bin/memfs.wasm.gz',
		'bin/c-sysroot.tar.gz',
		'bin/cpp-addon.tar.gz',
		'libc-printscan-long-double.a.gz'
	]) {
		const bytes = await readFile(path.join(root, 'static/clang', name));
		const receipt = integrity[name];
		const raw = name.endsWith('.gz') ? gunzipSync(bytes) : bytes;
		for (const [value, length, hash] of [
			[bytes, receipt.bytes, receipt.sha256],
			[raw, receipt.uncompressedBytes, receipt.uncompressedSha256]
		]) {
			if (
				value.length !== length ||
				createHash('sha256').update(value).digest('hex') !== hash
			)
				throw new Error(`Pinned asset mismatch: ${name}`);
		}
		assets.set(`/clang/${name}`, bytes);
		receipts[`/clang/${name}`] = receipt;
	}
	const manifest = JSON.parse(assets.get('/clang/runtime-manifest.v1.json'));
	manifest.compiler.sysroot.profiles = profiles;
	const baseline = path.join(temp, 'baseline');
	await mkdir(baseline);
	execFileSync('tar', ['-xf', '-', '-C', baseline], {
		input: execFileSync('git', ['archive', baselineSha, 'packages/llvm-core/runtime'], {
			cwd: root,
			maxBuffer: 32 * 1024 * 1024
		})
	});
	for (const [name, source] of [
		['baseline', baseline],
		['candidate', root]
	]) {
		const result = await build({
			entryPoints: [path.join(root, 'scripts/clang-host-performance.worker.ts')],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'browser',
			target: 'es2022',
			logLevel: 'silent',
			tsconfig: path.join(root, 'packages/llvm-core/tsconfig.json'),
			nodePaths: [path.join(root, 'node_modules')],
			alias: {
				'@probe/clang': path.join(source, 'packages/llvm-core/runtime/clang/src'),
				'@probe/core': path.join(source, 'packages/llvm-core/runtime/core/src')
			}
		});
		assets.set(`/${name}.js`, Buffer.from(result.outputFiles[0].contents));
	}
	assets.set('/', Buffer.from('<!doctype html><title>Clang host probe</title>'));
	server = http.createServer((request, response) => {
		const pathname = new URL(request.url, 'http://localhost').pathname;
		const bytes = assets.get(pathname);
		response.writeHead(bytes ? 200 : 404, {
			'Content-Type': pathname.endsWith('.js')
				? 'text/javascript'
				: pathname.endsWith('.gz')
					? 'application/gzip'
					: pathname === '/'
						? 'text/html'
						: 'application/octet-stream',
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cache-Control': 'no-store'
		});
		response.end(bytes);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
	await page.goto(origin);
	const report = {
		chromium: browser.version(),
		node: process.version,
		baseline: baselineSha,
		repeats,
		assets: receipts,
		results: []
	};
	const variants = {
		baseline: ['baseline', false, false],
		off: ['candidate', false, false],
		on: ['candidate', true, true],
		auto: ['candidate', 'auto', true]
	};
	for (const mode of (args.get('--variants') || 'baseline,off,on,auto').split(',')) {
		if (!Object.hasOwn(variants, mode)) throw new Error(`Unknown variant: ${mode}`);
		const [variant, cache, checks] = variants[mode];
		const result = await page.evaluate(
			({ variant, cache, checks, repeats, manifest, receipts, origin }) =>
				new Promise((resolve, reject) => {
					const worker = new Worker(`${origin}/${variant}.js`, { type: 'module' });
					const timer = setTimeout(() => {
						worker.terminate();
						reject(new Error(`${variant} timed out`));
					}, 300_000);
					worker.onerror = (error) => {
						clearTimeout(timer);
						worker.terminate();
						reject(new Error(error.message));
					};
					worker.onmessage = ({ data }) => {
						clearTimeout(timer);
						worker.terminate();
						data.error ? reject(new Error(data.error)) : resolve(data);
					};
					worker.postMessage({ origin, manifest, receipts, cache, checks, repeats });
				}),
			{ variant, cache, checks, repeats, manifest, receipts, origin }
		);
		report.results.push({ variant, cache, ...result });
	}
	const output = JSON.stringify(report, null, 2) + '\n';
	if (args.has('--json')) await writeFile(args.get('--json'), output);
	else process.stdout.write(output);
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	await rm(temp, { recursive: true, force: true });
}
