// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const delayedReadSource = `(format t "name?~%")
(finish-output)
(let ((name (read-line)))
  (format t "count?~%")
  (finish-output)
  (let ((n (read)))
    (format t "~a:~d~%" name (loop for i from 1 to n sum i))))
(format t "eof=~a~%" (read-line *standard-input* nil :eof))`;

// The adapter checks use Vite's real source module; the UI check exercises the
// normal language registry, Monaco editor, terminal and streaming input path.
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_COMMONLISP === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('real Common Lisp (ECL) consumer in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4975',
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
		'loads programs with delayed stdin, EOF, conditions, workspace files, limits and cancellation',
		{ timeout: 240_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			try {
				const harnessUrl = `${server.browserUrl.replace(/\/$/, '')}/commonlisp-consumer-harness`;
				await context.route(harnessUrl, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>Common Lisp consumer test</title>',
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
					content: `import CommonLisp from ${JSON.stringify(base + 'src/lib/playground/commonlisp.ts')}; globalThis.__commonLispSandbox = CommonLisp;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__commonLispSandbox));
				const result = await page.evaluate(
					async ({ source, base }) => {
						const CommonLisp = (globalThis as any).__commonLispSandbox;
						const sandbox = new CommonLisp();
						const rootUrl = new URL(base).pathname.replace(/\/$/, '');
						await sandbox.load({ rootUrl });
						const reports: Record<string, unknown> = { isolated: crossOriginIsolated };
						async function run(
							code: string,
							options: Record<string, unknown> = {},
							onOutput?: (output: string) => void
						) {
							let output = '';
							sandbox.output = (text: string) => {
								output += text;
								onOutput?.(output);
							};
							try {
								const value = await sandbox.run(code, false, true, undefined, [], {
									activePath: 'main.lisp',
									limits: { compileTimeoutMs: 30000, runTimeoutMs: 30000 },
									...options
								});
								return { value, output, evidence: sandbox.evidence.current };
							} catch (error) {
								return {
									error: (error as { code?: string }).code,
									message: String((error as Error)?.message ?? error),
									output
								};
							}
						}
						try {
							let step = 0;
							reports.delayed = await run(source, {}, (output) => {
								if (step === 0 && output.includes('name?')) {
									step = 1;
									setTimeout(() => sandbox.write('Lisp 안녕\n'), 100);
								} else if (step === 1 && output.includes('count?')) {
									step = 2;
									setTimeout(() => {
										sandbox.write('100\n');
										setTimeout(() => sandbox.eof(), 100);
									}, 100);
								}
							});
							reports.otherInput = await run(source, { stdin: 'ECL\n10\n' });
							reports.condition = await run(
								'(format t "before~%")\n(error "boom ~a" 7)\n(format t "after~%")',
								{ stdin: '' }
							);
							reports.readerError = await run('(format t "ok~%")\n(car (1 2', {
								stdin: ''
							});
							reports.workspace = await run(
								'(load "helpers.lisp")\n(format t "~a~%" (twice 21))',
								{
									stdin: '',
									workspaceFiles: [
										{
											path: 'helpers.lisp',
											content: '(defun twice (n) (* 2 n))\n'
										}
									]
								}
							);
							reports.clos = await run(
								`(defclass animal () ((name :initarg :name :reader name)))
(defgeneric speak (a))
(defmethod speak ((a animal)) (format nil "~a speaks" (name a)))
(format t "~a ~a~%" (speak (make-instance 'animal :name "cat")) (expt 2 100))`,
								{ stdin: '' }
							);
							reports.recursion = await run(
								'(defun d (n) (if (= n 0) 0 (+ 1 (d (- n 1)))))\n(format t "~a~%" (d 100))\n(d 100000000)',
								{ stdin: '' }
							);
							const controller = new AbortController();
							reports.cancel = await run(
								source,
								{ signal: controller.signal },
								(output) => {
									if (output.includes('name?'))
										controller.abort('cancel blocked READ-LINE');
								}
							);
							reports.afterCancel = await run('(format t "fresh-worker~%")', {
								stdin: ''
							});
							reports.outputLimit = await run(
								'(loop repeat 10000 do (format t "many-bytes~%"))',
								{ stdin: '', limits: { maxOutputBytes: 64 } }
							);
							reports.memoryLimit = await run('(print 1)', {
								stdin: '',
								limits: { maxWasmMemoryBytes: 32 * 1024 * 1024 }
							});
							reports.timeout = await run('(loop)', {
								stdin: '',
								limits: { compileTimeoutMs: 30000, runTimeoutMs: 1500 }
							});
							return reports;
						} finally {
							await sandbox.dispose();
						}
					},
					{ source: delayedReadSource, base: `${server.browserUrl.replace(/\/$/, '')}/` }
				);
				process.stdout.write(`Common Lisp adapter acceptance: ${JSON.stringify(result)}\n`);
				expect(result.isolated).toBe(true);
				expect(result.delayed).toMatchObject({
					value: true,
					output: 'name?\ncount?\nLisp 안녕:5050\neof=EOF\n',
					evidence: {
						protocol: 'wasm-idle-commonlisp-evidence-v1',
						implementation: 'ECL',
						version: '26.5.5',
						exitCode: 0
					}
				});
				expect(result.otherInput).toMatchObject({
					value: true,
					output: 'name?\ncount?\nECL:55\neof=EOF\n'
				});
				expect(result.condition).toMatchObject({ error: 'runtime' });
				expect((result.condition as any).output).toContain('before\n');
				expect((result.condition as any).output).toContain(
					';;; Unhandled SIMPLE-ERROR: boom 7'
				);
				expect((result.condition as any).output).not.toContain('after');
				expect((result.condition as any).message).toContain('SIMPLE-ERROR: boom 7');
				expect(result.readerError).toMatchObject({ error: 'runtime' });
				expect((result.readerError as any).output).toContain('ok\n');
				expect(result.workspace).toMatchObject({ value: true, output: '42\n' });
				expect(result.clos).toMatchObject({
					value: true,
					output: 'cat speaks 1267650600228229401496703205376\n'
				});
				expect(result.recursion).toMatchObject({ error: 'runtime', output: '100\n' });
				expect((result.recursion as any).message).toContain('stack overflow');
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
				target.__commonLispRuns = [];
				target.__commonLispEvidence = [];
				const BrowserWorker = Worker;
				target.Worker = class extends BrowserWorker {
					constructor(url: string | URL, options?: WorkerOptions) {
						super(url, options);
						this.addEventListener('message', ({ data }) => {
							if (data?.evidence?.protocol === 'wasm-idle-commonlisp-evidence-v1')
								target.__commonLispEvidence.push(data.evidence);
						});
					}
					postMessage(message: any, transfer: any = []) {
						if (message?.run && message.baseUrl?.includes('/wasm-commonlisp/'))
							target.__commonLispRuns.push({
								limits: message.limits,
								code: message.code,
								activePath: message.activePath
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
				await page.locator('#language-select').selectOption('COMMONLISP');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug.getEditorValue().includes('What is your name?')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.commonlisp);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('What is your name?')
				);
				await page.waitForTimeout(150);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('Ada\n', false);
				});
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('Enter a number:')
				);
				await page.waitForTimeout(150);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('15\n', false);
				});
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({ status: 'completed', exitCode: 0 });
				const evidence = await page.evaluate(() => ({
					runs: (window as any).__commonLispRuns,
					runtime: (window as any).__commonLispEvidence.at(-1),
					transcript: document.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent
				}));
				process.stdout.write(`Common Lisp UI acceptance: ${JSON.stringify(evidence)}\n`);
				expect(evidence.runs).toHaveLength(1);
				expect(evidence.runs[0].code).toBe(editorDefaults.commonlisp);
				expect(evidence.runs[0].activePath).toBe('main.lisp');
				expect(evidence.runtime).toMatchObject({ implementation: 'ECL', exitCode: 0 });
				expect(evidence.transcript).toContain('Hello, Ada!');
				expect(evidence.transcript).toContain('fibonacci(15) = 610');
				expect(pageErrors).toEqual([]);
			} catch (error) {
				process.stdout.write(
					'Common Lisp UI failure: ' +
						JSON.stringify({
							pageErrors,
							console: consoleMessages.slice(-15),
							state: await page.evaluate(() => ({
								isolated: crossOriginIsolated,
								transcript: document.querySelector(
									'[data-testid="terminal-debug-output"]'
								)?.textContent,
								runs: (window as any).__commonLispRuns
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
