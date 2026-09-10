// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WASM_LFORTRAN_PROFILE as profile } from './wasmLfortranVersion';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

async function writeAcceptance(phase: string, chromiumVersion: string, result: unknown) {
	const directory = new URL('../../../.cache/', import.meta.url);
	await mkdir(directory, { recursive: true });
	const testSource = await readFile(new URL('./lfortran.playwright.test.ts', import.meta.url));
	const receipt = new URL(`lfortran-consumer-${phase}-${randomUUID()}.json`, directory);
	await writeFile(
		receipt,
		JSON.stringify(
			{
				phase,
				chromiumVersion,
				profile,
				testSha256: createHash('sha256').update(testSource).digest('hex'),
				result
			},
			null,
			2
		) + '\n',
		{ flag: 'wx', mode: 0o600 }
	);
	process.stdout.write(`LFortran ${phase} acceptance receipt: ${receipt.pathname}\n`);
}

const delayedReadSource = `program main
  implicit none
  integer :: n
  integer, allocatable :: values(:)
  print '(A)', 'value?'
  read(*,*) n
  allocate(values(n))
  read(*,*) values
  print '(A,I0)', 'sum=', sum(values)
end program main`;

// The adapter checks use Vite's real source module; the UI check exercises the
// normal language registry, Monaco editor, terminal and streaming input path.
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_LFORTRAN === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('real LFortran consumer in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4973',
			serverMode: 'dev'
		});
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 120_000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it(
		'compiles arrays/modules, waits for asynchronous input and EOF, reports diagnostics and enforces limits/cancellation',
		{ timeout: 240_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			try {
				// A minimal document keeps the adapter probe independent of application HMR
				// and service-worker navigation. The real consumer modules/assets are unchanged.
				const harnessUrl = `${server.browserUrl.replace(/\/$/, '')}/lfortran-consumer-harness`;
				await context.route(harnessUrl, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>LFortran consumer test</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(harnessUrl, { waitUntil: 'domcontentloaded' });
				const base = `${server.browserUrl.replace(/\/$/, '')}/`;
				await installBrowserRuntimeDelivery(page, base);
				await page.addScriptTag({
					type: 'module',
					content: `import LFortran from ${JSON.stringify(base + 'src/lib/playground/lfortran.ts')}; globalThis.__lfortranSandbox = LFortran;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__lfortranSandbox));
				const result = await page.evaluate(
					async ({ source, base }) => {
						const LFortran = (globalThis as any).__lfortranSandbox;
						const sandbox = new LFortran();
						const rootUrl = new URL(base).pathname.replace(/\/$/, '');
						await sandbox.load({ rootUrl });
						const reports: Record<string, unknown> = { isolated: crossOriginIsolated };
						async function run(
							code: string,
							options: Record<string, unknown> = {},
							onOutput?: (output: string) => void
						) {
							let output = '';
							const diagnostics: unknown[] = [];
							sandbox.output = (text: string) => {
								output += text;
								onOutput?.(output);
							};
							sandbox.oncompilerdiagnostic = (diagnostic: unknown) =>
								diagnostics.push(diagnostic);
							try {
								const value = await sandbox.run(code, false, true, undefined, [], {
									activePath: 'main.f90',
									limits: { compileTimeoutMs: 20000, runTimeoutMs: 10000 },
									...options
								});
								return {
									value,
									output,
									diagnostics,
									evidence: sandbox.memoryEvidence.current
								};
							} catch (error) {
								return {
									error: (error as { code?: string }).code,
									message: String(error),
									output,
									diagnostics
								};
							}
						}
						try {
							let sent = false;
							reports.delayed = await run(source, {}, (output) => {
								if (sent || !output.includes('value?')) return;
								sent = true;
								setTimeout(() => {
									sandbox.write('3\n');
									setTimeout(() => {
										sandbox.write('10 20 30\n');
										sandbox.eof();
									}, 100);
								}, 100);
							});
							reports.otherInput = await run(source, { stdin: '4\n-5 6 7 8\n' });
							reports.module = await run(
								`module arithmetic
contains
 integer function twice(n)
 integer, intent(in) :: n
 twice = n * 2
 end function
end module
program main
 use arithmetic
 print '(I0)', twice(21)
end program`,
								{ stdin: '' }
							);
							reports.smallerMemory = await run(
								"program main\nprint '(A)', 'bounded'\nend program",
								{
									stdin: '',
									limits: { maxWasmMemoryBytes: 128 * 1024 * 1024 }
								}
							);
							reports.workspace = await run(
								"program main\nimplicit none\ninclude 'values.inc'\nprint '(I0)', n\nend program",
								{
									stdin: '',
									workspaceFiles: [
										{
											path: 'values.inc',
											content: 'integer, parameter :: n=17\n'
										}
									]
								}
							);
							reports.invalid = await run(
								`program main
implicit none
integer :: value
value = this_symbol_is_not_declared
end program`,
								{ stdin: '' }
							);
							let closed = false;
							reports.eof = await run(
								`program main
implicit none
integer :: value, status
print '(A)', 'eof?'
read(*,*,iostat=status) value
if (status < 0) print '(A)', 'EOF'
end program`,
								{},
								(output) => {
									if (!closed && output.includes('eof?')) {
										closed = true;
										setTimeout(() => sandbox.eof(), 100);
									}
								}
							);
							const controller = new AbortController();
							reports.cancel = await run(
								source,
								{ signal: controller.signal },
								(output) => {
									if (output.includes('value?'))
										controller.abort('cancel blocked READ');
								}
							);
							reports.afterCancel = await run(
								"program main\nprint '(A)', 'fresh-worker'\nend program",
								{ stdin: '' }
							);
							reports.outputLimit = await run(
								"program main\ninteger :: i\ndo i=1,10000\nprint '(A)', 'many-bytes'\nend do\nend program",
								{ stdin: '', limits: { maxOutputBytes: 64 } }
							);
							reports.memoryLimit = await run(source, {
								stdin: '',
								limits: { maxWasmMemoryBytes: 64 * 1024 * 1024 }
							});
							reports.timeout = await run(source, {
								limits: { compileTimeoutMs: 1000, runTimeoutMs: 1000 }
							});
							return reports;
						} finally {
							await sandbox.dispose();
						}
					},
					{ source: delayedReadSource, base: `${server.browserUrl.replace(/\/$/, '')}/` }
				);
				await writeAcceptance('adapter', browser.version(), result);
				expect(result.isolated).toBe(true);
				expect(result.delayed).toMatchObject({ value: true, output: 'value?\nsum=60\n' });
				expect(result.delayed).toMatchObject({
					evidence: {
						importedBoundedMemory: true,
						maximumMemoryBytes: 512 * 1024 * 1024,
						generated: [
							{ name: expect.stringMatching(/\.o$/) },
							{ name: expect.stringMatching(/\.wasm$/) }
						]
					}
				});
				expect(result.otherInput).toMatchObject({
					value: true,
					output: 'value?\nsum=16\n'
				});
				expect(result.module).toMatchObject({ value: true, output: '42\n' });
				expect(result.smallerMemory).toMatchObject({
					value: true,
					output: 'bounded\n',
					evidence: { maximumMemoryBytes: 128 * 1024 * 1024, importedBoundedMemory: true }
				});
				expect(result.workspace).toMatchObject({ value: true, output: '17\n' });
				expect(result.invalid).toMatchObject({
					value: false,
					diagnostics: [{ fileName: 'main.f90', lineNumber: 4, severity: 'error' }]
				});
				expect(result.eof).toMatchObject({ value: true, output: 'eof?\nEOF\n' });
				expect(result.cancel).toMatchObject({ error: 'cancelled' });
				expect(result.afterCancel).toMatchObject({ value: true, output: 'fresh-worker\n' });
				expect(result.outputLimit).toMatchObject({ error: 'output-limit' });
				expect(result.memoryLimit).toMatchObject({ error: 'resource-limit' });
				expect(result.timeout).toMatchObject({ error: 'timeout' });
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the default sample from the language selector with delayed terminal input',
		{ timeout: 240_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const browserUrl = process.env.WASM_IDLE_BROWSER_URL || server.browserUrl;
			const context = await browser.newContext();
			await addBrowserTestCookies(context, browserUrl);
			await context.addInitScript(() => {
				const target = window as any;
				target.__lfortranConsumerRuns = [];
				target.__lfortranConsumerEvidence = [];
				const BrowserWorker = Worker;
				target.Worker = class extends BrowserWorker {
					constructor(url: string | URL, options?: WorkerOptions) {
						super(url, options);
						this.addEventListener('message', ({ data }) => {
							if (data?.evidence?.protocol === 'wasm-idle-lfortran-evidence-v1')
								target.__lfortranConsumerEvidence.push(data.evidence);
						});
					}
					postMessage(message: any, transfer: any = []) {
						if (message?.run && message.baseUrl?.includes('/wasm-lfortran/'))
							target.__lfortranConsumerRuns.push({
								limits: message.limits,
								code: message.code
							});
						super.postMessage(message, transfer);
					}
				};
			});
			const page = await context.newPage();
			const pageErrors: string[] = [];
			const consoleMessages: string[] = [];
			page.on('console', (message) => consoleMessages.push(message.text()));
			page.setDefaultTimeout(60_000);
			page.on('pageerror', (error) => pageErrors.push(error.message));
			try {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					() =>
						crossOriginIsolated &&
						Boolean((window as any).__wasmIdleDebug?.getEditorValue)
				);
				await page.locator('#language-select').selectOption('LFORTRAN');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug.getEditorValue().includes('How many values?')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.lfortran);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('How many values?')
				);
				await page.waitForTimeout(150);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('3\n', false);
				});
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('Values:')
				);
				await page.waitForTimeout(150);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('10 20 30\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({ status: 'completed', exitCode: 0 });
				const evidence = await page.evaluate(() => ({
					runs: (window as any).__lfortranConsumerRuns,
					memory: (window as any).__lfortranConsumerEvidence.at(-1),
					transcript: document.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent
				}));
				await writeAcceptance('ui', browser.version(), evidence);
				expect(evidence.runs).toHaveLength(1);
				expect(evidence.runs[0].code).toBe(editorDefaults.lfortran);
				expect(evidence.runs[0].limits.maxWasmMemoryBytes).toBe(512 * 1024 * 1024);
				expect(evidence.memory).toMatchObject({
					importedBoundedMemory: true,
					maximumMemoryBytes: 512 * 1024 * 1024,
					exitCode: 0
				});
				expect(evidence.transcript).toContain('sum=60');
				expect(pageErrors).toEqual([]);
			} catch (error) {
				process.stdout.write(
					'LFortran UI failure: ' +
						JSON.stringify({
							pageErrors,
							console: consoleMessages.slice(-15),
							state: await page.evaluate(() => ({
								isolated: crossOriginIsolated,
								debug: typeof (window as any).__wasmIdleDebug,
								body: document.body.textContent?.slice(0, 500),
								url: location.href
							}))
						}) +
						'\n'
				);
				throw error;
			} finally {
				await context.close();
			}
		}
	);
});
