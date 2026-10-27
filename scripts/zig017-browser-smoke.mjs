#!/usr/bin/env node
// Runs the real Zig playground client and Worker against the bundled compiler.
// Usage: node scripts/zig017-browser-smoke.mjs [static/wasm-zig]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.resolve(process.argv[2] || path.join(root, 'static/wasm-zig'));
if (process.argv.length > 3) throw new Error('Usage: zig017-browser-smoke.mjs [asset-directory]');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zig017-browser-'));
const requests = [];
const browserMessages = [];
let server;
let browser;

const sourcePackages = {
	'@wasm-idle/core': path.join(root, 'packages/core/src'),
	'@wasm-idle/llvm-core': path.join(root, 'packages/llvm-core/runtime/core/src')
};
const sourceResolver = {
	name: 'zig-task-source-packages',
	setup(context) {
		context.onResolve({ filter: /^zig-smoke-client$/ }, () => ({
			path: 'zig-smoke-client',
			namespace: 'zig-smoke-client'
		}));
		context.onLoad({ filter: /.*/, namespace: 'zig-smoke-client' }, () => ({
			contents: `import Zig from ${JSON.stringify(path.join(root, 'src/lib/playground/zig.ts'))};
import { createPlaygroundBinding } from '@wasm-idle/core';
export default function(assets) {
  return createPlaygroundBinding(assets, async language => {
    if (language !== 'ZIG') throw new Error('This probe only loads Zig');
    return new Zig();
  });
}`,
			loader: 'js',
			resolveDir: root
		}));
		context.onResolve({ filter: /^@wasm-idle\/(core|llvm-core)(\/|$)/ }, ({ path: name }) => {
			for (const [prefix, directory] of Object.entries(sourcePackages)) {
				if (name === prefix) return { path: path.join(directory, 'index.ts') };
				if (name.startsWith(`${prefix}/`)) {
					return { path: path.join(directory, `${name.slice(prefix.length + 1)}.ts`) };
				}
			}
		});
		context.onResolve({ filter: /\/worker\/zig\?worker$/ }, () => ({
			path: 'zig-worker-constructor',
			namespace: 'zig-worker-constructor'
		}));
		context.onLoad({ filter: /.*/, namespace: 'zig-worker-constructor' }, () => ({
			// Equivalent to Vite's ?worker wrapper; the worker source below is unmodified.
			contents: `export default class extends Worker {
  constructor() { super(new URL('./zig-worker.js', import.meta.url), { type: 'module' }); }
}`,
			loader: 'js'
		}));
	}
};

try {
	const receipt = JSON.parse(await readFile(path.join(assets, 'runtime-build.json'), 'utf8'));
	assert.match(receipt.profileId, /0\.17\.0/, 'The browser test requires the Zig 0.17.0 bundle');
	const common = {
		bundle: true,
		platform: 'browser',
		format: 'esm',
		target: 'es2022',
		alias: { $lib: path.join(root, 'src/lib') },
		plugins: [sourceResolver],
		tsconfigRaw: { compilerOptions: { target: 'ES2022', useDefineForClassFields: true } },
		logLevel: 'warning'
	};
	await build({
		...common,
		entryPoints: {
			client: 'zig-smoke-client',
			starters: path.join(root, 'src/routes/editor-defaults.ts'),
			'zig-worker': path.join(root, 'src/lib/playground/worker/zig.ts')
		},
		outdir: temporary
	});
	server = createServer(async (request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		try {
			const url = new URL(request.url, 'http://localhost');
			requests.push(url.pathname);
			if (url.pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><title>Zig 0.17 browser qualification</title>');
				return;
			}
			if (['/client.js', '/starters.js', '/zig-worker.js'].includes(url.pathname)) {
				response.setHeader('Content-Type', 'text/javascript');
				response.end(await readFile(path.join(temporary, url.pathname.slice(1))));
				return;
			}
			const name = url.pathname.slice('/wasm-zig/'.length);
			if (
				!url.pathname.startsWith('/wasm-zig/') ||
				!['zig_small.wasm', 'zig_small.wasm.gz', 'std.tar.gz'].includes(name)
			) {
				response.writeHead(404);
				response.end();
				return;
			}
			let bytes;
			try {
				bytes = await readFile(path.join(assets, name));
			} catch (error) {
				if (error.code !== 'ENOENT' || name !== 'zig_small.wasm') throw error;
				bytes = await readFile(path.join(assets, `${name}.gz`));
				response.setHeader('Content-Encoding', 'gzip');
			}
			response.setHeader(
				'Content-Type',
				name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
			);
			response.setHeader('Content-Length', bytes.byteLength);
			response.end(bytes);
		} catch (error) {
			response.writeHead(500);
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
	page.on('console', (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
	page.on('pageerror', (error) => browserMessages.push(`pageerror: ${error.message}`));
	// This is an isolated loopback fixture server with no protected origin or WAF.
	await page.goto(origin);
	const sharedStdinSource = await readFile(
		path.join(root, 'src/lib/test-fixtures/zig-stdin.zig'),
		'utf8'
	);
	const result = await page.evaluate(async (sharedStdinSource) => {
		const [{ default: createZigBinding }, { editorDefaults }] = await Promise.all([
			import('/client.js'),
			import('/starters.js')
		]);
		if (!crossOriginIsolated)
			throw new Error('Browser fixture needs SharedArrayBuffer isolation');
		const binding = createZigBinding({ rootUrl: location.origin, persistentCache: false });
		const runtime = await binding.load('ZIG');
		const outputs = [];
		const runDurationsMs = [];
		const execute = async (code, options = {}, interactiveInput) => {
			let output = '';
			runtime.output = (chunk) => (output += chunk);
			const started = performance.now();
			const running = runtime.run(code, false, true, undefined, [], options);
			if (interactiveInput !== undefined) {
				runtime.write(interactiveInput);
				runtime.eof();
			}
			await running;
			runDurationsMs.push(Math.round(performance.now() - started));
			outputs.push(output);
			return output;
		};
		try {
			const loadStarted = performance.now();
			await runtime.load();
			const loadDurationMs = Math.round(performance.now() - loadStarted);
			await execute(editorDefaults.zig, { stdin: '6\n' });
			// The global page/terminal stdin suite imports this exact fixture too.
			await execute(sharedStdinSource, {}, '68\n');
			const code = String.raw`const std = @import("std");
const arithmetic = @import("nested/arithmetic.zig");
pub fn main(init: std.process.Init) !void {
    var input_buffer: [128]u8 = undefined;
    var input = std.Io.File.stdin().reader(init.io, &input_buffer);
    const line = try input.interface.takeDelimiterExclusive('\n');
    var fields = std.mem.tokenizeAny(u8, line, " \r\t");
    const high = try std.fmt.parseInt(u64, fields.next().?, 10);
    const low = try std.fmt.parseInt(u64, fields.next().?, 10);
    const divisor = try std.fmt.parseInt(u64, fields.next().?, 10);
    const numerator = (@as(u128, high) << 64) | @as(u128, low);
    const quotient: u64 = @intCast(numerator / @as(u128, divisor));
    var output_buffer: [128]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.print("quotient={d};sum={d}\n", .{ quotient, arithmetic.add(19, 23) });
    try output.interface.flush();
}`;
			const workspaceFiles = [
				{
					path: 'nested/arithmetic.zig',
					content: 'pub fn add(left: u32, right: u32) u32 { return left + right; }\n'
				}
			];
			await execute(code, { workspaceFiles, stdin: '1 0 3\n' });
			await execute(code, { workspaceFiles, stdin: '0 42 6\n' });
			let diagnostic = '';
			try {
				await execute('pub fn main() void { const invalid: u32 = "bad"; _ = invalid; }', {
					stdin: ''
				});
				throw new Error('Invalid source unexpectedly compiled');
			} catch (error) {
				diagnostic = String(error);
				if (!/expected type 'u32'/.test(diagnostic)) throw error;
			}
			// A compiler error must not prevent the next real program from running.
			await execute(editorDefaults.zig, {}, '5');
			return { outputs, diagnostic, loadDurationMs, runDurationsMs };
		} finally {
			await runtime.dispose();
		}
	}, sharedStdinSource);
	assert.deepEqual(result.outputs, [
		'fibonacci=16\n',
		'main=73\n',
		'quotient=6148914691236517205;sum=42\n',
		'quotient=7;sum=42\n',
		'fibonacci=11\n'
	]);
	assert.match(result.diagnostic, /main\.zig:\d+:\d+: error:/);
	assert(requests.some((name) => name.startsWith('/wasm-zig/zig_small.wasm')));
	assert(requests.includes('/wasm-zig/std.tar.gz'));
	console.log(
		JSON.stringify(
			{
				profileId: receipt.profileId,
				fingerprint: receipt.fingerprint,
				checks: [
					'editor starter',
					'shared page/terminal stdin fixture',
					'explicit stdin/stdout',
					'nested import',
					'u128 compiler_rt',
					'cached rerun',
					'invalid diagnostic',
					'interactive stdin/EOF after error'
				],
				...result
			},
			null,
			2
		)
	);
} catch (error) {
	console.error(browserMessages.slice(-40).join('\n'));
	throw error;
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	await rm(temporary, { recursive: true, force: true });
}
