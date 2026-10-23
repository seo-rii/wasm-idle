// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { TEAVM_RUNTIME_ASSET_NAMES } from '../../../../packages/core/src/teavm-runtime';
import { addBrowserTestCookies } from '../../../../scripts/browser-test-cookies.mjs';
import { runWithBrowserProbeSessionLock } from '../../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../../scripts/rust-browser-probe-lib.mjs';
import type Java from '../java';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_JAVA_ERRORS === '1';
const deobfuscatorAsset = 'compiler.wasm-deobfuscator.wasm';

type BrowserProbe = {
	sandbox: Java;
	output: string[];
	diagnostics: Array<{ fileName?: string | null; lineNumber?: number; message?: string }>;
	compileCalls?: number;
};

const source = `import java.io.BufferedReader;
import java.io.InputStreamReader;

public class Main {
    static void fail() {
        throw new IllegalArgumentException("bad input\\nsecond line");
    }

    public static void main(String[] args) throws Exception {
        if (args[0].equals("illegal")) fail();
        if (args[0].equals("empty")) throw new RuntimeException("");
        if (args[0].equals("null")) throw new RuntimeException();
        if (args[0].equals("korean")) throw new IllegalStateException("잘못된 입력입니다");
        if (args[0].equals("caught")) {
            try { fail(); } catch (IllegalArgumentException error) { error.printStackTrace(); }
            return;
        }
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
        System.out.println(args[1] + ":" + input.readLine());
    }
}`;

describe('TeaVM Java errors in Chromium', () => {
	it(
		'verifies the deobfuscator and reports real Java exceptions through the host and Worker',
		{
			skip: !enabled,
			meta: { browser: true, requiredBrowser: enabled },
			timeout: 600_000
		},
		async () => {
			expect.hasAssertions();
			await runWithBrowserProbeSessionLock(async () => {
				const buildOptions = {
					absWorkingDir: repoRoot,
					bundle: true,
					format: 'esm' as const,
					platform: 'browser' as const,
					write: false as const,
					alias: {
						$lib: resolve(repoRoot, 'src/lib'),
						'@wasm-idle/core': resolve(repoRoot, 'packages/core/src/index.ts')
					}
				};
				const [host, worker] = await Promise.all([
					build({
						...buildOptions,
						entryPoints: ['src/lib/playground/java.ts'],
						plugins: [
							{
								name: 'java-worker',
								setup(builder) {
									builder.onResolve(
										{ filter: /\/worker\/java\?worker$/ },
										() => ({
											path: 'java-worker',
											namespace: 'java-worker'
										})
									);
									builder.onLoad(
										{ filter: /.*/, namespace: 'java-worker' },
										() => ({
											contents:
												'export default class extends Worker { constructor() { super("/worker.js", { type: "module" }); } }',
											loader: 'js'
										})
									);
								}
							}
						]
					}),
					build({ ...buildOptions, entryPoints: ['src/lib/playground/worker/java.ts'] })
				]);
				const assets = new Map<string, Uint8Array>();
				for (const asset of TEAVM_RUNTIME_ASSET_NAMES) {
					const assetUrl = new URL(`../../../../static/teavm/${asset}`, import.meta.url);
					const bytes = await readFile(assetUrl).catch(
						async (error: NodeJS.ErrnoException) => {
							if (error.code !== 'ENOENT') throw error;
							return gunzipSync(await readFile(new URL(`${assetUrl.href}.gz`)));
						}
					);
					assets.set(`/teavm/${asset}`, bytes);
				}
				const requests: string[] = [];
				let corruptDeobfuscator = true;
				const server = createServer((request, response) => {
					const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
					response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
					response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
					response.setHeader('Cache-Control', 'no-store');
					if (pathname === '/') {
						response.setHeader('Content-Type', 'text/html');
						response.end(`<!doctype html><title>Java error regression</title>
<script type="module">
import Java from '/java.js';
globalThis.JavaSandbox = Java;
</script>`);
						return;
					}
					if (pathname === '/java.js' || pathname === '/worker.js') {
						response.setHeader('Content-Type', 'text/javascript');
						const instrumentation = `
let auditCompileCalls = 0;
const auditCompile = WebAssembly.compile;
WebAssembly.compile = (...args) => { auditCompileCalls++; return auditCompile(...args); };
const auditPost = self.postMessage.bind(self);
self.postMessage = (message, ...args) => auditPost({ ...message, auditCompileCalls }, ...args);
`;
						response.end(
							pathname === '/java.js'
								? host.outputFiles[0]!.contents
								: instrumentation + worker.outputFiles[0]!.text
						);
						return;
					}
					const asset = assets.get(pathname);
					if (!asset) {
						response.writeHead(404).end();
						return;
					}
					requests.push(pathname);
					const bytes = Uint8Array.from(asset);
					if (pathname === `/teavm/${deobfuscatorAsset}` && corruptDeobfuscator) {
						bytes[bytes.length - 1] ^= 0xff;
						corruptDeobfuscator = false;
					}
					response.setHeader(
						'Content-Type',
						pathname.endsWith('.wasm')
							? 'application/wasm'
							: pathname.endsWith('.js')
								? 'text/javascript'
								: 'application/octet-stream'
					);
					response.setHeader('Content-Length', bytes.length);
					response.end(bytes);
				});
				await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
				const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
				let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
				try {
					browser = await chromium.launch({
						executablePath: await resolveChromiumExecutable(
							process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
						),
						headless: true,
						args: ['--no-sandbox']
					});
					const context = await browser.newContext();
					await addBrowserTestCookies(context, origin);
					const page = await context.newPage();
					const pageErrors: string[] = [];
					page.on('pageerror', (error) => pageErrors.push(error.message));
					await page.goto(origin);
					const failedLoad = await page.evaluate(async () => {
						const JavaSandbox = (
							globalThis as unknown as { JavaSandbox: new () => Java }
						).JavaSandbox;
						const sandbox = new JavaSandbox();
						const probe: BrowserProbe = { sandbox, output: [], diagnostics: [] };
						(globalThis as unknown as { javaErrorProbe: BrowserProbe }).javaErrorProbe =
							probe;
						sandbox.output = (text: string) => probe.output.push(text);
						sandbox.oncompilerdiagnostic = (
							diagnostic: BrowserProbe['diagnostics'][number]
						) => probe.diagnostics.push(diagnostic);
						try {
							await sandbox.load({
								rootUrl: location.origin,
								persistentCache: { enabled: false }
							});
							return { error: '', released: false };
						} catch (error) {
							return {
								error: String(error),
								released: !sandbox.worker && sandbox.assetBridge === null
							};
						}
					});
					expect(failedLoad.error).toMatch(
						/compiler\.wasm-deobfuscator\.wasm.*SHA-256 mismatch/u
					);
					expect(failedLoad.released).toBe(true);
					const successfulLoadRequestStart = requests.length;
					await page.evaluate(async () => {
						const { sandbox } = (
							globalThis as unknown as { javaErrorProbe: BrowserProbe }
						).javaErrorProbe;
						await sandbox.load({
							rootUrl: location.origin,
							persistentCache: { enabled: false }
						});
					});
					expect(requests.slice(successfulLoadRequestStart).sort()).toEqual(
						TEAVM_RUNTIME_ASSET_NAMES.map((asset) => `/teavm/${asset}`).sort()
					);

					await page.evaluate(() => {
						const probe = (globalThis as unknown as { javaErrorProbe: BrowserProbe })
							.javaErrorProbe;
						probe.sandbox.worker!.addEventListener('message', (event) => {
							if (typeof event.data.auditCompileCalls === 'number')
								probe.compileCalls = event.data.auditCompileCalls;
						});
					});
					const run = (code: string, args: string[], stdin = '') =>
						page.evaluate(
							async ({ code, args, stdin }) => {
								const { sandbox, output, diagnostics } = (
									globalThis as unknown as { javaErrorProbe: BrowserProbe }
								).javaErrorProbe;
								output.length = 0;
								diagnostics.length = 0;
								const start = performance.now();
								try {
									const result = await sandbox.run(
										code,
										false,
										true,
										undefined,
										args,
										{
											stdin,
											limits: {
												compileTimeoutMs: 60_000,
												runTimeoutMs: 60_000
											}
										}
									);
									return {
										result,
										error: '',
										output: output.join(''),
										chunks: output.length,
										firstChunks: output.slice(0, 16),
										compileCalls: (
											globalThis as unknown as {
												javaErrorProbe: BrowserProbe;
											}
										).javaErrorProbe.compileCalls,
										diagnostics,
										elapsedMs: performance.now() - start
									};
								} catch (error) {
									return {
										result: false,
										error: typeof error === 'string' ? error : String(error),
										output: output.join(''),
										chunks: output.length,
										firstChunks: output.slice(0, 16),
										compileCalls: (
											globalThis as unknown as {
												javaErrorProbe: BrowserProbe;
											}
										).javaErrorProbe.compileCalls,
										diagnostics,
										elapsedMs: performance.now() - start
									};
								}
							},
							{ code, args, stdin }
						);
					const illegal = await run(source, ['illegal']);
					expect(illegal.error).toContain(
						'java.lang.IllegalArgumentException: bad input\nsecond line'
					);
					expect(illegal.error).toContain('at Main.fail(Main.java:6)');
					expect(illegal.error).toContain('at Main.main(Main.java:10)');
					for (const mode of ['null', 'empty']) {
						const failure = await run(source, [mode]);
						expect(failure.error).toContain('java.lang.RuntimeException');
						expect(failure.error).toMatch(/at Main\.main\(Main\.java:\d+\)/u);
						expect(failure.error).not.toMatch(
							/could not fetch message|timed out|FakeClass/u
						);
						expect(failure.elapsedMs).toBeLessThan(20_000);
					}
					const korean = await run(source, ['korean']);
					expect(korean.error).toContain(
						'java.lang.IllegalStateException: 잘못된 입력입니다'
					);
					const caught = await run(source, ['caught']);
					expect(caught.result).toBe(true);
					expect(caught.output).toContain(
						'java.lang.IllegalArgumentException: bad input\nsecond line'
					);
					expect(caught.output).toContain('at Main.fail(Main.java:6)');
					expect(caught.output).toMatch(/at Main\.main\(Main\.java:\d+\)/u);
					expect(caught.output).not.toContain('FakeClass');
					const firstSuccess = await run(source, ['success', 'first'], '5\n');
					const secondSuccess = await run(source, ['success', 'second'], '8\n');
					expect(firstSuccess).toMatchObject({
						result: true,
						error: '',
						output: 'first:5\n'
					});
					expect(secondSuccess).toMatchObject({
						result: true,
						error: '',
						output: 'second:8\n'
					});
					expect(secondSuccess.compileCalls).toBe(firstSuccess.compileCalls);
					const outputProgram = `public class Main {
                        static int counter;
                        public static void main(String[] args) {
                            System.out.print("한🙂:" + (++counter) + ":");
                            System.out.flush();
                            for (int i = 0; i < 10000; i++) System.out.println("x");
                            for (int i = 0; i < 30000; i++) System.out.print("z");
                            System.err.print("끝");
                        }
                    }`;
					const outputFirst = await run(outputProgram, []);
					const outputSecond = await run(outputProgram, []);
					for (const result of [outputFirst, outputSecond]) {
						expect(result.error).toBe('');
						expect(result.output).toBe(
							'한🙂:1:' + 'x\n'.repeat(10000) + 'z'.repeat(30000) + '끝'
						);
						expect(result.chunks).toBeLessThan(500);
						expect(
							result.firstChunks.some(
								(_, index) =>
									result.firstChunks.slice(0, index + 1).join('') === '한🙂:1:'
							)
						).toBe(true);
					}
					expect(outputSecond.compileCalls).toBe(outputFirst.compileCalls);
					console.log(
						JSON.stringify({
							javaPerformance: {
								browser: await browser.version(),
								firstMs: outputFirst.elapsedMs,
								warmMs: outputSecond.elapsedMs,
								outputMessages: outputSecond.chunks,
								compileCallsFirst: outputFirst.compileCalls,
								compileCallsWarm: outputSecond.compileCalls
							}
						})
					);
					const compileFailure = await run(
						`public class Main {
    public static void main(String[] args) {
        int first = unknownFirst;
        int second = unknownSecond;
    }
}`,
						[]
					);
					expect(compileFailure.result).toBe(false);
					expect(compileFailure.error).toMatch(/Main\.java:3(?::\d+)?: error:/u);
					expect(compileFailure.error).toMatch(/Main\.java:4(?::\d+)?: error:/u);
					expect(compileFailure.error.split('\n').length).toBeGreaterThan(1);
					expect(compileFailure.diagnostics).toHaveLength(2);
					expect(pageErrors).toEqual([]);
					await page.evaluate(async () => {
						await (
							globalThis as unknown as { javaErrorProbe: BrowserProbe }
						).javaErrorProbe.sandbox.dispose();
					});
				} finally {
					await browser?.close();
					await new Promise<void>((done, reject) =>
						server.close((error) => (error ? reject(error) : done()))
					);
				}
			});
		}
	);
});
