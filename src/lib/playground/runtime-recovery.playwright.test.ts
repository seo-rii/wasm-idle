// @vitest-environment node

import { chromium, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import type { ExecutionObservation } from './executionObservation';

const dotnetEnabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_DOTNET_RECOVERY === '1';
const nimEnabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_NIM_RECOVERY === '1';
const operationTimeout = 180_000;

async function withPage(run: (page: Page, compilerLogs: string[]) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		const configuredUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const reuse = shouldReuseProvidedBrowserUrl(configuredUrl);
		if (!reuse)
			await runBrowserPreparationScripts(['build:preview', 'compress:build-runtimes']);
		const server = reuse
			? { browserUrl: configuredUrl, close: async () => {} }
			: await startBrowserPreviewServer({
					origin: 'http://localhost:4589',
					serverMode: 'preview'
				});
		const browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		const context = await browser.newContext();
		await addBrowserTestCookies(context, server.browserUrl);
		const page = await context.newPage();
		page.setDefaultTimeout(operationTimeout);
		const errors: string[] = [];
		const compilerLogs: string[] = [];
		page.on('console', (message) => {
			if (message.text().includes('[wasm-idle:dotnet-lsp]'))
				compilerLogs.push(message.text());
		});
		const pageUrl = new URL(server.browserUrl);
		pageUrl.searchParams.set('lsp-test', '1');
		page.on('pageerror', (error) => errors.push(error.message));
		try {
			await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded' });
			await page.evaluate(() => localStorage.clear());
			for (let attempt = 0; attempt < 4; attempt += 1) {
				await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded' });
				await page.waitForTimeout(1500);
				if (
					await page.evaluate(
						() => crossOriginIsolated && !!navigator.serviceWorker?.controller
					)
				)
					break;
				await page.evaluate(async () => {
					await navigator.serviceWorker.ready;
				});
			}
			await page.waitForFunction(
				() =>
					crossOriginIsolated &&
					typeof (globalThis as any).__wasmIdleDebug?.getExecutionState === 'function'
			);
			await page.evaluate(() => {
				const probe = { ticks: 0, maxGap: 0, previous: performance.now() };
				(globalThis as any).__runtimeHeartbeat = probe;
				setInterval(() => {
					const now = performance.now();
					probe.maxGap = Math.max(probe.maxGap, now - probe.previous);
					probe.previous = now;
					probe.ticks += 1;
				}, 50);
			});
			await run(page, compilerLogs);
			const heartbeat = await page.evaluate(() => (globalThis as any).__runtimeHeartbeat);
			expect(heartbeat.ticks).toBeGreaterThan(5);
			expect(heartbeat.maxGap).toBeLessThan(3000);
			expect(errors).toEqual([]);
		} finally {
			await browser.close();
			await server.close();
		}
	});
}

async function selectLanguage(page: Page, language: string) {
	await page.locator('#language-select').selectOption(language);
	await page.waitForFunction(
		(expected) =>
			(document.querySelector('#language-select') as HTMLSelectElement)?.value === expected &&
			!!(globalThis as any).__wasmIdleDebug?.setEditorValue,
		language
	);
	await page.waitForTimeout(750);
}

async function beginRun(page: Page, source: string, keyboard = false) {
	await page.locator('button.action-button--run').waitFor({ state: 'visible' });
	const previousId = await page.evaluate(
		() => (globalThis as any).__wasmIdleDebug.getExecutionState().id
	);
	if (keyboard) {
		await page.locator('.monaco-editor textarea.inputarea').first().focus();
		await page.keyboard.press('ControlOrMeta+A');
		await page.keyboard.insertText(source);
	} else {
		await page.evaluate(async (code) => {
			if (!(await (globalThis as any).__wasmIdleDebug.setEditorValue(code)))
				throw new Error('Editor did not accept recovery test source');
		}, source);
	}
	expect(await page.evaluate(() => (globalThis as any).__wasmIdleDebug.getEditorValue())).toBe(
		source
	);
	await page.locator('button.action-button--run').click();
	await page.waitForFunction(
		(id) => (globalThis as any).__wasmIdleDebug.getExecutionState().id > id,
		previousId
	);
}

async function settle(
	page: Page,
	status: ExecutionObservation['status'] = 'completed',
	output?: string
) {
	await page.waitForFunction(
		() => (globalThis as any).__wasmIdleDebug.getExecutionState().endedAt !== null,
		undefined,
		{ timeout: operationTimeout }
	);
	const state: ExecutionObservation = await page.evaluate(() =>
		(globalThis as any).__wasmIdleDebug.getExecutionState()
	);
	expect(state, JSON.stringify(state)).toMatchObject({
		status,
		exitCode: status === 'completed' ? 0 : null
	});
	if (output)
		expect(await page.locator('[data-testid="terminal-debug-output"]').textContent()).toContain(
			output
		);
	return state;
}

async function stopProgram(page: Page) {
	await page.waitForFunction(() => {
		const state = (globalThis as any).__wasmIdleDebug.getExecutionState();
		return state.status === 'running' || state.stage.startsWith('Running ');
	});
	const ticks = await page.evaluate(() => (globalThis as any).__runtimeHeartbeat.ticks);
	await page.waitForFunction(
		(previous) => (globalThis as any).__runtimeHeartbeat.ticks > previous + 2,
		ticks,
		{ timeout: 3000 }
	);
	await page.locator('button.action-button--stop').first().click({ timeout: 5000 });
	await settle(page, 'cancelled');
}

describe('runtime failure and Stop recovery', () => {
	it(
		'keeps .NET analysis and execution responsive and recovers after output overflow and Stop',
		{
			skip: !dotnetEnabled,
			meta: { browser: true, requiredBrowser: dotnetEnabled },
			timeout: 1_200_000
		},
		async () => {
			expect.hasAssertions();
			await withPage(async (page, compilerLogs) => {
				for (const sample of [
					{
						language: 'CSHARP',
						normal: 'using System; class Program { static void Main() { Console.WriteLine("recovered-csharp"); } }',
						output: 'recovered-csharp',
						loop: 'class Program { static void Main() { while (true) {} } }'
					},
					{
						language: 'FSHARP',
						normal: 'printfn "recovered-fsharp"',
						output: 'recovered-fsharp',
						loop: 'while true do ()'
					},
					{
						language: 'VBNET',
						normal: 'Imports System\nModule Program\nSub Main()\nConsole.WriteLine("recovered-vbnet")\nEnd Sub\nEnd Module',
						output: 'recovered-vbnet',
						loop: 'Module Program\nSub Main()\nWhile True\nEnd While\nEnd Sub\nEnd Module'
					}
				]) {
					await selectLanguage(page, sample.language);
					await page.locator('#lsp-toggle').uncheck();
					await beginRun(page, sample.normal, sample.language === 'CSHARP');
					await settle(page, 'completed', sample.output);
					const starts = compilerLogs.filter((line) =>
						line.includes('compile start')
					).length;
					const completions = compilerLogs.filter((line) =>
						line.includes('compile done')
					).length;
					await page.locator('#lsp-toggle').check();
					await expect
						.poll(
							() =>
								compilerLogs.filter((line) => line.includes('compile start'))
									.length,
							{ timeout: operationTimeout }
						)
						.toBeGreaterThan(starts);
					await beginRun(page, sample.normal);
					await settle(page, 'completed', sample.output);
					await expect
						.poll(
							() =>
								compilerLogs.filter((line) => line.includes('compile done')).length,
							{ timeout: operationTimeout }
						)
						.toBeGreaterThan(completions);
					await beginRun(page, sample.loop);
					await stopProgram(page);
					await beginRun(page, sample.normal);
					await settle(page, 'completed', sample.output);
				}
				await page.locator('#lsp-toggle').uncheck();
				await selectLanguage(page, 'CSHARP');
				await beginRun(
					page,
					'using System; class Program { static void Main() { for (int i=0; i<2000000; i++) Console.Write("x"); } }'
				);
				const overflow = await settle(page, 'failed');
				expect(overflow.error).toContain('output exceeded');
				await beginRun(
					page,
					'using System; class Program { static void Main() { Console.WriteLine(Console.ReadLine() ?? "eof-recovered"); } }'
				);
				await page.waitForFunction(
					() =>
						(globalThis as any).__wasmIdleDebug.getExecutionState().status ===
						'waiting-input'
				);
				await page.getByRole('button', { name: 'Send EOF', exact: true }).click();
				await settle(page, 'completed', 'eof-recovered');
			});
		}
	);

	it(
		'reports Nim translation and runtime failures and recovers on the same page',
		{
			skip: !nimEnabled,
			meta: { browser: true, requiredBrowser: nimEnabled },
			timeout: 900_000
		},
		async () => {
			expect.hasAssertions();
			await withPage(async (page) => {
				await selectLanguage(page, 'NIM');
				await beginRun(page, 'echo unknownIdentifier');
				const translation = await settle(page, 'failed');
				expect(translation.error).toContain('Translating Nim to C');
				await beginRun(
					page,
					'import strutils\nlet values = [2, 3, 5]\necho "nim-array=", values[0] + values[1] + values[2]\necho "nim-string=", "hello".toUpperAscii()'
				);
				await settle(page, 'completed', 'nim-array=10');
				expect(
					await page.locator('[data-testid="terminal-debug-output"]').textContent()
				).toContain('nim-string=HELLO');
				await beginRun(page, 'raise newException(ValueError, "expected-runtime-failure")');
				const runtime = await settle(page, 'failed');
				expect(runtime.error).toContain('Running Nim program');
				await beginRun(page, 'echo "before-loop"\nwhile true: discard');
				await stopProgram(page);
				await beginRun(
					page,
					'var line: string\nif stdin.readLine(line):\n  echo "input=", line\nelse:\n  echo "nim-eof-recovered"'
				);
				await page.waitForFunction(
					() =>
						(globalThis as any).__wasmIdleDebug.getExecutionState().status ===
						'waiting-input'
				);
				await page.getByRole('button', { name: 'Send EOF', exact: true }).click();
				await settle(page, 'completed', 'nim-eof-recovered');
				await beginRun(
					page,
					'import strutils\ntry:\n  echo parseInt(stdin.readLine())\nexcept ValueError:\n  echo "nim-invalid-input-recovered"'
				);
				await page.evaluate(async () => {
					await (globalThis as any).__wasmIdleDebug.writeTerminalInput(
						'not-a-number\n',
						true
					);
				});
				await settle(page, 'completed', 'nim-invalid-input-recovered');
			});
		}
	);
});
