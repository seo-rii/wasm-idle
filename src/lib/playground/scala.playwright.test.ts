// @vitest-environment node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext } from 'playwright-core';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { createCoreSourceAliases } from '../../../scripts/core-source-aliases.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_SCALA === '1';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const revision = '357051c857d4ffd5d1e1bfc9a56f0cbf5943a325';
const upstream = `https://raw.githubusercontent.com/pgilliar/scala3-compiler-sjs/${revision}/compiler/browser-ide/assets/`;
const hello = `object Main:
  def main(args: Array[String]): Unit = println("hello=" + args.mkString("|"))
`;
const input = `object Main:
  def main(args: Array[String]): Unit =
    var line = scala.io.StdIn.readLine()
    while line != null do
      println("[" + line + "]")
      line = scala.io.StdIn.readLine()
    println("EOF")
`;
const loop = `object Main:
  def main(args: Array[String]): Unit =
    println("started")
    while true do ()
`;
const state = `object Main:
  private var starts = 0
  def main(args: Array[String]): Unit =
    starts += 1
    println("starts=" + starts)
`;

it(
	'compiles real Scala through the public Sandbox, with verified cached assets, diagnostics, stdin and recovery',
	{
		skip: !enabled,
		meta: { browser: true, requiredBrowser: enabled },
		timeout: 900_000
	},
	async () => {
		const lock = JSON.parse(
			await readFile(`${root}runtimes/wasm-scala/assets.lock.json`, 'utf8')
		) as { files: { path: string; bytes: number; sha256: string }[] };
		const sourceFiles = [
			'src/lib/playground/scala.ts',
			'src/lib/playground/scalaAssets.ts',
			'src/lib/playground/scalaDiagnostics.ts',
			'src/lib/playground/scala.playwright.test.ts',
			...(await readdir(`${root}src/lib/playground/worker/scala`))
				.filter((name) => name.endsWith('.js'))
				.map((name) => `src/lib/playground/worker/scala/${name}`)
		];
		const adapterSources = await Promise.all(
			sourceFiles.map(async (path) => {
				const bytes = await readFile(`${root}${path}`);
				return {
					path,
					bytes: bytes.length,
					sha256: createHash('sha256').update(bytes).digest('hex')
				};
			})
		);
		const assets = new Map<string, Buffer>();
		for (const entry of lock.files) {
			const bytes = await readFile(`${root}runtimes/wasm-scala/assets/${entry.path}`);
			expect(bytes.length).toBe(entry.bytes);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
			assets.set(entry.path, bytes);
		}
		const server = await createServer({
			configFile: false,
			root,
			publicDir: false,
			cacheDir: `${root}.cache/scala-browser-vite`,
			optimizeDeps: { noDiscovery: true },
			define: {
				__WASM_IDLE_BUILD__: JSON.stringify({
					commit: 'scala-browser-test',
					builtAt: '',
					runtimeAssets: {}
				})
			},
			resolve: {
				alias: [
					{ find: '$lib', replacement: `${root}src/lib` },
					...createCoreSourceAliases(root)
				]
			},
			plugins: [
				{
					name: 'scala-sandbox-test-page',
					configureServer(vite) {
						vite.middlewares.use((request, response, next) => {
							if (request.url !== '/') return next();
							response.setHeader('Content-Type', 'text/html');
							response.end(
								'<!doctype html><title>Scala playground qualification</title>'
							);
						});
					}
				}
			],
			server: {
				watch: null,
				host: '127.0.0.1',
				port: 0,
				headers: {
					'Cross-Origin-Opener-Policy': 'same-origin',
					'Cross-Origin-Embedder-Policy': 'require-corp'
				}
			}
		});
		await server.listen();
		const address = server.httpServer!.address();
		if (!address || typeof address === 'string') throw new Error('Missing Scala fixture port');
		const url = `http://127.0.0.1:${address.port}/`;
		const browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		let context: BrowserContext | undefined;
		try {
			context = await browser.newContext();
			await addBrowserTestCookies(context, url);
			let downloads = 0;
			let offline = false;
			let corrupt = false;
			await context.route(`${upstream}**`, async (route) => {
				downloads++;
				if (offline) return route.abort('internetdisconnected');
				const name = route.request().url().slice(upstream.length);
				const payload = assets.get(name);
				if (!payload) return route.abort('failed');
				await route.fulfill({
					body: corrupt ? Buffer.from('corrupt Scala asset') : payload,
					contentType: name.endsWith('.js')
						? 'text/javascript'
						: name.endsWith('.json')
							? 'application/json'
							: 'application/octet-stream',
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Cross-Origin-Resource-Policy': 'cross-origin'
					}
				});
			});
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));
			await page.goto(url);
			await page.addScriptTag({
				type: 'module',
				content: `
import Scala from '/src/lib/playground/scala.ts';
import { playgroundLanguageDescriptors, playgroundLanguages } from '/src/routes/language-registry.ts';
globalThis.__scalaQualification = { Scala, playgroundLanguageDescriptors, playgroundLanguages };
`
			});
			await page.waitForFunction(() => Boolean((globalThis as any).__scalaQualification));
			const registration = await page.evaluate(() => {
				const q = (globalThis as any).__scalaQualification;
				return {
					included: q.playgroundLanguages.includes('SCALA'),
					descriptor: q.playgroundLanguageDescriptors.SCALA
				};
			});
			expect(registration.included).toBe(true);
			expect(registration.descriptor.editorLanguage).toBe('scala');
			expect(registration.descriptor.supportsArgs).toBe(true);
			expect(registration.descriptor.compilerDiagnostics).toBe(true);
			const reports: Record<string, any> = {};
			await page.evaluate(async () => {
				const q = (globalThis as any).__scalaQualification;
				const NativeWorker = globalThis.Worker;
				q.workers = { live: new Set(), peak: 0 };
				globalThis.Worker = class extends NativeWorker {
					constructor(url: string | URL, options?: WorkerOptions) {
						super(url, options);
						q.workers.live.add(this);
						q.workers.peak = Math.max(q.workers.peak, q.workers.live.size);
					}
					terminate() {
						q.workers.live.delete(this);
						super.terminate();
					}
				};
				q.sandbox = new q.Scala();
				q.options = {
					activePath: 'Main.scala',
					stdin: '',
					persistentCache: {
						namespace: 'scala-playground-browser',
						storageReserveBytes: 0
					},
					limits: {
						compileTimeoutMs: 120000,
						startupTimeoutMs: 120000,
						runTimeoutMs: 10000,
						maxWorkers: 2
					}
				};
				await q.sandbox.load(undefined, undefined, true, [], q.options);
			});
			async function run(
				name: string,
				source: string,
				options: Record<string, unknown> = {},
				args: string[] = [],
				mode = ''
			) {
				const result = await page.evaluate(
					async ({ source, options, args, mode }) => {
						const q = (globalThis as any).__scalaQualification;
						let output = '';
						const diagnostics: any[] = [];
						const controller = new AbortController();
						q.sandbox.output = (text: string) => {
							output += text;
							if (!output.includes('started\n')) return;
							if (mode === 'stop') q.sandbox.terminate();
							if (mode === 'abort') controller.abort();
						};
						q.sandbox.oncompilerdiagnostic = (diagnostic: unknown) =>
							diagnostics.push(diagnostic);
						const started = performance.now();
						try {
							const value = await q.sandbox.run(
								source,
								false,
								true,
								undefined,
								args,
								{
									...q.options,
									...options,
									...(mode === 'abort' ? { signal: controller.signal } : {})
								}
							);
							return {
								value,
								output,
								diagnostics,
								elapsedMs: performance.now() - started
							};
						} catch (error) {
							return {
								error: (error as any).code,
								limit: (error as any).limit,
								actual: (error as any).actual,
								message: String(error),
								output,
								diagnostics,
								elapsedMs: performance.now() - started
							};
						}
					},
					{ source, options, args, mode }
				);
				reports[name] = {
					...result,
					sourceSha256: createHash('sha256').update(source).digest('hex')
				};
				return result;
			}
			expect((await run('hello', hello, {}, ['one', '둘'])).output).toBe('hello=one|둘\n');
			expect(
				(
					await run(
						'features',
						`case class Item(value: Int)
trait Render:
  def render(value: Int): String
given Render with
  def render(value: Int): String = s"value=$value"
def show(value: Int)(using render: Render): String = render.render(value)
object Main:
  def main(args: Array[String]): Unit =
    val sum = List(Item(1), Item(2), Item(3)).map { case Item(n) => n * 2 }.sum
    println(show(sum))
`
					)
				).output
			).toBe('value=12\n');
			expect((await run('stdin', input, { stdin: '한글😀\n\ntail' })).output).toBe(
				'[한글😀]\n[]\n[tail]\nEOF\n'
			);
			expect((await run('empty-eof', input)).output).toBe('EOF\n');
			expect(
				(
					await run(
						'exact-output',
						`object Main:
  def main(args: Array[String]): Unit =
    Console.print("\\uFEFF \\t\\n\\nlast")
    Console.err.print("\\nerr\\n")
`
					)
				).output
			).toBe('\uFEFF \t\n\nlast\nerr\n');
			for (const name of ['state-first', 'state-second'])
				expect((await run(name, state)).output).toBe('starts=1\n');
			const bad = await run(
				'type-error',
				`object Main:
  def main(args: Array[String]): Unit =
    val value: Int = "invalid"
    println(value)
`
			);
			expect(bad.output).toBe('');
			expect(bad.value === false || bad.error !== undefined).toBe(true);
			expect(
				bad.diagnostics.some(
					(d: any) =>
						d.severity === 'error' &&
						d.lineNumber === 3 &&
						/Main\.scala$/.test(d.fileName)
				)
			).toBe(true);
			expect((await run('error-recovery', hello)).output).toBe('hello=\n');
			const main =
				'object Main:\n  def main(args: Array[String]): Unit = println(example.Helper.message)\n';
			expect(
				(
					await run('workspace', main, {
						workspaceFiles: [
							{ path: 'Main.scala', content: main },
							{
								path: 'example/Helper.scala',
								content:
									'package example\nobject Helper:\n  val message = "workspace"\n'
							}
						]
					})
				).output
			).toBe('workspace\n');
			for (const mode of ['stop', 'abort']) {
				const result = await run(mode, loop, {}, [], mode);
				expect(result.message).toMatch(/cancel|abort|terminat/i);
				expect(result.output).toBe('started\n');
				expect((await run(`${mode}-recovery`, hello)).output).toBe('hello=\n');
			}
			const timeout = await run('timeout', loop, {
				limits: { compileTimeoutMs: 120000, runTimeoutMs: 100, maxWorkers: 2 }
			});
			expect(timeout.message).toMatch(/timed out|timeout/i);
			expect((await run('timeout-recovery', hello)).output).toBe('hello=\n');
			const diagnosticLimit = await run(
				'diagnostic-byte-limit',
				`object Main:
  def main(args: Array[String]): Unit =
    val value: Int = "bad"
    println(value)
`,
				{ limits: { compileTimeoutMs: 120000, maxOutputBytes: 64, maxWorkers: 2 } }
			);
			expect(diagnosticLimit.error).toBe('diagnostic-limit');
			expect(diagnosticLimit.limit).toBe(64);
			expect(diagnosticLimit.actual).toBeGreaterThan(64);
			expect((await run('diagnostic-limit-recovery', hello)).output).toBe('hello=\n');
			const limited = await run(
				'output-limit-caught',
				`object Main:
  def main(args: Array[String]): Unit =
    try Console.print("x" * 65)
    catch case _: Throwable => ()
`,
				{
					limits: {
						compileTimeoutMs: 120000,
						runTimeoutMs: 10000,
						maxWorkers: 2,
						maxOutputBytes: 64
					}
				}
			);
			expect(limited.message).toMatch(/output.*exceeds|output.*limit/i);
			expect(new TextEncoder().encode(limited.output).length).toBeLessThanOrEqual(64);
			expect((await run('output-limit-recovery', hello)).output).toBe('hello=\n');
			await page.evaluate(async () => {
				const q = (globalThis as any).__scalaQualification;
				await q.sandbox.dispose();
				q.sandbox = new q.Scala();
				q.workers.peak = q.workers.live.size;
			});
			expect(
				(
					await run('single-worker-budget', hello, {
						limits: { compileTimeoutMs: 120000, maxWorkers: 1 }
					})
				).output
			).toBe('hello=\n');
			expect(
				await page.evaluate(() => (globalThis as any).__scalaQualification.workers.peak)
			).toBe(1);
			// A new Sandbox cannot reuse the compiler instance: this exercises persisted assets.
			await page.evaluate(async () => {
				const q = (globalThis as any).__scalaQualification;
				await q.sandbox.dispose();
				q.sandbox = new q.Scala();
			});
			const beforeOffline = downloads;
			offline = true;
			const offlineRun = await run('offline-new-sandbox', hello);
			expect(offlineRun).toMatchObject({ output: 'hello=\n' });
			expect(downloads).toBe(beforeOffline);
			await page.evaluate(async () =>
				(globalThis as any).__scalaQualification.sandbox.dispose()
			);
			// Distinct cache namespace prevents a good cached copy masking corrupt downloads.
			offline = false;
			corrupt = true;
			const rejected = await page.evaluate(async () => {
				const q = (globalThis as any).__scalaQualification;
				const sandbox = new q.Scala();
				try {
					await sandbox.load(undefined, undefined, true, [], {
						...q.options,
						persistentCache: false
					});
					return { accepted: true };
				} catch (error) {
					return { accepted: false, message: String(error) };
				} finally {
					await sandbox.dispose();
				}
			});
			expect(rejected.accepted).toBe(false);
			expect(rejected.message).toMatch(/integrity|bytes|size|receipt|mismatch/i);
			const beforeUnsupported = downloads;
			const unsupported = await page.evaluate(async () => {
				const q = (globalThis as any).__scalaQualification;
				const descriptor = Object.getOwnPropertyDescriptor(WebAssembly, 'Suspending');
				Object.defineProperty(WebAssembly, 'Suspending', {
					value: undefined,
					configurable: true
				});
				const sandbox = new q.Scala();
				try {
					await sandbox.load();
					return { accepted: true };
				} catch (error) {
					return { accepted: false, message: String(error) };
				} finally {
					if (descriptor) Object.defineProperty(WebAssembly, 'Suspending', descriptor);
					await sandbox.dispose();
				}
			});
			expect(unsupported.accepted).toBe(false);
			expect(unsupported.message).toMatch(/WebAssembly|browser/i);
			expect(downloads).toBe(beforeUnsupported);
			expect(pageErrors).toEqual([]);
			if (process.env.WASM_IDLE_SCALA_EVIDENCE_FILE) {
				await writeFile(
					process.env.WASM_IDLE_SCALA_EVIDENCE_FILE,
					JSON.stringify(
						{
							status: 'passed',
							browserVersion: browser.version(),
							revision,
							verifiedAssetBytes: lock.files.reduce(
								(total, entry) => total + entry.bytes,
								0
							),
							adapterSources,
							registration,
							reports,
							rejected,
							unsupported,
							pageErrors,
							downloads,
							sourceHashes: Object.fromEntries(
								Object.entries({ hello, input, loop, state }).map(
									([name, source]) => [
										name,
										createHash('sha256').update(source).digest('hex')
									]
								)
							)
						},
						null,
						2
					) + '\n'
				);
			}
		} finally {
			await context?.close();
			await browser.close();
			await server.close();
		}
	}
);
