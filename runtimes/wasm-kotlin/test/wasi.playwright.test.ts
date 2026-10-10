import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, release, totalmem } from 'node:os';
import { chromium } from 'playwright-core';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Use the existing WAT producer dependency; no Kotlin language implementation is substituted.
const requireWat = createRequire(new URL('../../wasm-wat/package.json', import.meta.url));

it.skipIf(process.env.WASM_IDLE_RUN_KOTLIN_WASI_ABI !== '1')(
	'runs full-sized WASI console ABI imports in an offline Chromium Worker',
	async () => {
		const source = await readFile(new URL('../src/wasi.ts', import.meta.url), 'utf8');
		const fixture = await readFile(new URL('./wasi-probe.wat', import.meta.url), 'utf8');
		const wabt = await requireWat('wabt')();
		const parsed = wabt.parseWat('kotlin-wasi-abi-probe.wat', fixture);
		let wasmBytes: Uint8Array;
		try {
			wasmBytes = new Uint8Array(parsed.toBinary({}).buffer);
		} finally {
			parsed.destroy();
		}
		const adapterSource = ts.transpileModule(source, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
		}).outputText;
		const browser = await chromium.launch({ headless: true });
		try {
			const context = await browser.newContext();
			// Give the module Worker a normal origin without contacting a server.
			await context.route('https://kotlin-wasi-probe.invalid/**', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					body: '<!doctype html><title>WASI ABI probe</title>'
				})
			);
			const page = await context.newPage();
			await page.goto('https://kotlin-wasi-probe.invalid/');
			await context.setOffline(true);
			const networkRequests: string[] = [];
			context.on('request', (request) => networkRequests.push(request.url()));
			const result = await page.evaluate(
				async ({ adapterSource, wasmBytes }) => {
					const script =
						adapterSource +
						`
self.onmessage = async ({ data }) => {
  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
    const input = new TextEncoder().encode('한😀\\r\\n');
    const host = createKotlinWasiConsole({ memory: () => memory, stdin: input,
      maxStdinBytes: 64, maxOutputBytes: 32 });
    const { instance } = await WebAssembly.instantiate(data.wasmBytes,
      { env: { memory }, ...host.imports });
    const call = instance.exports;
    const view = new DataView(memory.buffer);
    const bytes = new Uint8Array(memory.buffer);
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    bytes.fill(0xa5, 504, 552);
    view.setBigUint64(256, 0xfedcba9876543210n, true);
    view.setUint8(264, 1);
    view.setUint32(272, 0, true);
    check(call.poll(256, 512, 1, 600) === 0, 'poll failed');
    check(view.getUint32(600, true) === 1, 'wrong event count');
    check(view.getBigUint64(512, true) === 0xfedcba9876543210n, 'wrong userdata');
    check(view.getUint16(520, true) === 0 && view.getUint8(522) === 1, 'wrong event fields');
    check(view.getBigUint64(528, true) === BigInt(input.length), 'wrong available bytes');
    check(view.getUint16(536, true) === 0, 'premature EOF');
    check(bytes.slice(504, 512).every(byte => byte === 0xa5), 'prefix canary changed');
    check(bytes.slice(544, 552).every(byte => byte === 0xa5), 'suffix canary changed');
    check(bytes.slice(538, 544).every(byte => byte === 0), 'standard padding not written');
    view.setUint32(64, 1024, true);
    view.setUint32(68, 64, true);
    check(call.read(0, 64, 1, 96) === 0, 'read failed');
    check(view.getUint32(96, true) === input.length, 'read count differs from readiness');
    check(input.every((byte, index) => bytes[1024 + index] === byte), 'poll consumed input');
    check(call.poll(256, 512, 1, 600) === 0, 'EOF poll failed');
    check(view.getBigUint64(528, true) === 0n && view.getUint16(536, true) === 1, 'EOF not ready');
    check(call.read(0, 64, 1, 96) === 0 && view.getUint32(96, true) === 0, 'read after EOF failed');
    // Split both multibyte sequences across real Wasm -> host fd_write calls.
    for (let index = 0; index < input.length; index++) {
      view.setUint32(64, 1024 + index, true);
      view.setUint32(68, 1, true);
      check(call.write(1, 64, 1, 96) === 0, 'stdout write failed');
    }
    const stderr = new TextEncoder().encode('오류');
    bytes.set(stderr, 2048);
    for (let index = 0; index < stderr.length; index++) {
      view.setUint32(64, 2048 + index, true);
      check(call.write(2, 64, 1, 96) === 0, 'stderr write failed');
    }
    const output = host.finish();
    check(output.stdout === '한😀\\r\\n' && output.stderr === '오류', 'UTF-8 stream mixing');
    check(output.outputBytes === input.length + stderr.length, 'wrong output bytes');
    check(call.read(0, 64, 1, 96) === WASI_CONSOLE_ERRNO.badf, 'finished host still open');
    self.postMessage({ ...output, fullSizedCanaries: true, eofReady: true });
  } catch (error) { self.postMessage({ error: String(error) }); }
};`;
					const url = URL.createObjectURL(
						new Blob([script], { type: 'text/javascript' })
					);
					const worker = new Worker(url, { type: 'module' });
					try {
						return await new Promise<Record<string, unknown>>((resolve, reject) => {
							const timeout = setTimeout(
								() => reject(new Error('WASI ABI Worker timed out')),
								10_000
							);
							worker.onmessage = ({ data }) => {
								clearTimeout(timeout);
								resolve(data);
							};
							worker.onerror = (event) => {
								clearTimeout(timeout);
								reject(new Error(event.message));
							};
							const buffer = new Uint8Array(wasmBytes).buffer;
							worker.postMessage({ wasmBytes: buffer }, [buffer]);
						});
					} finally {
						worker.terminate();
						URL.revokeObjectURL(url);
					}
				},
				{ adapterSource, wasmBytes: Array.from(wasmBytes) }
			);
			expect(result).toEqual({
				stdout: '한😀\r\n',
				stderr: '오류',
				outputBytes: 15,
				outputLimitExceeded: false,
				fullSizedCanaries: true,
				eofReady: true
			});
			expect(networkRequests).toEqual([]);
			if (process.env.KOTLIN_WASI_EVIDENCE_FILE) {
				const sha256 = (text: string | Uint8Array) =>
					createHash('sha256').update(text).digest('hex');
				await writeFile(
					process.env.KOTLIN_WASI_EVIDENCE_FILE,
					JSON.stringify(
						{
							schemaVersion: 1,
							kind: 'wasi-console-abi-microprobe',
							status: 'passed',
							kotlinSourceCommit: '4d78aae1e337cd40f69baa865aed950fe807a775',
							wasiLibcCommit: '165235bc467d5fa52d424f5d82587dfb76ed9d54',
							adapterSha256: sha256(source),
							fixtureSha256: sha256(fixture),
							probeSha256: sha256(await readFile(new URL(import.meta.url))),
							wasmSha256: sha256(wasmBytes),
							wasmBytes: wasmBytes.byteLength,
							command: 'pnpm test:browser:kotlin-wasi',
							environment: {
								os: `${process.platform} ${release()}`,
								arch: process.arch,
								cpu: cpus()[0]?.model ?? null,
								ramBytes: totalmem(),
								node: process.version,
								typescript: ts.version
							},
							browser: {
								name: 'Chromium',
								version: browser.version(),
								headless: true
							},
							network: { offline: true, requests: networkRequests },
							result,
							gates: {
								kotlinCompilerBuild: 'not-run',
								kotlinCompileRun: 'not-run',
								kotlinStdlibAllocatorAbi: 'not-run',
								publicLanguageSupport: false
							}
						},
						null,
						2
					) + '\n',
					{ flag: 'wx', mode: 0o600 }
				);
			}
		} finally {
			await browser.close();
		}
	},
	30_000
);
