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
}`,
		testId: 'c-basic'
	},
	{
		activePath: 'stale-generation.c',
		backend: 'lldb',
		breakpointLine: 4,
		expectedOutput: 'lldb-stale-generation=73',
		expectedLocal: { name: 'value', value: '70' },
		expectedTitle: 'C · LLDB / WAMR',
		injectStaleGeneration: true,
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 70;
    value += 3;
    printf("lldb-stale-generation=%d\\n", value);
    return 0;
}`,
		testId: 'c-stale-generation'
	},
	{
		activePath: 'streaming-stdin.c',
		backend: 'lldb',
		breakpointLine: 4,
		expectedLocal: { name: 'value', value: '0' },
		expectedOutput: 'lldb-input=73',
		expectedPrompt: 'lldb-input? ',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 0;
    printf("lldb-input? ");
    fflush(stdout);
    if (scanf("%d", &value) != 1) {
        return 2;
    }
    printf("lldb-input=%d\\n", value);
    return 0;
}`,
		stdinAfterPrompt: '73\n',
		testId: 'c-streaming-stdin'
	},
	{
		activePath: 'wasi-file.c',
		backend: 'lldb',
		breakpointLine: 4,
		expectedLocal: { name: 'value', value: '0' },
		expectedOutput: 'lldb-file=73',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 0;
    FILE *file = fopen("/workspace/data/input.txt", "r");
    if (!file) {
        printf("lldb-file=missing\\n");
        return 0;
    }
    fscanf(file, "%d", &value);
    fclose(file);
    printf("lldb-file=%d\\n", value);
    return 0;
}`,
		testId: 'c-wasi-file',
		workspaceFiles: [{ path: 'data/input.txt', content: '73\n' }]
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
		activePath: 'recursive.c',
		backend: 'lldb',
		breakpointLine: 6,
		expectedFrameLocals: [
			{ name: 'n', value: '1' },
			{ name: 'n', value: '2' },
			{ name: 'n', value: '3' }
		],
		expectedLocal: { name: 'doubled', value: '2' },
		expectedOutput: 'lldb-recursive=12',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

__attribute__((noinline)) int recurse(int n) {
    int doubled = n * 2;
    if (n == 1) {
        volatile int stop = doubled;
        return stop;
    }
    return doubled + recurse(n - 1);
}

int main(void) {
    int result = recurse(3);
    printf("lldb-recursive=%d\\n", result);
    return 0;
}`,
		testId: 'c-recursive-frames'
	},
	{
		activePath: 'multi-main.c',
		backend: 'lldb',
		breakpointLine: 3,
		breakpointSourcePath: 'helper.h',
		expectedLocal: { name: 'value', value: '70' },
		expectedOutput: 'lldb-multifile=73',
		expectedPausedLine: 3,
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>
#include "helper.h"

int main(void) {
    int value = add_three(70);
    printf("lldb-multifile=%d\\n", value);
    return 0;
}`,
		testId: 'c-multifile-source-revision',
		workspaceFiles: [
			{
				path: 'helper.h',
				content: `#pragma once
static __attribute__((noinline)) int add_three(int value) {
    int result = value + 3;
    return result;
}`
			}
		]
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
		activePath: 'interrupt.c',
		afterContinue: 'pause',
		backend: 'lldb',
		breakpointLine: 2,
		expectedLocal: { name: 'value', value: '0' },
		expectedStoppedReason: 'pause',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `int main(void) {
    volatile int value = 0;
    for (;;) {
        value += 1;
    }
}`,
		testId: 'c-interrupt'
	},
	{
		activePath: 'disconnect.c',
		afterContinue: 'disconnect',
		backend: 'lldb',
		breakpointLine: 2,
		expectedLocal: { name: 'value', value: '0' },
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `int main(void) {
    volatile int value = 0;
    for (;;) {
        value += 1;
    }
}`,
		testId: 'c-disconnect'
	},
	{
		activePath: 'relaunch.c',
		afterContinue: 'relaunch',
		backend: 'lldb',
		breakpointLine: 2,
		expectedLocal: { name: 'value', value: '0' },
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		repeatCount: 3,
		source: `int main(void) {
    volatile int value = 0;
    for (;;) {
        value += 1;
    }
}`,
		testId: 'c-relaunch'
	},
	{
		activePath: 'asset-fallback.c',
		backend: 'trace',
		expectedFallbackWarning: 'LLDB WebAssembly debug asset (404)',
		expectedOutput: 'trace-asset-fallback=73',
		language: 'C',
		missingDebugAsset: 'debug/lldb-web-dap.wasm',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 73;
    printf("trace-asset-fallback=%d\\n", value);
    return 0;
}`,
		testId: 'c-asset-fallback'
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
		let state;
		try {
			state = await page.evaluate(() => ({
				crossOriginIsolated,
				serviceWorkerControlled: !!navigator.serviceWorker?.controller,
				sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
			}));
		} catch (error) {
			if (!String(error).includes('Execution context was destroyed')) throw error;
			await page.waitForLoadState('domcontentloaded');
			continue;
		}
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

async function readBrowserLifecycleMetrics(page: Page) {
	return page.evaluate(() => {
		const workerMetrics = (
			globalThis as typeof globalThis & {
				__wasmIdleWorkerMetrics?: () => {
					active: number;
					created: number;
					linearMemory: Record<'lldb' | 'target', { peakBytes: number; samples: number }>;
					terminated: number;
				};
			}
		).__wasmIdleWorkerMetrics?.() ?? {
			active: 0,
			created: 0,
			linearMemory: {
				lldb: { peakBytes: 0, samples: 0 },
				target: { peakBytes: 0, samples: 0 }
			},
			terminated: 0
		};
		const memory = (
			performance as Performance & {
				memory?: { usedJSHeapSize?: number };
			}
		).memory;
		return {
			...workerMetrics,
			usedJsHeapSize: Number(memory?.usedJSHeapSize ?? 0)
		};
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
			await context.addInitScript(() => {
				const NativeWorker = globalThis.Worker;
				if (typeof NativeWorker !== 'function') return;
				let active = 0;
				let created = 0;
				let terminated = 0;
				const liveWorkers = new WeakSet<Worker>();
				const debugWorkers = new Map<'lldb' | 'target', Worker>();
				const linearMemory = {
					lldb: { peakBytes: 0, samples: 0 },
					target: { peakBytes: 0, samples: 0 }
				};
				class MeasuredWorker extends NativeWorker {
					constructor(url: string | URL, options?: WorkerOptions) {
						super(url, options);
						liveWorkers.add(this);
						active += 1;
						created += 1;
						let debugWorkerKind: 'lldb' | 'target' | undefined;
						if (options?.name === 'wasm-lldb-debugger') {
							debugWorkerKind = 'lldb';
						} else if (options?.name === 'wasm-target-debugger') {
							debugWorkerKind = 'target';
						}
						if (debugWorkerKind) {
							debugWorkers.set(debugWorkerKind, this);
							this.addEventListener('message', (event) => {
								const data: unknown = event.data;
								if (
									!data ||
									typeof data !== 'object' ||
									(data as { type?: unknown }).type !== 'memory' ||
									(data as { worker?: unknown }).worker !== debugWorkerKind
								) {
									return;
								}
								const bytes = (data as { bytes?: unknown }).bytes;
								if (
									typeof bytes !== 'number' ||
									!Number.isSafeInteger(bytes) ||
									bytes <= 0
								) {
									return;
								}
								const metric = linearMemory[debugWorkerKind];
								metric.samples += 1;
								metric.peakBytes = Math.max(metric.peakBytes, bytes);
							});
						}
					}

					override terminate() {
						if (liveWorkers.delete(this)) {
							active -= 1;
							terminated += 1;
						}
						for (const [kind, worker] of debugWorkers) {
							if (worker === this) debugWorkers.delete(kind);
						}
						super.terminate();
					}
				}
				Object.defineProperty(globalThis, 'Worker', {
					configurable: true,
					value: MeasuredWorker,
					writable: true
				});
				Object.defineProperty(globalThis, '__wasmIdleWorkerMetrics', {
					configurable: true,
					value: () => ({
						active,
						created,
						linearMemory: {
							lldb: { ...linearMemory.lldb },
							target: { ...linearMemory.target }
						},
						terminated
					})
				});
				Object.defineProperty(globalThis, '__wasmIdleDebugWorkerFaults', {
					configurable: true,
					value: {
						injectStaleGeneration() {
							const lldbWorker = debugWorkers.get('lldb');
							const targetWorker = debugWorkers.get('target');
							if (!lldbWorker || !targetWorker) return false;
							const generation = `wasm-debug-stale-${Date.now().toString(36)}`;
							lldbWorker.postMessage({ type: 'dispose', generation });
							targetWorker.postMessage({ type: 'interrupt-target', generation });
							targetWorker.postMessage({ type: 'dispose', generation });
							lldbWorker.dispatchEvent(
								new MessageEvent('message', {
									data: {
										type: 'error',
										worker: 'lldb',
										message: 'stale-generation-lldb-error',
										generation
									}
								})
							);
							targetWorker.dispatchEvent(
								new MessageEvent('message', {
									data: {
										type: 'output',
										channel: 'stdout',
										data: 'stale-generation-output',
										generation
									}
								})
							);
							targetWorker.dispatchEvent(
								new MessageEvent('message', {
									data: {
										type: 'error',
										worker: 'target',
										message: 'stale-generation-target-error',
										generation
									}
								})
							);
							targetWorker.dispatchEvent(
								new MessageEvent('message', {
									data: { type: 'exit', exitCode: 91, generation }
								})
							);
							return true;
						}
					}
				});
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
						if ('missingDebugAsset' in testCase) {
							await page.addInitScript((assetPath) => {
								const nativeFetch = globalThis.fetch.bind(globalThis);
								Object.defineProperty(globalThis, 'fetch', {
									configurable: true,
									value: (
										input: URL | RequestInfo,
										init?: RequestInit
									): Promise<Response> => {
										const url =
											input instanceof URL
												? input
												: new URL(
														typeof input === 'string'
															? input
															: input.url,
														location.href
													);
										if (url.pathname.endsWith(`/${assetPath}`)) {
											return Promise.resolve(
												new Response('missing debug asset fixture', {
													status: 404
												})
											);
										}
										return nativeFetch(input, init);
									},
									writable: true
								});
							}, testCase.missingDebugAsset);
						}
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
							async ({ activePath, workspaceFiles }) =>
								await (window as any).__wasmIdleDebug.setWorkspaceFiles(
									workspaceFiles,
									activePath
								),
							{
								activePath: testCase.activePath,
								workspaceFiles:
									'workspaceFiles' in testCase ? testCase.workspaceFiles : []
							}
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
							if ('breakpointSourcePath' in testCase) {
								const breakpointFile = testCase.workspaceFiles.find(
									(file) => file.path === testCase.breakpointSourcePath
								);
								expect(breakpointFile).toBeDefined();
								await page
									.locator(
										`.workspace-files button[title="${testCase.breakpointSourcePath}"]`
									)
									.click();
								await page.waitForFunction(
									(source) =>
										(window as any).__wasmIdleDebug.getEditorValue() === source,
									breakpointFile?.content
								);
							}
							await page.evaluate(
								(line) => (window as any).__wasmIdleDebug.setBreakpoints([line]),
								testCase.breakpointLine
							);
							if ('breakpointSourcePath' in testCase) {
								await page
									.locator(
										`.workspace-files button[title="${testCase.activePath}"]`
									)
									.click();
								await page.waitForFunction(
									(source) =>
										(window as any).__wasmIdleDebug.getEditorValue() === source,
									testCase.source
								);
							}
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
						if ('expectedFallbackWarning' in testCase) {
							await expect
								.poll(() =>
									consoleMessages.find((message) =>
										message.includes(testCase.expectedFallbackWarning)
									)
								)
								.toContain(testCase.expectedFallbackWarning);
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
						if (requireLldbDebug && testCase.backend === 'lldb') {
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
						}
						if ('breakpointSourcePath' in testCase) {
							await page.waitForFunction(
								(sourcePath) => {
									const state = (window as any).__wasmIdleDebug.getDebugState();
									return (
										state.paused &&
										state.callStack.some(
											(frame: { sourcePath?: string }) =>
												frame.sourcePath === sourcePath
										)
									);
								},
								`/workspace/${testCase.breakpointSourcePath}`,
								{
									timeout: Number(
										process.env.WASM_IDLE_DEBUG_PAUSE_TIMEOUT_MS || '120000'
									)
								}
							);
							stepStartLine = await readPausedLine(page);
						}
						if ('injectStaleGeneration' in testCase) {
							const injected = await page.evaluate(
								() =>
									(
										window as any
									).__wasmIdleDebugWorkerFaults?.injectStaleGeneration?.() ===
									true
							);
							expect(injected).toBe(true);
							const stateAfterFault = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.getDebugState()
							);
							expect(stateAfterFault.paused).toBe(true);
							const transcriptAfterFault =
								(await page
									.locator('[data-testid="terminal-debug-output"]')
									.textContent()) || '';
							expect(transcriptAfterFault).not.toContain('stale-generation-output');
						}

						if (!('breakpointSourcePath' in testCase)) {
							await page.locator('button[aria-label="Next Line"]').click();
							await page.waitForFunction((previousLine) => {
								const metric = Array.from(
									document.querySelectorAll('.debug-metric')
								).find(
									(element) =>
										element.querySelector('span')?.textContent?.trim() ===
										'Line'
								);
								return (
									document.querySelector('.debug-status-pill--paused') != null &&
									metric?.querySelector('strong')?.textContent?.trim() !==
										previousLine
								);
							}, stepStartLine);
						}
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
							if ('testId' in testCase && testCase.testId === 'c-basic') {
								const workerMetrics = await readBrowserLifecycleMetrics(page);
								const linearMemoryLimits = {
									lldb: Number(
										process.env
											.WASM_IDLE_DEBUG_LLDB_LINEAR_MEMORY_LIMIT_BYTES ||
											String(640 * 1024 * 1024)
									),
									target: Number(
										process.env
											.WASM_IDLE_DEBUG_TARGET_LINEAR_MEMORY_LIMIT_BYTES ||
											String(320 * 1024 * 1024)
									)
								};
								for (const worker of ['lldb', 'target'] as const) {
									expect(
										workerMetrics.linearMemory[worker].samples,
										`${worker} worker did not report linear-memory telemetry`
									).toBeGreaterThan(0);
									expect(
										workerMetrics.linearMemory[worker].peakBytes
									).toBeLessThanOrEqual(linearMemoryLimits[worker]);
								}
								console.info(
									`[wasm-idle:lldb-linear-memory] ${JSON.stringify({
										limits: linearMemoryLimits,
										workers: workerMetrics.linearMemory
									})}`
								);
							}
							if ('expectedFrameLocals' in testCase) {
								const recursiveFrames = debugState.callStack.filter(
									(frame: { id?: number; functionName?: string }) =>
										frame.functionName === 'recurse'
								);
								expect(recursiveFrames).toHaveLength(
									testCase.expectedFrameLocals.length
								);
								expect(
									new Set(
										recursiveFrames.map((frame: { id?: number }) => frame.id)
									).size
								).toBe(recursiveFrames.length);
								for (
									let index = 0;
									index < testCase.expectedFrameLocals.length;
									index += 1
								) {
									const frame = recursiveFrames[index];
									expect(frame.id).toBeTypeOf('number');
									await page.evaluate(
										(frameId) =>
											(window as any).__wasmIdleDebug.selectDebugFrame(
												frameId
											),
										frame.id
									);
									const selectedState = await page.evaluate(() =>
										(window as any).__wasmIdleDebug.getDebugState()
									);
									expect(selectedState.frameId).toBe(frame.id);
									const frameVariables = [];
									for (const scope of selectedState.scopes) {
										if (scope.variablesReference <= 0) continue;
										frameVariables.push(
											...(await page.evaluate(
												(variablesReference) =>
													(
														window as any
													).__wasmIdleDebug.loadDebugVariables(
														variablesReference
													),
												scope.variablesReference
											))
										);
									}
									expect(frameVariables).toEqual(
										expect.arrayContaining([
											expect.objectContaining(
												testCase.expectedFrameLocals[index]
											)
										])
									);
								}
							}
							if ('breakpointSourcePath' in testCase) {
								const helperPausedLine = await readPausedLine(page);
								expect(helperPausedLine).toBe(`L${testCase.expectedPausedLine}`);
								await page
									.locator(
										`.file-tab.active[title="${testCase.breakpointSourcePath}"]`
									)
									.waitFor({ state: 'visible' });
								const helperSource = testCase.workspaceFiles.find(
									(file) => file.path === testCase.breakpointSourcePath
								)?.content;
								expect(helperSource).toBeDefined();
								await page.waitForFunction(
									(source) =>
										(window as any).__wasmIdleDebug.getEditorValue() === source,
									helperSource
								);
								const multiSourceState = await page.evaluate(() =>
									(window as any).__wasmIdleDebug.getDebugState()
								);
								const helperFrame = multiSourceState.callStack.find(
									(frame: { sourcePath?: string }) =>
										frame.sourcePath ===
										`/workspace/${testCase.breakpointSourcePath}`
								);
								const mainFrame = multiSourceState.callStack.find(
									(frame: { sourcePath?: string }) =>
										frame.sourcePath === `/workspace/${testCase.activePath}`
								);
								expect(helperFrame?.id).toBeTypeOf('number');
								expect(mainFrame?.id).toBeTypeOf('number');
								const editedMainSource = `${testCase.source}
// edited while paused in helper.h`;
								const workspaceReplaced = await page.evaluate(
									async ({ activePath, activeSourcePath, editedMainSource }) =>
										await (window as any).__wasmIdleDebug.setWorkspaceFiles(
											[{ path: activePath, content: editedMainSource }],
											activeSourcePath
										),
									{
										activePath: testCase.activePath,
										activeSourcePath: testCase.breakpointSourcePath,
										editedMainSource
									}
								);
								expect(workspaceReplaced).toBe(true);
								const callStackPanel = page.locator('.debug-panel').filter({
									has: page.locator('h3', { hasText: 'Call Stack' })
								});
								const mainFrameButton = callStackPanel
									.locator('.debug-frame-select')
									.filter({
										has: page.locator('.stack-function', {
											hasText: mainFrame.functionName
										})
									});
								await mainFrameButton.click();
								await page
									.locator(`.file-tab.active[title="${testCase.activePath}"]`)
									.waitFor({ state: 'visible' });
								await page.waitForFunction(
									(source) =>
										(window as any).__wasmIdleDebug.getEditorValue() === source,
									editedMainSource
								);
								await page.waitForFunction((sourcePath) => {
									const state = (window as any).__wasmIdleDebug.getDebugState();
									return (
										state.paused &&
										state.sourcePath === sourcePath &&
										state.pausedSourcePath === sourcePath &&
										state.sourceRevisionStale &&
										state.pausedLine === null
									);
								}, `/workspace/${testCase.activePath}`);
								const helperFrameButton = callStackPanel
									.locator('.debug-frame-select')
									.filter({
										has: page.locator('.stack-function', {
											hasText: helperFrame.functionName
										})
									});
								await helperFrameButton.click();
								await page
									.locator(
										`.file-tab.active[title="${testCase.breakpointSourcePath}"]`
									)
									.waitFor({ state: 'visible' });
								await page.waitForFunction(
									(source) =>
										(window as any).__wasmIdleDebug.getEditorValue() === source,
									helperSource
								);
								await page.waitForFunction(
									({ sourcePath, pausedLine }) => {
										const state = (
											window as any
										).__wasmIdleDebug.getDebugState();
										return (
											state.paused &&
											state.sourcePath === sourcePath &&
											state.pausedSourcePath === sourcePath &&
											!state.sourceRevisionStale &&
											state.pausedLine === pausedLine
										);
									},
									{
										sourcePath: `/workspace/${testCase.breakpointSourcePath}`,
										pausedLine: testCase.expectedPausedLine
									}
								);
								expect(helperPausedLine).toBe(`L${testCase.expectedPausedLine}`);
							}
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
						if ('stdinAfterPrompt' in testCase) {
							await page.waitForFunction(
								(expectedPrompt) =>
									document
										.querySelector('[data-testid="terminal-debug-output"]')
										?.textContent?.includes(expectedPrompt),
								testCase.expectedPrompt
							);
							await page.evaluate(
								async (input) =>
									await (window as any).__wasmIdleDebug.writeTerminalInput(
										input,
										true
									),
								testCase.stdinAfterPrompt
							);
						}
						if (
							'afterContinue' in testCase &&
							(testCase.afterContinue === 'disconnect' ||
								testCase.afterContinue === 'relaunch')
						) {
							await page
								.locator('.debug-status-pill--active')
								.waitFor({ state: 'visible' });
							await page.waitForTimeout(250);
							await page.getByRole('button', { name: 'Stop Debug' }).click();
							await debugButton.waitFor({
								state: 'visible',
								timeout: Number(
									process.env.WASM_IDLE_DEBUG_DISCONNECT_TIMEOUT_MS || '5000'
								)
							});
							if (testCase.afterContinue === 'relaunch') {
								await page.evaluate(() =>
									(window as any).__wasmIdleDebug.setBreakpoints([])
								);
								await page.requestGC();
								const baselineMetrics = await readBrowserLifecycleMetrics(page);
								expect(baselineMetrics.usedJsHeapSize).toBeGreaterThan(0);
								const heapGrowthLimit = Number(
									process.env.WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES ||
										String(64 * 1024 * 1024)
								);
								let latestMetrics = baselineMetrics;
								const lifecycleMetrics = [baselineMetrics];
								for (let run = 1; run < testCase.repeatCount; run += 1) {
									await debugButton.click();
									await page
										.getByRole('button', { name: 'Stop Debug' })
										.waitFor({ state: 'visible' });
									await page
										.locator('.debug-status-pill--paused')
										.waitFor({ state: 'visible' });
									await page.locator('button[aria-label="Continue"]').click();
									await page
										.locator('.debug-status-pill--active')
										.waitFor({ state: 'visible' });
									await page.waitForTimeout(250);
									await page.getByRole('button', { name: 'Stop Debug' }).click();
									await debugButton.waitFor({
										state: 'visible',
										timeout: Number(
											process.env.WASM_IDLE_DEBUG_DISCONNECT_TIMEOUT_MS ||
												'5000'
										)
									});
									await page.waitForTimeout(250);
									const debugState = await page.evaluate(() =>
										(window as any).__wasmIdleDebug.getDebugState()
									);
									expect(debugState.paused).toBe(false);
									await page.requestGC();
									latestMetrics = await readBrowserLifecycleMetrics(page);
									lifecycleMetrics.push(latestMetrics);
									expect(latestMetrics.active).toBeLessThanOrEqual(
										baselineMetrics.active
									);
									expect(
										latestMetrics.usedJsHeapSize -
											baselineMetrics.usedJsHeapSize
									).toBeLessThanOrEqual(heapGrowthLimit);
								}
								const repeatedRuns = testCase.repeatCount - 1;
								expect(
									latestMetrics.created - baselineMetrics.created
								).toBeGreaterThanOrEqual(repeatedRuns * 2);
								expect(
									latestMetrics.terminated - baselineMetrics.terminated
								).toBeGreaterThanOrEqual(repeatedRuns * 2);
								console.info(
									`[wasm-idle:lldb-lifecycle] ${JSON.stringify({
										heapGrowthLimit,
										runs: lifecycleMetrics
									})}`
								);
							}
						} else if ('expectedStoppedReason' in testCase) {
							if ('afterContinue' in testCase && testCase.afterContinue === 'pause') {
								const pauseButton = page.locator('button[aria-label="Pause"]');
								await page.waitForFunction(() => {
									const button = document.querySelector<HTMLButtonElement>(
										'button[aria-label="Pause"]'
									);
									return (
										document.querySelector('.debug-status-pill--active') !=
											null &&
										button != null &&
										!button.disabled
									);
								});
								await page.waitForTimeout(250);
								await pauseButton.click();
							}
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
											process.env.WASM_IDLE_DEBUG_STOP_TIMEOUT_MS || '30000'
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
									`${testCase.language} ${
										'afterContinue' in testCase ? 'interrupt' : 'trap'
									} did not stop as ${testCase.expectedStoppedReason}\n${JSON.stringify(
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
							const stoppedState = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.getDebugState()
							);
							expect(stoppedState.paused).toBe(true);
							expect(stoppedState.scopes.length).toBeGreaterThan(0);
							const stoppedLine = await readPausedLine(page);
							if ('afterContinue' in testCase) {
								expect(stoppedLine).toMatch(/^L[34]$/);
							} else {
								expect(stoppedLine).toBe('L3');
							}
							await page.getByRole('button', { name: 'Stop Debug' }).click();
						} else {
							try {
								await page.waitForFunction(
									(expectedOutput) =>
										document
											.querySelector('[data-testid="terminal-debug-output"]')
											?.textContent?.includes(expectedOutput),
									testCase.expectedOutput
								);
							} catch (error) {
								const debugState = await page
									.evaluate(() => (window as any).__wasmIdleDebug.getDebugState())
									.catch(() => null);
								const transcript =
									(await page
										.locator('[data-testid="terminal-debug-output"]')
										.textContent()
										.catch(() => '')) || '';
								throw new Error(
									`${testCase.language} did not complete with ${testCase.expectedOutput}\n${JSON.stringify(
										{
											error:
												error instanceof Error
													? error.stack || error.message
													: String(error),
											debugState,
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
