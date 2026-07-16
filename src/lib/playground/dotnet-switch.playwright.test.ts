// @vitest-environment node

import { chromium, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const runTimeoutMs = Number(process.env.WASM_IDLE_DOTNET_SWITCH_TIMEOUT_MS || '600000');
const languageTimeoutMs = Number(
	process.env.WASM_IDLE_DOTNET_SWITCH_LANGUAGE_TIMEOUT_MS || '120000'
);

async function runLanguage(
	page: Page,
	language: 'CSHARP' | 'FSHARP' | 'VBNET',
	source: string,
	expectedOutput: string
) {
	await page.locator('select').selectOption(language);
	await page.waitForFunction(
		(expectedLanguage) =>
			document.querySelector('select')?.value === expectedLanguage &&
			typeof (globalThis as any).__wasmIdleDebug?.setEditorValue === 'function',
		language,
		{ timeout: languageTimeoutMs }
	);
	let previousEditorValue = await page.evaluate(
		() => (globalThis as any).__wasmIdleDebug?.getEditorValue?.() || ''
	);
	let stableReads = 0;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await page.waitForTimeout(250);
		const editorValue = await page.evaluate(
			() => (globalThis as any).__wasmIdleDebug?.getEditorValue?.() || ''
		);
		if (editorValue === previousEditorValue) {
			stableReads += 1;
			if (stableReads >= 2) break;
		} else {
			previousEditorValue = editorValue;
			stableReads = 0;
		}
	}
	let sourceInstalled = false;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const sourceSet = await page.evaluate(async (nextSource) => {
			return await (globalThis as any).__wasmIdleDebug?.setEditorValue?.(nextSource);
		}, source);
		if (!sourceSet) {
			await page.waitForTimeout(500);
			continue;
		}
		await page.waitForTimeout(500);
		sourceInstalled = await page.evaluate(
			(expectedSource) =>
				(globalThis as any).__wasmIdleDebug?.getEditorValue?.() === expectedSource,
			source
		);
		if (sourceInstalled) break;
	}
	expect(sourceInstalled).toBe(true);
	await page.locator('button.action-button--run').click({ timeout: runTimeoutMs });
	try {
		await page.waitForFunction(
			(output) => {
				const transcript =
					document.querySelector('[data-testid="terminal-debug-output"]')?.textContent || '';
				return transcript.includes(output) && transcript.includes('Process finished after');
			},
			expectedOutput,
			{ timeout: languageTimeoutMs }
		);
	} catch (error) {
		const state = await page.evaluate(() => ({
			language: (document.querySelector('select') as HTMLSelectElement | null)?.value,
			runButton: document.querySelector('button.action-button--run')?.textContent?.trim(),
			stopButton: document
				.querySelector('button.action-button--stop')
				?.textContent?.trim(),
			transcript:
				document.querySelector('[data-testid="terminal-debug-output"]')?.textContent || ''
		}));
		throw new Error(
			`${language} did not finish: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(state, null, 2)}`
		);
	}
}

describe('dotnet language switching', () => {
	it(
		'runs C#, F#, and VB.NET bundles sequentially on one page',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_DOTNET_SWITCH !== '1') return;

			await runWithBrowserProbeSessionLock(async () => {
				const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
				const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
				if (!reuseProvidedBrowserUrl) {
					await runBrowserPreparationScripts(['build:preview', 'compress:build-runtimes']);
				}
				const previewServer = reuseProvidedBrowserUrl
					? {
							browserUrl: configuredBrowserUrl,
							close: async () => {}
						}
					: await startBrowserPreviewServer({
							origin: 'http://localhost:4577',
							serverMode: 'preview'
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
				page.setDefaultTimeout(runTimeoutMs);
				const runtimeRequests: string[] = [];
				const pageErrors: string[] = [];
				page.on('request', (request) => {
					const pathname = new URL(request.url()).pathname;
					if (pathname.includes('/wasm-dotnet/runtime/')) runtimeRequests.push(pathname);
				});
				page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

				try {
					for (let attempt = 0; attempt < 4; attempt += 1) {
						await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
						await page.waitForTimeout(1_500);
						const ready = await page.evaluate(
							() =>
								crossOriginIsolated &&
								typeof SharedArrayBuffer !== 'undefined' &&
								!!navigator.serviceWorker?.controller
						);
						if (ready) break;
						await page.evaluate(async () => {
							if (navigator.serviceWorker) await navigator.serviceWorker.ready;
						});
					}
					await page.evaluate(() => localStorage.clear());
					await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
					await page.waitForFunction(
						() =>
							crossOriginIsolated &&
							typeof SharedArrayBuffer !== 'undefined' &&
							!!navigator.serviceWorker?.controller &&
							typeof (globalThis as any).__wasmIdleDebug?.setEditorValue === 'function',
						undefined,
						{ timeout: runTimeoutMs }
					);
					expect(runtimeRequests).toEqual([]);

					await runLanguage(
						page,
						'CSHARP',
						'using System; class Program { static void Main() { Console.WriteLine("switch-csharp"); } }',
						'switch-csharp'
					);
					await runLanguage(page, 'FSHARP', 'printfn "switch-fsharp"', 'switch-fsharp');
					await runLanguage(
						page,
						'VBNET',
						'Imports System\nModule Program\nSub Main()\nConsole.WriteLine("switch-vbnet")\nEnd Sub\nEnd Module',
						'switch-vbnet'
					);

					for (const language of ['csharp', 'fsharp', 'vbnet']) {
						expect(
							runtimeRequests.some((request) =>
								request.includes(`/wasm-dotnet/runtime/${language}/`)
							)
						).toBe(true);
					}
					expect(pageErrors).toEqual([]);
				} finally {
					await browser.close();
					await previewServer.close();
				}
			});
		},
		runTimeoutMs
	);
});
