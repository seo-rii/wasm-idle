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
		backend: 'lldb',
		breakpointLine: 4,
		expectedOutput: 'lldb-c=73',
		expectedLocal: { name: 'value', value: '70' },
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 70;
    value += 3;
    printf("lldb-c=%d\\n", value);
    return 0;
}`
	},
	{
		activePath: 'main.cpp',
		backend: 'lldb',
		breakpointLine: 16,
		expectedVariableTrees: [
			{
				parent: 'pair',
				variables: [
					{ name: 'first', value: '35' },
					{ name: 'second', value: '38' }
				]
			},
			{
				parent: 'pair_ptr',
				variables: [
					{ name: 'first', value: '35' },
					{ name: 'second', value: '38' }
				]
			}
		],
		expectedOutput: 'lldb-cpp=73',
		expectedLocal: { name: 'result', value: '73' },
		expectedTitle: 'C++ · LLDB / WAMR',
		language: 'CPP',
		programArgs: [],
		source: `#include <cstdio>

struct Pair {
    int first;
    int second;
};

int calculate(int value) {
    int doubled = value * 2;
    return doubled + 3;
}

int main() {
    Pair pair{35, 38};
    Pair *pair_ptr = &pair;
    int result = calculate(pair_ptr->first);
    std::printf("lldb-cpp=%d\\n", result);
    return 0;
}`
	},
	{
		activePath: 'trap.c',
		backend: 'lldb',
		breakpointLine: 2,
		expectedLocal: { name: 'value', value: '73' },
		expectedStoppedReason: 'exception',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `int main(void) {
    int value = 73;
    __builtin_trap();
    return value;
}`,
		testId: 'c-trap'
	},
	{
		activePath: 'solution.rs',
		backend: 'lldb',
		breakpointLine: 2,
		expectedOutput: 'lldb-rust=73:browser-arg',
		expectedLocal: { name: 'value', value: '70' },
		expectedTitle: 'Rust · LLDB / WAMR',
		language: 'RUST',
		programArgs: ['browser-arg'],
		source: `fn main() {
    let mut value = 70;
    value += 3;
    let argument = std::env::args().nth(1).unwrap_or_else(|| "missing".to_owned());
    println!("lldb-rust={value}:{argument}");
}`
	},
	{
		activePath: 'main.m',
		backend: 'trace',
		expectedOutput: 'trace-objectivec=73',
		language: 'OBJC',
		programArgs: [],
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
		backend: 'trace',
		expectedOutput: 'trace-foundation=73',
		language: 'OBJC',
		programArgs: [],
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
const requestedDebugCases = new Set(
	(process.env.WASM_IDLE_DEBUG_BROWSER_CASES || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
);
const activeDebugCases = debugCases.filter(
	(testCase) =>
		(!requestedDebugLanguages.size || requestedDebugLanguages.has(testCase.language)) &&
		(!requestedDebugCases.size ||
			('testId' in testCase && requestedDebugCases.has(testCase.testId)))
);
const requireLldbDebug = process.env.WASM_IDLE_REQUIRE_LLDB_DEBUG === '1';
const requiredLldbAssets = [
	'runtime-manifest.v2.json',
	'debug/lldb-web-dap.js',
	'debug/lldb-web-dap.wasm',
	'debug/lldb-web-dap.pthread.mjs',
	'debug/wamr-debug.js',
	'debug/wamr-debug.wasm',
	'debug/wamr-debug.worker.mjs'
] as const;

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

describe('native-source browser debugging in Chromium', () => {
	it('pauses, steps, and completes the requested browser programs without page errors', async () => {
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
					const debugAssetResponses = new Map<string, number>();
					page.on('console', (message) => {
						consoleMessages.push(`[${message.type()}] ${message.text()}`);
					});
					page.on('pageerror', (error) => {
						pageErrors.push(String(error.stack || error.message || error));
					});
					page.on('response', (response) => {
						const pathname = new URL(response.url()).pathname;
						const marker = '/wasm-debug/';
						const markerIndex = pathname.indexOf(marker);
						if (markerIndex < 0) return;
						debugAssetResponses.set(
							pathname.slice(markerIndex + marker.length),
							response.status()
						);
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
						if (testCase.programArgs.length > 0) {
							await page
								.locator('.args-chip input')
								.fill(testCase.programArgs.join(' '));
						}
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
						if (testCase.backend === 'lldb') {
							await page.evaluate(
								(line) => (window as any).__wasmIdleDebug.setBreakpoints([line]),
								testCase.breakpointLine
							);
						}

						const debugButton = page.locator('button.action-button--debug');
						await debugButton.waitFor({ state: 'visible' });
						expect(await debugButton.isEnabled()).toBe(true);
						await debugButton.click();
						let startTimeout: ReturnType<typeof setTimeout> | undefined;
						const startOutcome = await Promise.race([
							page
								.getByRole('button', { name: 'Stop Debug' })
								.waitFor({ state: 'visible' })
								.then(() => 'started' as const),
							new Promise<'timed-out'>((resolve) => {
								startTimeout = setTimeout(
									() => resolve('timed-out'),
									Number(process.env.WASM_IDLE_DEBUG_START_TIMEOUT_MS || '120000')
								);
							})
						]).finally(() => {
							if (startTimeout !== undefined) clearTimeout(startTimeout);
						});
						if (startOutcome !== 'started') {
							const transcript =
								(await page
									.locator('[data-testid="terminal-debug-output"]')
									.textContent()
									.catch(() => '')) || '';
							throw new Error(
								`${testCase.language} debug session did not start\n${JSON.stringify(
									{
										startOutcome,
										consoleTail: consoleMessages.slice(-80),
										pageErrors,
										transcript
									},
									null,
									2
								)}`
							);
						}
						let pauseTimeout: ReturnType<typeof setTimeout> | undefined;
						const pauseOutcome = await Promise.race([
							page
								.locator('.debug-status-pill--paused')
								.waitFor({ state: 'visible' })
								.then(() => 'paused' as const),
							debugButton
								.waitFor({ state: 'visible' })
								.then(() => 'finished' as const),
							new Promise<'timed-out'>((resolve) => {
								pauseTimeout = setTimeout(
									() => resolve('timed-out'),
									Number(process.env.WASM_IDLE_DEBUG_PAUSE_TIMEOUT_MS || '120000')
								);
							})
						]).finally(() => {
							if (pauseTimeout !== undefined) clearTimeout(pauseTimeout);
						});
						if (pauseOutcome !== 'paused') {
							const transcript =
								(await page
									.locator('[data-testid="terminal-debug-output"]')
									.textContent()
									.catch(() => '')) || '';
							throw new Error(
								`${testCase.language} debug session did not pause\n${JSON.stringify(
									{
										pauseOutcome,
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
						expect(entryLine).toMatch(/^(?:—|L\d+)$/);
						if (requireLldbDebug && testCase.backend === 'lldb') {
							expect(
								(await page.locator('.debug-hero__copy h2').textContent())?.trim()
							).toBe(testCase.expectedTitle);
							await page.waitForFunction(
								() => {
									const metric = Array.from(
										document.querySelectorAll('.debug-metric')
									).find(
										(element) =>
											element.querySelector('span')?.textContent?.trim() ===
											'Breakpoints'
									);
									return (
										metric?.querySelector('strong')?.textContent?.trim() ===
										'1/1'
									);
								},
								undefined,
								{ timeout: 30_000 }
							);
							const breakpointMetric = await page.evaluate(() => {
								const metric = Array.from(
									document.querySelectorAll('.debug-metric')
								).find(
									(element) =>
										element.querySelector('span')?.textContent?.trim() ===
										'Breakpoints'
								);
								return metric?.querySelector('strong')?.textContent?.trim() || '';
							});
							expect(breakpointMetric).toBe('1/1');
							expect(Object.fromEntries(debugAssetResponses)).toEqual(
								expect.objectContaining(
									Object.fromEntries(
										requiredLldbAssets.map((asset) => [asset, 200])
									)
								)
							);
						}

						let stepStartLine = entryLine;
						if (
							testCase.backend === 'lldb' &&
							entryLine !== `L${testCase.breakpointLine}`
						) {
							await page.locator('button[aria-label="Continue"]').click();
							let continueTimeout: ReturnType<typeof setTimeout> | undefined;
							const continueOutcome = await Promise.race([
								page
									.waitForFunction((previousLine) => {
										const metric = Array.from(
											document.querySelectorAll('.debug-metric')
										).find(
											(element) =>
												element
													.querySelector('span')
													?.textContent?.trim() === 'Line'
										);
										const currentLine = metric
											?.querySelector('strong')
											?.textContent?.trim();
										return (
											document.querySelector('.debug-status-pill--paused') !=
												null &&
											currentLine !== previousLine &&
											currentLine !== 'L0'
										);
									}, entryLine)
									.then(() => 'paused' as const),
								debugButton
									.waitFor({ state: 'visible' })
									.then(() => 'finished' as const),
								new Promise<'timed-out'>((resolve) => {
									continueTimeout = setTimeout(
										() => resolve('timed-out'),
										Number(
											process.env.WASM_IDLE_DEBUG_PAUSE_TIMEOUT_MS || '120000'
										)
									);
								})
							]).finally(() => {
								if (continueTimeout !== undefined) clearTimeout(continueTimeout);
							});
							if (continueOutcome !== 'paused') {
								const transcript =
									(await page
										.locator('[data-testid="terminal-debug-output"]')
										.textContent()
										.catch(() => '')) || '';
								throw new Error(
									`${testCase.language} did not stop at its source breakpoint\n${JSON.stringify(
										{
											continueOutcome,
											consoleTail: consoleMessages.slice(-80),
											pageErrors,
											transcript
										},
										null,
										2
									)}`
								);
							}
							stepStartLine = await readPausedLine(page);
						}

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
						}, stepStartLine);
						if (requireLldbDebug && testCase.backend === 'lldb') {
							const debugState = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.getDebugState()
							);
							expect(debugState.paused).toBe(true);
							expect(debugState.frameId).toBeTypeOf('number');
							expect(debugState.scopes.length).toBeGreaterThan(0);
							expect(debugState.variablesByReference).toEqual([]);

							const loadedVariables = [];
							for (const scope of debugState.scopes) {
								if (scope.variablesReference <= 0) continue;
								try {
									loadedVariables.push(
										...(await page.evaluate(
											(variablesReference) =>
												(window as any).__wasmIdleDebug.loadDebugVariables(
													variablesReference
												),
											scope.variablesReference
										))
									);
								} catch (error) {
									await page.waitForTimeout(100);
									const transcript =
										(await page
											.locator('[data-testid="terminal-debug-output"]')
											.textContent()
											.catch(() => '')) || '';
									const failedState = await page
										.evaluate(() =>
											(window as any).__wasmIdleDebug.getDebugState()
										)
										.catch(() => null);
									throw new Error(
										`${testCase.language} failed to lazily load the ${scope.name} scope\n${JSON.stringify(
											{
												error:
													error instanceof Error
														? error.stack || error.message
														: String(error),
												scope,
												scopes: debugState.scopes,
												failedState,
												consoleTail: consoleMessages.slice(-80),
												pageErrors,
												transcript
											},
											null,
											2
										)}`
									);
								}
							}
							expect(loadedVariables).toEqual(
								expect.arrayContaining([
									expect.objectContaining(testCase.expectedLocal)
								])
							);
							if ('expectedVariableTrees' in testCase) {
								for (const expectedTree of testCase.expectedVariableTrees) {
									const parent = loadedVariables.find(
										(variable) => variable.name === expectedTree.parent
									);
									if (!parent) {
										throw new Error(
											`${testCase.language} did not expose ${expectedTree.parent}`
										);
									}
									expect(parent).toMatchObject({
										name: expectedTree.parent,
										variablesReference: expect.any(Number)
									});
									expect(parent.variablesReference).toBeGreaterThan(0);
									const children = await page.evaluate(
										(variablesReference) =>
											(window as any).__wasmIdleDebug.loadDebugVariables(
												variablesReference
											),
										parent.variablesReference
									);
									expect(children).toEqual(
										expect.arrayContaining(
											expectedTree.variables.map((variable) =>
												expect.objectContaining(variable)
											)
										)
									);
								}
							}
							const loadedState = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.getDebugState()
							);
							expect(loadedState.variablesByReference.length).toBeGreaterThan(0);
							const memory = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.readDebugMemory('0x0', 0, 4)
							);
							expect(memory).toMatchObject({
								data: expect.any(Array),
								unreadableBytes: 0
							});
							expect(memory.data).toHaveLength(4);
						}
						if (
							requireLldbDebug &&
							testCase.backend === 'lldb' &&
							testCase.activePath === 'main.c'
						) {
							await page.evaluate(
								async (source) =>
									await (window as any).__wasmIdleDebug.setEditorValue(
										`${source}\n// edited after the LLDB artifact was compiled`
									),
								testCase.source
							);
							await page.waitForFunction(() =>
								Array.from(document.querySelectorAll('.debug-metric')).some(
									(metric) =>
										metric.querySelector('span')?.textContent?.trim() ===
											'Source' &&
										metric.querySelector('strong')?.textContent?.trim() ===
											'Changed'
								)
							);
							expect(await readPausedLine(page)).toBe('—');
						}
						await page.locator('button[aria-label="Continue"]').click();
						if ('expectedStoppedReason' in testCase) {
							try {
								await page.waitForFunction(
									(expectedReason) =>
										Array.from(document.querySelectorAll('.debug-metric')).some(
											(metric) =>
												metric
													.querySelector('span')
													?.textContent?.trim() === 'Reason' &&
												metric
													.querySelector('strong')
													?.textContent?.trim() === expectedReason
										),
									testCase.expectedStoppedReason,
									{
										timeout: Number(
											process.env.WASM_IDLE_DEBUG_TRAP_TIMEOUT_MS || '30000'
										)
									}
								);
							} catch (error) {
								const debugState = await page
									.evaluate(() => (window as any).__wasmIdleDebug.getDebugState())
									.catch(() => null);
								const debugMetrics = await page.evaluate(() =>
									Array.from(document.querySelectorAll('.debug-metric')).map(
										(metric) => metric.textContent?.trim() || ''
									)
								);
								const transcript =
									(await page
										.locator('[data-testid="terminal-debug-output"]')
										.textContent()
										.catch(() => '')) || '';
								throw new Error(
									`${testCase.language} trap did not stop as ${testCase.expectedStoppedReason}\n${JSON.stringify(
										{
											error:
												error instanceof Error
													? error.stack || error.message
													: String(error),
											debugState,
											debugMetrics,
											consoleTail: consoleMessages.slice(-80),
											pageErrors,
											transcript
										},
										null,
										2
									)}`
								);
							}
							const trapState = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.getDebugState()
							);
							expect(trapState.paused).toBe(true);
							expect(trapState.scopes.length).toBeGreaterThan(0);
							expect(await readPausedLine(page)).toBe('L3');
							await page.getByRole('button', { name: 'Stop Debug' }).click();
						} else {
							await page.waitForFunction(
								(expectedOutput) =>
									document
										.querySelector('[data-testid="terminal-debug-output"]')
										?.textContent?.includes(expectedOutput),
								testCase.expectedOutput
							);
						}
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
