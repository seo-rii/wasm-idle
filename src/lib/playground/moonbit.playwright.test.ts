// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_MOONBIT === '1';
const meta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('MoonBit service-policy containment in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4998',
			serverMode: 'dev'
		});
		browser = await chromium.launch({
			headless: true,
			args: ['--disk-cache-size=1', '--media-cache-size=1'],
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 300_000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it(
		'rejects default SDK load and execution without fetching a runtime asset or creating a Worker',
		{ timeout: 60_000, meta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const requests: string[] = [];
			await context.route('**/wasm-moonbit/**', (route) => {
				requests.push(route.request().url());
				return route.abort();
			});
			const page = await context.newPage(),
				base = server.browserUrl.replace(/\/?$/u, '/');
			await page.route(base + 'moonbit-policy-harness', (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>MoonBit policy</title>'
				})
			);
			try {
				await page.goto(base + 'moonbit-policy-harness');
				await page.addScriptTag({
					type: 'module',
					content: `import Moonbit from ${JSON.stringify(base + 'src/lib/playground/moonbit.ts')}; globalThis.__Moonbit = Moonbit;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Moonbit));
				const result = await page.evaluate(async () => {
					let workers = 0;
					const OriginalWorker = globalThis.Worker;
					globalThis.Worker = new Proxy(OriginalWorker, {
						construct(target, args, newTarget) {
							workers++;
							return Reflect.construct(target, args, newTarget);
						}
					});
					const runtime = new (globalThis as any).__Moonbit();
					const errors: { code: string; runtimeId: string; message: string }[] = [];
					try {
						for (const operation of [
							() => runtime.load('/mirror'),
							() => runtime.run('fn main { println(42) }', false),
							() => runtime.run('fn main {}', true)
						]) {
							try {
								await operation();
							} catch (error) {
								const e = error as any;
								errors.push({
									code: e.code,
									runtimeId: e.runtimeId,
									message: e.message
								});
							}
						}
						return { workers, errors };
					} finally {
						runtime.terminate();
						globalThis.Worker = OriginalWorker;
					}
				});
				expect(result.workers).toBe(0);
				expect(requests).toEqual([]);
				expect(result.errors).toHaveLength(3);
				for (const error of result.errors)
					expect(error).toMatchObject({
						code: 'runtime-configuration',
						runtimeId: 'MOONBIT',
						message: expect.stringContaining('service-license terms')
					});
			} finally {
				await context.close();
			}
		}
	);

	it(
		'shows the selected MoonBit source and review status, blocks Run/restart/prewarm, and keeps another language available',
		{ timeout: 180_000, meta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			await disableBrowserPrewarm(context);
			const requests: string[] = [];
			await context.route('**/wasm-moonbit/**', (route) => {
				requests.push(route.request().url());
				return route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.locator('#language-select').selectOption('MOONBIT');
				await page.waitForFunction(isStdinEditorReady, 'MOONBIT');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.moonbit
				);
				await expect
					.poll(() => page.locator('[data-testid="runtime-unavailable"]').textContent())
					.toContain('MPSL §14');
				expect(await page.locator('button.action-button--run').first().isDisabled()).toBe(
					true
				);
				expect(
					await page.getByRole('button', { name: 'Restart Runtime' }).isDisabled()
				).toBe(true);
				const before = await page.evaluate(
					() => (window as any).__wasmIdleDebug.getExecutionState().id
				);
				expect(
					await page.evaluate(() =>
						(window as any).__wasmIdleDebug.setEditorValue('fn main { println(17) }')
					)
				).toBe(true);
				await page.locator('#prewarm-toggle').check();
				await page
					.locator('button.action-button--run')
					.first()
					.evaluate((button: HTMLButtonElement) => button.click());
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
						)
				);
				expect(
					await page.evaluate(
						() => (window as any).__wasmIdleDebug.getExecutionState().id
					)
				).toBe(before);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe('fn main { println(17) }');
				expect(requests).toEqual([]);
				await page.locator('#prewarm-toggle').uncheck();
				await page.locator('#language-select').selectOption('JAVASCRIPT');
				await page.waitForFunction(isStdinEditorReady, 'JAVASCRIPT');
				expect(await page.locator('[data-testid="runtime-unavailable"]').count()).toBe(0);
				expect(await page.locator('button.action-button--run').first().isEnabled()).toBe(
					true
				);
			} finally {
				await context.close();
			}
		}
	);
});
