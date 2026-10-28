#!/usr/bin/env node
// Synthetic host/transport test only. No C/C++ source is parsed or compiled.
// The factory deliberately throws if invoked; actual GCC belongs to the real
// producer bundle and scripts/verify-gcc-wasi.mjs qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { digest } from './gcc-wasi-artifact.mjs';

const enabled = process.env.WASM_IDLE_RUN_GCC_WASI_WORKER_CONTRACT === '1';
const root = fileURLToPath(new URL('../', import.meta.url));
const encoder = new TextEncoder();
const name = (value) => [encoder.encode(value).length, ...encoder.encode(value)];
const section = (id, content) => [id, content.length, ...content];
const header = [0, 97, 115, 109, 1, 0, 0, 0];
function command(body, stateful = false) {
	return Uint8Array.from([
		...header,
		...section(1, stateful ? [2, 0x60, 1, 0x7f, 0, 0x60, 0, 0] : [1, 0x60, 0, 0]),
		...(stateful
			? section(2, [1, ...name('wasi_snapshot_preview1'), ...name('proc_exit'), 0, 0])
			: []),
		...section(3, [1, stateful ? 1 : 0]),
		...section(5, [1, 0, 1]),
		...(stateful ? section(6, [1, 0x7f, 1, 0x41, 0, 0x0b]) : []),
		...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, stateful ? 1 : 0]),
		...section(10, [1, body.length + 1, 0, ...body])
	]);
}
const emptyCommand = command([0x0b]);
const statefulCommand = command([0x23, 0, 0x41, 1, 0x6a, 0x24, 0, 0x23, 0, 0x10, 0, 0x0b], true);
const trapCommand = command([0x00, 0x0b]);
const loopCommand = command([0x03, 0x40, 0x0c, 0, 0x0b, 0x0b]);

function fixtureBundle() {
	const tar = new Uint8Array(2048);
	tar.set(encoder.encode('synthetic-runtime-only.h'));
	for (const offset of [100, 108, 116]) tar.set(encoder.encode('0000000\0'), offset);
	tar.set(encoder.encode('00000000000\0'), 136);
	tar.set(encoder.encode('00000000001\0'), 124);
	tar[156] = 48;
	tar.set(encoder.encode('ustar\0'), 257);
	tar[512] = 10;
	tar.fill(32, 148, 156);
	const checksum = tar.subarray(0, 512).reduce((total, byte) => total + byte, 0);
	tar.set(encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
	const files = new Map([
		['sysroot.tar', tar],
		['ld.wasm', emptyCommand]
	]);
	for (const tool of ['cc1', 'cc1plus', 'as']) {
		files.set(`${tool}.wasm`, emptyCommand);
		files.set(
			`${tool}.mjs`,
			encoder.encode(
				'export default async function() { throw new Error("Synthetic runtime-only factory forbids source compilation"); }'
			)
		);
	}
	const revision = (family) => ({
		family,
		repository: `https://example.test/synthetic-${family}`,
		version: family === 'gcc' ? '17.0.0' : '0.0.0',
		commit: 'a'.repeat(40)
	});
	const manifest = {
		schemaVersion: 2,
		kind: 'gcc-wasm32-wasi',
		host: 'wasm32-emscripten',
		target: 'wasm32-wasi',
		compiler: revision('gcc'),
		assembler: revision('wabt'),
		linker: { ...revision('lld'), host: 'wasm32-wasi' },
		sysroot: revision('wasi-libc'),
		abi: 'wasm32-wasi-preview1',
		linkMode: 'static',
		sysrootPath: '/sysroot',
		gccInstallation: '/sysroot/lib/gcc/wasm32-wasi/17.0.0',
		resourceDir: '/sysroot/lib/gcc/wasm32-wasi/17.0.0/include',
		runtimeLibraries: [],
		capabilities: {
			c: true,
			cpp: true,
			libc: true,
			libm: true,
			libstdcxx: false,
			staticInitialization: false,
			exceptions: false,
			rtti: false,
			threads: false,
			dynamicLinking: false,
			simd: false
		},
		assets: Object.fromEntries(
			[...files].map(([path, bytes]) => [
				path === 'sysroot.tar'
					? 'sysroot'
					: path.replace('.mjs', 'Js').replace('.wasm', 'Wasm'),
				{ path, bytes: bytes.length, sha256: digest(bytes) }
			])
		),
		qualification: { status: 'unverified' }
	};
	const bytes = encoder.encode(JSON.stringify(manifest));
	files.set('gcc-toolchain.v2.json', bytes);
	return { files, manifestSha256: digest(bytes) };
}

test(
	'synthetic Chromium WASI Worker repeats, recovers from traps and terminates pending guest execution',
	{ timeout: 60_000, skip: enabled ? false : 'Set WASM_IDLE_RUN_GCC_WASI_WORKER_CONTRACT=1' },
	async (t) => {
		const [{ createServer }, { chromium }, { resolveChromiumExecutable }] = await Promise.all([
			import('vite'),
			import('playwright-core'),
			import('./rust-browser-probe-lib.mjs')
		]);
		const fixture = fixtureBundle();
		const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-wasi-worker-contract-'));
		let server;
		let browser;
		t.after(async () => {
			await browser?.close();
			await server?.close();
			await fs.rm(temporary, { recursive: true, force: true });
		});
		server = await createServer({
			configFile: false,
			root,
			cacheDir: temporary,
			logLevel: 'error',
			optimizeDeps: { noDiscovery: true },
			resolve: {
				alias: [
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
					name: 'synthetic-wasi-runtime-contract',
					configureServer(vite) {
						vite.middlewares.use((request, response, next) => {
							const url = new URL(request.url || '/', 'http://localhost');
							if (url.pathname === '/probe') {
								response.setHeader('Content-Type', 'text/html');
								response.end(
									'<!doctype html><title>Synthetic WASI Worker host contract</title>'
								);
								return;
							}
							if (!url.pathname.startsWith('/synthetic/')) return next();
							const name = url.pathname.slice('/synthetic/'.length);
							const bytes = fixture.files.get(name);
							if (!bytes) {
								response.statusCode = 404;
								response.end();
								return;
							}
							response.setHeader(
								'Content-Type',
								name.endsWith('.mjs')
									? 'text/javascript'
									: name.endsWith('.wasm')
										? 'application/wasm'
										: 'application/octet-stream'
							);
							response.end(bytes);
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
		const page = await browser.newPage();
		// Isolated loopback test origin, with no WAF or application credentials.
		await page.goto(`${origin}/probe`);
		const result = await page.evaluate(
			async ({ origin, manifestSha256, commands }) => {
				const { createGccWorker } = await import(`${origin}/packages/gcc/dist/index.js`);
				const compiler = await createGccWorker({
					target: 'wasm32-wasi',
					manifestUrl: `${origin}/synthetic/gcc-toolchain.v2.json`,
					manifestSha256
				});
				const artifact = (bytes) => ({
					compiler: 'gcc',
					compilerHost: 'wasm32-emscripten',
					target: 'wasm32-wasi',
					format: 'wasm-executable',
					fileName: 'synthetic-host-only.wasm',
					bytes: Uint8Array.from(bytes),
					cpu: 'wasm32'
				});
				try {
					let rejectedCompile = '';
					try {
						await compiler.compile({
							code: 'SYNTHETIC HOST TEST; NOT C SOURCE',
							language: 'c'
						});
					} catch (error) {
						rejectedCompile = String(error.message);
					}
					let trap = '';
					try {
						await compiler.run(artifact(commands.trap));
					} catch (error) {
						trap = String(error.message);
					}
					const reusable = artifact(commands.stateful);
					const first = await compiler.run(reusable);
					const second = await compiler.run(reusable);
					let preAborted = '';
					try {
						await compiler.run(reusable, { signal: AbortSignal.abort() });
					} catch (error) {
						preAborted = error.name;
					}
					const afterPreAborted = await compiler.run(reusable);
					const abort = new AbortController();
					const pending = compiler.run(artifact(commands.loop), { signal: abort.signal });
					let concurrent = '';
					try {
						await compiler.run(reusable);
					} catch (error) {
						concurrent = String(error.message);
					}
					setTimeout(() => abort.abort(), 100);
					let cancelled = '';
					try {
						await pending;
					} catch (error) {
						cancelled = error.name;
					}
					let disposed = '';
					try {
						await compiler.run(reusable);
					} catch (error) {
						disposed = String(error.message);
					}
					return {
						rejectedCompile,
						trap,
						first,
						second,
						preAborted,
						afterPreAborted,
						concurrent,
						cancelled,
						disposed,
						originalBytes: reusable.bytes.length
					};
				} finally {
					compiler.dispose();
				}
			},
			{
				origin,
				manifestSha256: fixture.manifestSha256,
				commands: {
					trap: [...trapCommand],
					stateful: [...statefulCommand],
					loop: [...loopCommand]
				}
			}
		);
		assert.match(
			result.rejectedCompile,
			/Synthetic runtime-only factory forbids source compilation/
		);
		assert.match(result.trap, /unreachable/);
		for (const run of [result.first, result.second, result.afterPreAborted])
			assert.equal(run.exitCode, 1, 'Each run must instantiate fresh globals');
		assert.equal(result.preAborted, 'AbortError');
		assert.match(result.concurrent, /busy/);
		assert.equal(result.cancelled, 'AbortError');
		assert.match(result.disposed, /disposed/);
		assert.equal(
			result.originalBytes,
			statefulCommand.length,
			'Running must not detach the caller artifact'
		);
	}
);
