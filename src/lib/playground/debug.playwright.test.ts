// @vitest-environment node

import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Page } from 'playwright-core';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const debugCases = [
	{
		activePath: 'main.c',
		expectedOutput: 'trace-c=73',
		language: 'C',
		source: `#include <stdio.h>

int main(void) {
    int value = 70;
    value += 3;
    printf("trace-c=%d\\n", value);
    return 0;
}`
	},
	{
		activePath: 'main.m',
		expectedOutput: 'trace-objectivec=73',
		language: 'OBJC',
		source: `#include <stdio.h>
#include <objc/runtime.h>

__attribute__((objc_root_class))
@interface TraceValue {
    Class isa;
}
- (int)value;
@end

@implementation TraceValue
- (int)value {
    return 73;
}
@end

int main(void) {
    id value = class_createInstance(objc_getClass("TraceValue"), 0);
    int result = [value value];
    printf("trace-objectivec=%d\\n", result);
    return 0;
}`
	},
	{
		activePath: 'foundation.m',
		expectedOutput: 'trace-foundation=73',
		language: 'OBJC',
		source: `#include <stdio.h>
#import <Foundation/NSString.h>

int main(void) {
    int result = 73;
    NSString *label = @"trace-foundation";
    printf("%s=%d\\n", [label UTF8String], result);
    return 0;
}`
	}
] as const;

const requestedDebugLanguages = new Set(
	(process.env.WASM_IDLE_DEBUG_BROWSER_LANGUAGES || '')
		.split(',')
		.map((value) => value.trim().toUpperCase())
		.filter(Boolean)
);
const activeDebugCases = requestedDebugLanguages.size
	? debugCases.filter((testCase) => requestedDebugLanguages.has(testCase.language))
	: debugCases;

let previewServerPromise: ReturnType<typeof startBrowserPreviewServer> | null = null;

afterAll(async () => {
	const previewServer = await previewServerPromise?.catch(() => null);
	await previewServer?.close();
});

async function ensureSharedBrowserPage(page: Page, browserUrl: string) {
	await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const state = await page.evaluate(() => ({
			crossOriginIsolated,
			serviceWorkerControlled: !!navigator.serviceWorker?.controller,
			sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
		}));
		if (state.crossOriginIsolated && state.serviceWorkerControlled && state.sharedArrayBuffer) {
			return state;
		}
		await page.evaluate(async () => {
			if (!navigator.serviceWorker) return;
			await Promise.race([
				navigator.serviceWorker.ready,
				new Promise((resolve) => setTimeout(resolve, 1_500))
			]).catch(() => {});
		});
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(2_000 + attempt * 500);
	}
	throw new Error('Debug browser test requires a cross-origin-isolated service worker page.');
}

async function readPausedLine(page: Page) {
	return page.evaluate(() => {
		const metric = Array.from(document.querySelectorAll('.debug-metric')).find(
			(element) => element.querySelector('span')?.textContent?.trim() === 'Line'
		);
		return metric?.querySelector('strong')?.textContent?.trim() || '';
	});
}

describe('C-family trace debugging in Chromium', () => {
	it('pauses, steps, and completes real C and Objective-C browser programs without page errors', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_DEBUG !== '1') return;

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['build:preview'], { timeoutMs: 900_000 });
			}
			previewServerPromise ??= reuseProvidedBrowserUrl
				? Promise.resolve({
						origin: new URL(configuredBrowserUrl).origin,
						browserUrl: configuredBrowserUrl,
						close: async () => {}
					})
				: startBrowserPreviewServer({
						origin: 'http://localhost:4583',
						serverMode
					});
			const previewServer = await previewServerPromise;
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

			try {
				for (const testCase of activeDebugCases) {
					const page = await context.newPage();
					page.setDefaultTimeout(
						Number(process.env.WASM_IDLE_DEBUG_BROWSER_TIMEOUT_MS || '420000')
					);
					const pageErrors: string[] = [];
					const consoleMessages: string[] = [];
					page.on('console', (message) => {
						consoleMessages.push(`[${message.type()}] ${message.text()}`);
					});
					page.on('pageerror', (error) => {
						pageErrors.push(String(error.stack || error.message || error));
					});
					try {
						const activeState = await ensureSharedBrowserPage(
							page,
							previewServer.browserUrl
						);
						expect(activeState).toEqual({
							crossOriginIsolated: true,
							serviceWorkerControlled: true,
							sharedArrayBuffer: true
						});
						await page.evaluate(() => localStorage.clear());
						await page.goto(previewServer.browserUrl, {
							waitUntil: 'domcontentloaded'
						});
						await page.waitForFunction(
							() =>
								typeof (window as any).__wasmIdleDebug?.setWorkspaceFiles ===
								'function'
						);
						await page.locator('select').first().selectOption(testCase.language);
						await page.waitForFunction(
							(language) => document.querySelector('select')?.value === language,
							testCase.language
						);
						const workspaceUpdated = await page.evaluate(
							async (activePath) =>
								await (window as any).__wasmIdleDebug.setWorkspaceFiles(
									[],
									activePath
								),
							testCase.activePath
						);
						expect(workspaceUpdated).toBe(true);
						let editorUpdated = false;
						for (let attempt = 0; attempt < 20; attempt += 1) {
							await page.evaluate(
								async (source) =>
									await (window as any).__wasmIdleDebug.setEditorValue(source),
								testCase.source
							);
							await page.waitForTimeout(250);
							editorUpdated = await page.evaluate(
								(source) =>
									(window as any).__wasmIdleDebug.getEditorValue() === source,
								testCase.source
							);
							if (editorUpdated) break;
						}
						expect(editorUpdated).toBe(true);
						await page.waitForFunction(
							(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
							testCase.source
						);

						const debugButton = page.locator('button.action-button--debug');
						await debugButton.waitFor({ state: 'visible' });
						expect(await debugButton.isEnabled()).toBe(true);
						await debugButton.click();
						await page
							.getByRole('button', { name: 'Stop Debug' })
							.waitFor({ state: 'visible' });
						const pauseOutcome = await Promise.race([
							page
								.locator('.debug-status-pill--paused')
								.waitFor({ state: 'visible' })
								.then(() => 'paused' as const),
							debugButton
								.waitFor({ state: 'visible' })
								.then(() => 'finished' as const)
						]);
						if (pauseOutcome !== 'paused') {
							const transcript =
								(await page
									.locator('[data-testid="terminal-debug-output"]')
									.textContent()
									.catch(() => '')) || '';
							throw new Error(
								`${testCase.language} debug session finished before pausing\n${JSON.stringify(
									{
										consoleTail: consoleMessages.slice(-80),
										pageErrors,
										transcript
									},
									null,
									2
								)}`
							);
						}
						const entryLine = await readPausedLine(page);
						expect(entryLine).toMatch(/^L\d+$/);

						await page.locator('button[aria-label="Next Line"]').click();
						await page.waitForFunction((previousLine) => {
							const metric = Array.from(
								document.querySelectorAll('.debug-metric')
							).find(
								(element) =>
									element.querySelector('span')?.textContent?.trim() === 'Line'
							);
							return (
								document.querySelector('.debug-status-pill--paused') != null &&
								metric?.querySelector('strong')?.textContent?.trim() !==
									previousLine
							);
						}, entryLine);
						await page.locator('button[aria-label="Continue"]').click();
						await page.waitForFunction(
							(expectedOutput) =>
								document
									.querySelector('[data-testid="terminal-debug-output"]')
									?.textContent?.includes(expectedOutput),
							testCase.expectedOutput
						);
						await page
							.locator('button.action-button--debug')
							.waitFor({ state: 'visible' });
						expect(pageErrors).toEqual([]);
					} finally {
						await page.close();
					}
				}
			} finally {
				await context.close();
				await browser.close();
			}
		});
	}, 1_200_000);
});
