#!/usr/bin/env node
// Synthetic transport/runtime test ONLY. The JS loaders below do not parse or
// compile C/C++; the tiny Wasm only exports memory. Actual GCC qualification is
// scripts/verify-x86-cross-gcc.mjs with a real producer bundle.
// Run: pnpm run test:browser:gcc-worker-contract
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.WASM_IDLE_RUN_GCC_WORKER_BROWSER === '1';
const encoder = new TextEncoder();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const memoryOnlyWasm = Uint8Array.from([
	0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0
]);

function syntheticTar() {
	const bytes = new Uint8Array(2048);
	bytes.set(encoder.encode('usr/include/synthetic.h'));
	for (const offset of [100, 108, 116]) bytes.set(encoder.encode('0000000\0'), offset);
	bytes.set(encoder.encode('00000000000\0'), 136);
	bytes.set(encoder.encode('00000000001\0'), 124);
	bytes[156] = 48;
	bytes.set(encoder.encode('ustar\0'), 257);
	bytes[512] = 10;
	bytes.fill(32, 148, 156);
	const checksum = bytes.subarray(0, 512).reduce((sum, value) => sum + value, 0);
	bytes.set(encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
	return bytes;
}

function syntheticBundle() {
	const files = new Map([['sysroot.tar', syntheticTar()]]);
	for (const tool of ['cc1', 'cc1plus', 'as', 'ld']) {
		const source = `// SYNTHETIC HOST CONTRACT ONLY: no source parsing or GCC implementation.
export default async function(options) {
  const files = new Map();
  let memory;
  options.instantiateWasm({}, instance => { memory = instance.exports.memory; });
  return {
    HEAPU8: new Uint8Array(memory.buffer),
    FS: {
      mkdirTree() {}, chdir() {},
      writeFile(path, bytes) { files.set(path, Uint8Array.from(bytes)); },
      readFile(path) { if (!files.has(path)) throw Error('Synthetic missing output'); return files.get(path); },
      mount(type) { type.mount({}); },
      createNode(parent, name, mode) { return { name, mode }; },
      ErrnoError: class { constructor(errno) { this.errno = errno; } }
    },
    callMain(argv) {
      const input = ${JSON.stringify(tool)}.startsWith('cc1') ? files.get(argv[argv.indexOf('-o') - 1]) : undefined;
      if (input?.[0] === 66) { while (true) {} } // Terminate must interrupt synchronous work.
      if (input?.[0] === 33) { options.printErr('Synthetic diagnostic failure'); options.onExit?.(9); return 9; }
      const output = argv[argv.indexOf('-o') + 1], tool = ${JSON.stringify(tool)};
      let bytes;
      if (tool.startsWith('cc1')) bytes = new TextEncoder().encode('# SYNTHETIC ASSEMBLY CONTRACT FIXTURE\\n.text\\n');
      else {
        bytes = new Uint8Array(tool === 'as' ? 64 : 120);
        const view = new DataView(bytes.buffer);
        bytes.set([127, 69, 76, 70, 2, 1, 1]);
        view.setUint16(16, tool === 'as' ? 1 : 2, true); view.setUint16(18, 62, true);
        view.setUint32(20, 1, true); view.setUint16(52, 64, true);
        if (tool === 'ld') {
          view.setBigUint64(32, 64n, true); view.setUint16(54, 56, true);
          view.setUint16(56, 1, true); view.setUint32(64, 1, true);
        }
      }
      files.set(output, bytes); return 0;
    }
  };
}`;
		files.set(`${tool}.mjs`, encoder.encode(source));
		files.set(`${tool}.wasm`, memoryOnlyWasm);
	}
	const assets = Object.fromEntries(
		[...files].map(([name, bytes]) => [
			name === 'sysroot.tar'
				? 'sysroot'
				: name.replace('.mjs', 'Js').replace('.wasm', 'Wasm'),
			{ path: name, bytes: bytes.length, sha256: hash(bytes) }
		])
	);
	const manifest = {
		schemaVersion: 1,
		kind: 'gcc-x86_64-linux-gnu',
		host: 'wasm32-emscripten',
		target: 'x86_64-linux-gnu',
		compiler: { family: 'gcc', version: '16.2.0' },
		cpuProfiles: ['x86-64', 'avx2-fma'],
		linkMode: 'static',
		sysrootPath: '/sysroot',
		gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/16',
		resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/16/include',
		assets,
		gnu: { gccVersion: '16', glibcVersion: '2.39', distribution: 'SYNTHETIC CONTRACT PROBE' },
		qualification: { status: 'unverified' }
	};
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	files.set('gcc-toolchain.v1.json', manifestBytes);
	return { files, manifestSha256: hash(manifestBytes) };
}

test(
	'synthetic Chromium GCC Worker transport, integrity and hard cancellation (not real GCC)',
	{
		timeout: 60_000,
		skip: enabled
			? false
			: 'Run pnpm run test:browser:gcc-worker-contract with Chromium installed'
	},
	async (t) => {
		const [{ createServer }, { chromium }, { resolveChromiumExecutable }] = await Promise.all([
			import('vite'),
			import('playwright-core'),
			import('./rust-browser-probe-lib.mjs')
		]);
		const fixture = syntheticBundle();
		const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-synthetic-worker-'));
		let browser, server;
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
						find: /^@wasm-idle\/gcc$/,
						replacement: path.join(root, 'packages/gcc/src/index.ts')
					},
					{
						find: /^@wasm-idle\/core$/,
						replacement: path.join(root, 'packages/core/src/index.ts')
					},
					{
						find: /^@wasm-idle\/core\/runtime-asset-loader$/,
						replacement: path.join(root, 'packages/core/src/runtime-asset-loader.ts')
					},
					{
						find: /^@wasm-idle\/core\/runtime-tar$/,
						replacement: path.join(root, 'packages/core/src/runtime-tar.ts')
					}
				]
			},
			server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
			plugins: [
				{
					name: 'synthetic-gcc-worker-fixture',
					configureServer(vite) {
						vite.middlewares.use((request, response, next) => {
							const url = new URL(request.url, 'http://localhost');
							if (url.pathname === '/probe') {
								response.setHeader('Content-Type', 'text/html');
								response.end(
									'<!doctype html><title>Synthetic GCC Worker contract test</title>'
								);
								return;
							}
							if (!/^\/(fixture|corrupt)\//.test(url.pathname)) return next();
							const name = url.pathname.split('/').at(-1);
							let bytes = fixture.files.get(name);
							if (!bytes) {
								response.statusCode = 404;
								response.end();
								return;
							}
							if (url.pathname.startsWith('/corrupt/') && name === 'cc1plus.mjs') {
								bytes = Uint8Array.from(bytes);
								bytes[0] ^= 1;
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
		// Isolated loopback fixture server; no protected development origin or WAF.
		await page.goto(`${origin}/probe`);
		const result = await page.evaluate(
			async ({ origin, manifestSha256 }) => {
				const work = (async () => {
					const { createCrossGccWorker } = await import(
						`${origin}/packages/gcc/src/index.ts`
					);
					let integrityRejected = false;
					try {
						const invalid = await createCrossGccWorker({
							manifestUrl: `${origin}/corrupt/gcc-toolchain.v1.json`,
							manifestSha256
						});
						invalid.dispose();
					} catch {
						integrityRejected = true;
					}
					if (!integrityRejected) throw Error('Tampered synthetic loader was accepted');
					const compiler = await createCrossGccWorker({
						manifestUrl: `${origin}/fixture/gcc-toolchain.v1.json`,
						manifestSha256
					});
					try {
						const outputs = [];
						for (const emit of ['assembly', 'object', 'executable']) {
							const compiled = await compiler.compile({
								code: 'Synthetic fixture',
								cpu: 'avx2',
								emit
							});
							if (compiled.exitCode !== 0 || !compiled.artifact)
								throw Error('Missing synthetic output');
							outputs.push({
								emit,
								format: compiled.artifact.format,
								cpu: compiled.artifact.cpu,
								argv: compiled.stages[0].argv,
								stageCount: compiled.stages.length,
								bytes: compiled.artifact.bytes.length
							});
						}
						const multiple = await compiler.compile({
							code: 'Synthetic primary fixture',
							files: [
								{ path: 'helper.cpp', contents: 'Synthetic secondary fixture' }
							],
							sources: ['helper.cpp']
						});
						if (
							multiple.exitCode !== 0 ||
							!multiple.artifact ||
							multiple.stages.length !== 5
						)
							throw Error('Multiple-unit Worker request did not reach every stage');
						const secondaryFailure = await compiler.compile({
							code: 'Synthetic primary fixture',
							files: [
								{ path: 'helper.cpp', contents: '! synthetic secondary failure' }
							],
							sources: ['helper.cpp']
						});
						if (
							secondaryFailure.exitCode !== 9 ||
							secondaryFailure.artifact ||
							secondaryFailure.stages.length !== 3
						)
							throw Error(
								'Failed secondary unit returned stale output or reached the linker'
							);
						const failure = await compiler.compile({
							code: '! synthetic failure',
							emit: 'executable'
						});
						if (failure.exitCode !== 9 || failure.artifact)
							throw Error('Stale synthetic artifact');
						const abort = new AbortController(),
							start = performance.now();
						const pending = compiler.compile(
							{ code: 'Block synchronously', emit: 'assembly' },
							{ signal: abort.signal }
						);
						setTimeout(() => abort.abort(), 100);
						let cancelled = false;
						try {
							await pending;
						} catch (error) {
							cancelled = error.name === 'AbortError';
						}
						if (!cancelled) throw Error('Hard Worker cancellation failed');
						let disposed = false;
						try {
							await compiler.compile({ code: 'Synthetic fixture' });
						} catch {
							disposed = true;
						}
						if (!disposed) throw Error('Terminated Worker accepted another request');
						return {
							outputs,
							multipleUnitsPassed: true,
							integrityRejected,
							staleArtifactRejected: true,
							cancellationMs: performance.now() - start,
							terminatedWorkerRejected: true
						};
					} finally {
						compiler.dispose();
					}
				})();
				return await Promise.race([
					work,
					new Promise((_, reject) =>
						setTimeout(() => reject(Error('Synthetic browser probe timed out')), 15_000)
					)
				]);
			},
			{ origin, manifestSha256: fixture.manifestSha256 }
		);
		assert.deepEqual(
			result.outputs.map((output) => output.stageCount),
			[1, 2, 3]
		);
		assert.deepEqual(
			result.outputs.map((output) => output.format),
			['assembly', 'elf-object', 'elf-executable']
		);
		for (const output of result.outputs) {
			assert.equal(output.cpu, 'avx2');
			assert(output.argv.includes('-mavx2') && output.argv.includes('-mno-fma'));
			assert(!output.argv.includes('-mfma'));
		}
		t.diagnostic(
			JSON.stringify({
				kind: 'synthetic-chromium-worker-contract-only',
				browser: await browser.version(),
				...result
			})
		);
		await t.test(
			'the example keeps the submitted request while its inputs are edited',
			async () => {
				// Isolate the UI boundary with a delayed factory; no GCC is invoked by this subtest.
				await page.route('**/packages/gcc/src/index.ts', (route) =>
					route.fulfill({
						contentType: 'text/javascript',
						body: `export async function createCrossGccWorker(options) {
  const call = {
    manifestUrl: options.manifestUrl,
    manifestSha256: options.manifestSha256,
    requests: []
  };
  (globalThis.gccUiCalls ??= []).push(call);
  await new Promise(resolve => { call.finishInitialization = resolve; });
  return {
    identity: { compilerVersion: 'synthetic UI fixture' },
    manifest: { qualification: { status: 'unverified' } },
    async compile(request) {
      call.requests.push(request);
      return { exitCode: 1, stdout: '', stderr: 'Synthetic UI fixture; no GCC invoked', stages: [] };
    },
    dispose() {}
  };
}`
					})
				);
				await page.goto(`${origin}/examples/gcc-cross/`);
				const submitted = {
					manifestUrl: `${origin}/first/gcc-toolchain.v1.json`,
					manifestSha256: 'a'.repeat(64),
					code: 'int main(void) { return 7; }',
					language: 'c',
					cpu: 'x86-64',
					emit: 'assembly',
					optimization: '0'
				};
				const edited = {
					manifestUrl: `${origin}/second/gcc-toolchain.v1.json`,
					manifestSha256: 'b'.repeat(64),
					code: 'int main() { return 19; }',
					language: 'cpp',
					cpu: 'avx2',
					emit: 'object',
					optimization: '3'
				};
				async function editInputs(values) {
					await page.locator('#manifest').fill(values.manifestUrl);
					await page.locator('#sha256').fill(values.manifestSha256);
					await page.locator('#source').fill(values.code);
					for (const name of ['language', 'cpu', 'emit', 'optimization']) {
						await page.locator(`#${name}`).selectOption(values[name]);
					}
				}
				async function completeSubmission(index, values) {
					await page.evaluate(
						(index) => globalThis.gccUiCalls[index].finishInitialization(),
						index
					);
					await page.waitForFunction(() => !document.getElementById('compile').disabled);
					const actual = await page.evaluate((index) => {
						const { manifestUrl, manifestSha256, requests } =
							globalThis.gccUiCalls[index];
						return { manifestUrl, manifestSha256, requests };
					}, index);
					const { manifestUrl, manifestSha256, ...request } = values;
					assert.deepEqual(actual, { manifestUrl, manifestSha256, requests: [request] });
				}
				await editInputs(submitted);
				await page.locator('#compile').click();
				await page.waitForFunction(() => globalThis.gccUiCalls?.length === 1);
				await editInputs(edited);
				await completeSubmission(0, submitted);
				await page.locator('#compile').click();
				await page.waitForFunction(() => globalThis.gccUiCalls.length === 2);
				await completeSubmission(1, edited);
			}
		);
	}
);
