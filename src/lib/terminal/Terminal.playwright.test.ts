// @vitest-environment node

import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const javascriptStdinSource = `const fs = require('fs');
console.log('ready-for-hangul-input');
const line = fs.readLineSync(0);
console.log(\`main=\${line.trimEnd()}\`);`;

describe('terminal Hangul input in Chromium', () => {
	it('keeps IME composition, CJK cursor movement, and Backspace aligned before Enter', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_TERMINAL_INPUT !== '1') return;

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['build:preview'], { timeoutMs: 900_000 });
			}
			const previewServer = reuseProvidedBrowserUrl
				? {
						origin: new URL(configuredBrowserUrl).origin,
						browserUrl: configuredBrowserUrl,
						close: async () => {}
					}
				: await startBrowserPreviewServer({
						origin: 'http://localhost:4593',
						serverMode
					});
			const browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable(
					process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
				)
			});
			const context = await browser.newContext();
			await context.addCookies([
				{
					name: 'dev_bypass_waf',
					value: 'seorii_bypass_token_is_this',
					url: new URL(previewServer.browserUrl).origin
				}
			]);
			await context.setExtraHTTPHeaders({
				Cookie: 'dev_bypass_waf=seorii_bypass_token_is_this'
			});
			const page = await context.newPage();
			page.setDefaultTimeout(
				Number(process.env.WASM_IDLE_TERMINAL_INPUT_TIMEOUT_MS || '60000')
			);
			page.setDefaultNavigationTimeout(
				Number(process.env.WASM_IDLE_TERMINAL_NAVIGATION_TIMEOUT_MS || '180000')
			);

			try {
				await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
				let activeState = await page.evaluate(() => ({
					crossOriginIsolated,
					serviceWorkerControlled: !!navigator.serviceWorker?.controller,
					sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
				}));
				for (let attempt = 0; attempt < 4; attempt += 1) {
					if (
						activeState.crossOriginIsolated &&
						activeState.serviceWorkerControlled &&
						activeState.sharedArrayBuffer
					) {
						break;
					}
					await page
						.evaluate(async () => {
							if (!navigator.serviceWorker) return;
							await Promise.race([
								navigator.serviceWorker.ready,
								new Promise((resolve) => setTimeout(resolve, 1_500))
							]);
						})
						.catch(() => {});
					await page
						.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' })
						.catch(() => null);
					await page.waitForTimeout(2_000 + attempt * 500);
					activeState = await page.evaluate(() => ({
						crossOriginIsolated,
						serviceWorkerControlled: !!navigator.serviceWorker?.controller,
						sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
					}));
				}
				expect(activeState).toEqual({
					crossOriginIsolated: true,
					serviceWorkerControlled: true,
					sharedArrayBuffer: true
				});
				await page.evaluate(() => localStorage.clear());
				const terminalTestUrl = new URL(previewServer.browserUrl);
				terminalTestUrl.searchParams.set('lang', 'JAVASCRIPT');
				terminalTestUrl.searchParams.set('code', javascriptStdinSource);
				await page.goto(terminalTestUrl.toString(), { waitUntil: 'domcontentloaded' });
				await page.waitForFunction((expectedSource) => {
					const debugApi = (
						window as typeof window & {
							__wasmIdleDebug?: { getEditorValue?: () => string };
						}
					).__wasmIdleDebug;
					return (
						document.querySelector('select')?.value === 'JAVASCRIPT' &&
						debugApi?.getEditorValue?.() === expectedSource
					);
				}, javascriptStdinSource);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('ready-for-hangul-input')
				);

				const textarea = page.locator('.xterm-helper-textarea');
				await textarea.focus();
				await textarea.evaluate((element) => {
					const input = element as HTMLTextAreaElement;
					input.dispatchEvent(
						new CompositionEvent('compositionstart', { bubbles: true, data: '' })
					);
					input.value = '한글';
					input.dispatchEvent(
						new CompositionEvent('compositionupdate', { bubbles: true, data: '한글' })
					);
					input.dispatchEvent(
						new InputEvent('input', {
							bubbles: true,
							data: '한글',
							inputType: 'insertCompositionText'
						})
					);
				});
				await page.waitForTimeout(50);
				const initialCursorLeft = await page
					.locator('.composition-view')
					.evaluate((element) =>
						Number.parseFloat((element as HTMLElement).style.left || '0')
					);
				await page.keyboard.press('ArrowLeft');
				await page.waitForTimeout(50);

				await textarea.evaluate((element) => {
					const input = element as HTMLTextAreaElement;
					input.dispatchEvent(
						new CompositionEvent('compositionstart', { bubbles: true, data: '' })
					);
					input.value += '끝';
					input.dispatchEvent(
						new CompositionEvent('compositionupdate', { bubbles: true, data: '끝' })
					);
					input.dispatchEvent(
						new InputEvent('input', {
							bubbles: true,
							data: '끝',
							inputType: 'insertCompositionText'
						})
					);
				});
				await page.waitForTimeout(50);

				const cursorMeasurement = await page
					.locator('.composition-view')
					.evaluate((element, initialLeft) => {
						const compositionStyle = getComputedStyle(element);
						const measure = document.createElement('span');
						measure.textContent = 'W'.repeat(32);
						measure.style.position = 'absolute';
						measure.style.visibility = 'hidden';
						measure.style.whiteSpace = 'pre';
						measure.style.fontFamily = compositionStyle.fontFamily;
						measure.style.fontSize = compositionStyle.fontSize;
						measure.style.fontStyle = compositionStyle.fontStyle;
						measure.style.fontWeight = compositionStyle.fontWeight;
						element.closest('.xterm')?.appendChild(measure);
						const cellWidth = measure.getBoundingClientRect().width / 32;
						measure.remove();
						const cursorLeft = Number.parseFloat(
							(element as HTMLElement).style.left || '0'
						);
						return {
							active: element.classList.contains('active'),
							cellWidth,
							cursorCellOffset:
								cellWidth > 0
									? Math.round((cursorLeft - initialLeft) / cellWidth)
									: -1
						};
					}, initialCursorLeft);
				expect(cursorMeasurement.active).toBe(true);
				expect(cursorMeasurement.cellWidth).toBeGreaterThan(0);
				expect(cursorMeasurement.cursorCellOffset).toBe(2);

				await textarea.evaluate((element) => {
					const input = element as HTMLTextAreaElement;
					input.dispatchEvent(
						new CompositionEvent('compositionend', { bubbles: true, data: '끝' })
					);
					input.dispatchEvent(
						new InputEvent('input', {
							bubbles: true,
							data: '끝',
							inputType: 'insertCompositionText'
						})
					);
				});
				await page.waitForTimeout(50);
				await page.keyboard.press('Backspace');
				await page.keyboard.press('ArrowRight');
				await page.keyboard.press('Enter');

				await page
					.waitForFunction(
						() =>
							document
								.querySelector('[data-testid="terminal-debug-output"]')
								?.textContent?.includes('main=한글'),
						undefined,
						{ timeout: 30_000 }
					)
					.catch(async (error) => {
						const state = await page.evaluate(() => ({
							compositionActive:
								document
									.querySelector('.composition-view')
									?.classList.contains('active') || false,
							compositionText:
								document.querySelector('.composition-view')?.textContent || '',
							runButtonText:
								document
									.querySelector('button.action-button--run')
									?.textContent?.trim() || '',
							textareaValue:
								(
									document.querySelector(
										'.xterm-helper-textarea'
									) as HTMLTextAreaElement | null
								)?.value || '',
							transcript:
								document.querySelector('[data-testid="terminal-debug-output"]')
									?.textContent || ''
						}));
						throw new Error(`${String(error)}\n${JSON.stringify(state, null, 2)}`);
					});
				const transcript =
					(await page.locator('[data-testid="terminal-debug-output"]').textContent()) ||
					'';
				expect(transcript).toContain('main=한글');
				expect(transcript).not.toContain('main=한끝글');
			} finally {
				await context.close();
				await browser.close();
				await previewServer.close();
			}
		});
	}, 240_000);
});
