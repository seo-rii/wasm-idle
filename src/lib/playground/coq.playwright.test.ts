// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compressStaticRuntimeAssets } from '../../../scripts/compress-static-runtime-assets.mjs';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { prepareContainerRuntimePage } from '../../../scripts/container-runtime-browser-observer.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_COQ === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };
describe.skipIf(!enabled)('real Coq browser kernel', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>, browser: Browser;
	let productionRoot: string, productionFiles: Set<string>;
	beforeAll(async () => {
		productionRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-coq-browser-production-'));
		await cp('static/wasm-coq', path.join(productionRoot, 'wasm-coq'), { recursive: true });
		await compressStaticRuntimeAssets({ rootDir: productionRoot });
		productionFiles = new Set(await readdir(path.join(productionRoot, 'wasm-coq')));
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:5087',
			serverMode: 'dev'
		});
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 120000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
		if (productionRoot) await rm(productionRoot, { recursive: true, force: true });
	});
	async function useProductionAssets(context: BrowserContext) {
		await context.route('**/wasm-coq/*', (route) => {
			const name = new URL(route.request().url()).pathname.split('/').pop()!;
			if (!productionFiles.has(name)) return route.abort('blockedbyclient');
			return route.fulfill({
				path: path.join(productionRoot, 'wasm-coq', name),
				contentType: name.endsWith('.js')
					? 'text/javascript'
					: name.endsWith('.json')
						? 'application/json'
						: 'application/octet-stream'
			});
		});
	}
	it(
		'uses genuine proofs, source and EOF command streams, imports, errors, quotas and recovery',
		{ timeout: 240000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await useProductionAssets(context);
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			try {
				const base = server.browserUrl.replace(/\/$/, '') + '/';
				const url = base + 'coq-consumer-harness';
				await context.route(url, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>Coq consumer</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(url, { waitUntil: 'domcontentloaded' });
				await page.addScriptTag({
					type: 'module',
					content: `import Coq from ${JSON.stringify(base + 'src/lib/playground/coq.ts')};globalThis.__Coq=Coq;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Coq));
				const results = await page.evaluate(async (base) => {
					const sandbox = new (globalThis as any).__Coq();
					await sandbox.load({ rootUrl: new URL(base).pathname.replace(/\/$/, '') });
					const result: Record<string, any> = {
						isolated: crossOriginIsolated,
						controlled: Boolean(navigator.serviceWorker?.controller)
					};
					async function run(
						code: string,
						options: Record<string, unknown> = {},
						onOutput?: (output: string) => void
					) {
						let output = '';
						const diagnostics: unknown[] = [];
						sandbox.oncompilerdiagnostic = (value: unknown) => diagnostics.push(value);
						sandbox.output = (text: string) => {
							output += text;
							onOutput?.(output);
						};
						try {
							return {
								value: await sandbox.run(code, false, true, undefined, [], {
									activePath: 'main.v',
									limits: { compileTimeoutMs: 20000, runTimeoutMs: 15000 },
									...options
								}),
								output,
								diagnostics
							};
						} catch (error) {
							return {
								error: (error as any).code,
								message: String((error as Error).message || error),
								output,
								diagnostics
							};
						}
					}
					try {
						result.proof = await run(
							'Definition twice (n : nat) := n + n.\nEval cbv in twice 21.\nTheorem plus_zero : forall n : nat, n + 0 = n.\nProof. intros n; induction n; simpl; congruence. Qed.\nPrint plus_zero.',
							{ stdin: '' }
						);
						result.buffered = await run('Definition twice (n : nat) := n + n.', {
							stdin: '(* A period . inside a comment. *)\nEval cbv in twice 7.\nGoal True. Proof. idtac "Coq 입력. 안녕". exact I. Qed.'
						});
						let supplied = false,
							beforeEof = '';
						result.delayed = await run(
							'Definition source_answer := 40.\nEval cbv in source_answer.',
							{},
							(output) => {
								if (!supplied && output.includes('40')) {
									supplied = true;
									setTimeout(() => {
										sandbox.write(
											'Definition input_answer := source_answer + 2.\n'
										);
										setTimeout(() => {
											beforeEof = output;
											sandbox.write(
												'Check input_answer. Eval cbv in input_answer.'
											);
											sandbox.eof();
										}, 80);
									}, 50);
								}
							}
						);
						result.beforeEof = beforeEof;
						result.workspace = await run(
							'Load "helpers".\nEval cbv in helper_answer.\nRequire Import Coq.Logic.FunctionalExtensionality.\nCheck functional_extensionality.',
							{
								stdin: '',
								activePath: 'nested/main.coq',
								workspaceFiles: [
									{
										path: 'helpers.v',
										content: 'Definition helper_answer := 37.'
									}
								]
							}
						);
						result.syntax = await run('Definition broken := .', { stdin: '' });
						result.type = await run(
							'Definition valid := 2.\nDefinition broken : nat := true.',
							{ stdin: '', activePath: 'nested/error.coq' }
						);
						result.inputSyntax = await run('Definition answer := 42.', {
							stdin: 'Check answer'
						});
						result.fresh = await run('Check source_answer.', { stdin: '' });
						result.smallWasmCap = await run('Eval cbv in 6 * 7.', {
							stdin: '',
							limits: { maxWasmMemoryBytes: 65536 }
						});
						result.assetLimit = await run('Check nat.', {
							stdin: '',
							limits: { maxAssetBytes: 1024 }
						});
						result.stdinLimit = await run('Check nat.', {
							stdin: ' '.repeat(248) + 'Check nat.',
							limits: { maxWorkspaceBytes: 260 }
						});
						const extraction =
							'Require Import Coq.extraction.Extraction.\nDefinition answer := 42.\nExtraction Language OCaml.\nExtraction "answer.ml" answer.';
						result.fileLimit = await run(extraction, {
							stdin: '',
							limits: {
								maxWorkspaceBytes: new TextEncoder().encode(extraction).length + 40
							}
						});
						result.allowedFile = await run(extraction, {
							stdin: '',
							limits: { maxWorkspaceBytes: 8192 }
						});
						result.outputLimit = await run(
							'Goal True. Proof. idtac "012345678901234567890123456789". exact I. Qed.',
							{ stdin: '', limits: { maxOutputBytes: 10 } }
						);
						result.timeout = await run('Check nat.', {
							limits: { compileTimeoutMs: 20000, runTimeoutMs: 30 }
						});
						let aborted = false;
						const controller = new AbortController();
						result.cancel = await run(
							'Goal True. Proof. idtac "cancel-ready". exact I. Qed.',
							{ signal: controller.signal },
							(output) => {
								if (!aborted && output.includes('cancel-ready')) {
									aborted = true;
									setTimeout(() => controller.abort(), 10);
								}
							}
						);
						result.recovered = await run('Eval cbv in 2 + 2.', { stdin: '' });
						return result;
					} finally {
						await sandbox.dispose();
					}
				}, base);
				process.stdout.write('Coq browser acceptance: ' + JSON.stringify(results) + '\n');
				expect(results.isolated).toBe(true);
				expect(results.controlled).toBe(false);
				expect(results.proof).toMatchObject({ value: true });
				expect(results.proof.output).toContain('42');
				expect(results.proof.output).toContain('plus_zero');
				expect(results.buffered).toMatchObject({ value: true });
				expect(results.buffered.output).toContain('14');
				expect(results.buffered.output).toContain('Coq 입력. 안녕');
				expect(results.delayed).toMatchObject({ value: true });
				expect(results.delayed.output).toContain('42');
				expect(results.beforeEof).not.toContain('42');
				expect(results.workspace).toMatchObject({ value: true });
				expect(results.workspace.output).toContain('37');
				expect(results.workspace.output).toContain('functional_extensionality');
				for (const name of ['syntax', 'type', 'inputSyntax', 'fresh'])
					expect(results[name]).toMatchObject({ error: 'runtime' });
				expect(results.type.diagnostics).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							severity: 'error',
							fileName: 'nested/error.coq',
							lineNumber: 2
						})
					])
				);
				expect(results.syntax.diagnostics).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							severity: 'error',
							fileName: 'main.v',
							lineNumber: 1
						})
					])
				);
				expect(results.inputSyntax.diagnostics).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							severity: 'error',
							fileName: '<stdin>',
							lineNumber: 1
						})
					])
				);
				expect(results.smallWasmCap).toMatchObject({ value: true });
				expect(results.assetLimit).toMatchObject({ error: 'asset-too-large' });
				for (const name of ['stdinLimit', 'fileLimit'])
					expect(results[name]).toMatchObject({ error: 'resource-limit' });
				expect(results.allowedFile).toMatchObject({ value: true });
				expect(results.outputLimit).toMatchObject({ error: 'output-limit' });
				expect(results.timeout).toMatchObject({ error: 'timeout' });
				expect(results.cancel).toMatchObject({ error: 'cancelled' });
				expect(results.recovered).toMatchObject({ value: true });
				expect(results.recovered.output).toContain('4');
			} finally {
				await context.close();
			}
		}
	);
	it(
		'runs the registered default from the selector and executes delayed terminal commands at EOF',
		{ timeout: 240000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await useProductionAssets(context);
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(90000);
			try {
				await prepareContainerRuntimePage(page, server.browserUrl);
				await page.locator('#language-select').selectOption('COQ');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug.getEditorValue().includes('Definition twice')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.coq);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(
					() =>
						document
							.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent?.includes('42') ||
						(window as any).__wasmIdleDebug.getExecutionState().status === 'failed'
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).not.toMatchObject({ status: 'failed' });
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput(
						'Eval cbv in twice 9.\n',
						true
					);
				});
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({ status: 'completed', exitCode: 0 });
				expect(
					await page.locator('[data-testid="terminal-debug-output"]').textContent()
				).toContain('18');
			} finally {
				await context.close();
			}
		}
	);
});
