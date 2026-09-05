// @vitest-environment node

import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
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
		activePath: 'memory-write.c',
		backend: 'lldb',
		breakpointLine: 5,
		expectedLocal: { name: 'value', value: '70' },
		expectedMemoryInspector: { count: 4, variable: 'value' },
		expectedMemoryWrite: {
			data: [100, 0, 0, 0],
			variable: 'value'
		},
		expectedOutput: 'lldb-memory-write=103',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 70;
    volatile int ready = value;
    value += 3;
    printf("lldb-memory-write=%d\\n", value);
    return ready == 70 ? 0 : 2;
}`,
		testId: 'c-memory-write'
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
		activePath: 'data-breakpoint.c',
		backend: 'lldb',
		breakpointLine: 5,
		expectedDataBreakpoint: {
			accessType: 'write',
			data: [73, 0, 0, 0],
			variable: 'value'
		},
		expectedLocal: { name: 'value', value: '70' },
		expectedOutput: 'lldb-data-breakpoint=73',
		expectedStoppedLine: 7,
		expectedStoppedReason: 'data breakpoint',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 70;
    volatile int ready = value;
    value += 3;
    printf("lldb-data-breakpoint=%d\\n", value);
    return ready == 70 ? 0 : 2;
}`,
		testId: 'c-data-breakpoint'
	},
	{
		activePath: 'data-breakpoint-indexed-overlap.c',
		backend: 'lldb',
		breakpointLine: 6,
		expectedDataBreakpoint: {
			accessType: 'write',
			bytes: 1,
			data: [0, 1, 0, 0],
			initialData: [255, 0, 0, 0],
			offset: 5,
			readOffset: 4,
			variable: 'items'
		},
		expectedLocal: { name: 'ready', value: '255' },
		expectedOutput: 'lldb-data-breakpoint-indexed-overlap=256',
		expectedStoppedLine: 9,
		expectedStoppedReason: 'data breakpoint',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int items[3] = {11, 255, 22};
    volatile int ready = items[1];
    volatile int armed = ready;
    items[1] = ready;
    items[1] += 1;
    printf("lldb-data-breakpoint-indexed-overlap=%d\\n", items[1]);
    return ready == 255 && armed == 255 ? 0 : 2;
}`,
		testId: 'c-data-breakpoint-indexed-overlap'
	},
	{
		activePath: 'worker-crash.c',
		backend: 'lldb',
		breakpointLine: 4,
		expectedLocal: { name: 'value', value: '70' },
		expectedOutput: 'lldb-worker-recovery=73',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 70;
    value += 3;
    printf("lldb-worker-recovery=%d\\n", value);
    return 0;
}`,
		testId: 'c-worker-crash',
		workerFailures: ['target', 'lldb'] as const
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
		expectedWatch: { expression: 'pair.first', value: '35' },
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
}`,
		testId: 'cpp-composite'
	},
	{
		activePath: 'data-breakpoint.cpp',
		backend: 'lldb',
		breakpointLine: 5,
		expectedDataBreakpoint: {
			accessType: 'readWrite',
			data: [73, 0, 0, 0],
			variable: 'value'
		},
		expectedLocal: { name: 'value', value: '70' },
		expectedOutput: 'lldb-cpp-data-breakpoint=73',
		expectedStoppedLine: 7,
		expectedStoppedReason: 'data breakpoint',
		expectedTitle: 'C++ · LLDB / WAMR',
		language: 'CPP',
		programArgs: [],
		source: `#include <cstdio>

int main() {
    int value = 70;
    volatile int ready = value;
    value = 73;
    std::printf("lldb-cpp-data-breakpoint=%d\\n", value);
    return ready == 70 ? 0 : 2;
}`,
		testId: 'cpp-data-breakpoint'
	},
	{
		activePath: 'memory-write.cpp',
		backend: 'lldb',
		breakpointLine: 5,
		expectedLocal: { name: 'value', value: '70' },
		expectedMemoryWrite: {
			data: [100, 0, 0, 0],
			variable: 'value'
		},
		expectedOutput: 'lldb-cpp-memory-write=103',
		expectedTitle: 'C++ · LLDB / WAMR',
		language: 'CPP',
		programArgs: [],
		source: `#include <cstdio>

int main() {
    int value = 70;
    volatile int ready = value;
    value += 3;
    std::printf("lldb-cpp-memory-write=%d\\n", value);
    return ready == 70 ? 0 : 2;
}`,
		testId: 'cpp-memory-write'
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
		breakpointSourcePath: 'helper.c',
		expectedLocal: { name: 'value', value: '70' },
		expectedOutput: 'lldb-multifile=73',
		expectedPausedLine: 4,
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
int add_three(int value);`
			},
			{
				path: 'helper.c',
				content: `#include "helper.h"

__attribute__((noinline)) int add_three(int value) {
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
		activePath: 'transport-saturation.c',
		backend: 'lldb',
		breakpointLine: 9,
		expectedLocal: { name: 'value', value: '0' },
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		recoveryOutput: 'lldb-transport-recovery=73',
		recoverySource: `#include <stdio.h>

int main(void) {
    int value = 73;
    printf("lldb-transport-recovery=%d\\n", value);
    return 0;
}`,
		source: `#include <stdio.h>
#include <string.h>

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    char chunk[16384];
    memset(chunk, 'x', sizeof(chunk));
    volatile int value = 0;
    for (;;) {
        fwrite(chunk, 1, sizeof(chunk), stdout);
        fwrite(chunk, 1, sizeof(chunk), stderr);
        value += 1;
    }
}`,
		testId: 'c-transport-saturation',
		transportStress: 'output'
	},
	{
		activePath: 'blocked-stdin.c',
		backend: 'lldb',
		breakpointLine: 4,
		expectedLocal: { name: 'value', value: '0' },
		expectedPrompt: 'lldb-blocked-input? ',
		expectedTitle: 'C · LLDB / WAMR',
		language: 'C',
		programArgs: [],
		recoveryOutput: 'lldb-stdin-recovery=73',
		recoverySource: `#include <stdio.h>

int main(void) {
    int value = 73;
    printf("lldb-stdin-recovery=%d\\n", value);
    return 0;
}`,
		source: `#include <stdio.h>

int main(void) {
    int value = 0;
    printf("lldb-blocked-input? ");
    fflush(stdout);
    if (scanf("%d", &value) != 1) {
        return 2;
    }
    return value;
}`,
		testId: 'c-blocked-stdin',
		transportStress: 'stdin'
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
		activePath: 'manifest-fallback.c',
		backend: 'trace',
		expectedFallbackWarning: 'Unable to load the LLDB runtime manifest (404).',
		expectedNoDebugWorkers: true,
		expectedOutput: 'trace-manifest-fallback=73',
		language: 'C',
		missingDebugResource: 'runtime-manifest.v2.json',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 73;
    printf("trace-manifest-fallback=%d\\n", value);
    return 0;
}`,
		testId: 'c-manifest-fallback'
	},
	{
		activePath: 'asset-session-failure.c',
		backend: 'lldb',
		breakpointLine: 4,
		expectedNoDebugWorkers: true,
		expectedSessionFailure: 'Unable to load LLDB WebAssembly debug asset (404)',
		expectedTitle: 'C · LLDB / WAMR',
		forbiddenOutput: 'late-asset-must-not-run=73',
		language: 'C',
		missingDebugResource: 'debug/lldb-web-dap.wasm',
		programArgs: [],
		source: `#include <stdio.h>

int main(void) {
    int value = 73;
    printf("late-asset-must-not-run=%d\\n", value);
    return 0;
}`,
		testId: 'c-asset-session-failure'
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
}`,
		testId: 'rust-basic'
	},
	{
		activePath: 'data-breakpoint.rs',
		backend: 'lldb',
		breakpointLine: 3,
		expectedDataBreakpoint: {
			accessType: 'read',
			data: [70, 0, 0, 0],
			variable: 'value'
		},
		expectedLocal: { name: 'value', value: '70' },
		expectedOutput: 'lldb-rust-data-breakpoint=73',
		expectedStoppedLine: 4,
		expectedStoppedReason: 'data breakpoint',
		expectedTitle: 'Rust · LLDB / WAMR',
		language: 'RUST',
		programArgs: [],
		source: `fn main() {
    let mut value: i32 = 70;
    let ready = value;
    value += 3;
    println!("lldb-rust-data-breakpoint={value}");
    assert_eq!(ready, 70);
}`,
		testId: 'rust-data-breakpoint'
	},
	{
		activePath: 'memory-write.rs',
		backend: 'lldb',
		breakpointLine: 3,
		expectedLocal: { name: 'value', value: '70' },
		expectedMemoryWrite: {
			data: [100, 0, 0, 0],
			variable: 'value'
		},
		expectedOutput: 'lldb-rust-memory-write=103',
		expectedTitle: 'Rust · LLDB / WAMR',
		language: 'RUST',
		programArgs: [],
		source: `fn main() {
    let mut value: i32 = 70;
    let ready = value;
    value += 3;
    println!("lldb-rust-memory-write={value}");
    assert!(ready >= 0);
}`,
		testId: 'rust-memory-write'
	},
	{
		activePath: 'composite.rs',
		backend: 'lldb',
		breakpointLine: 15,
		expectedLocal: { name: 'result', value: '73' },
		expectedOutput: 'lldb-rust-composite=73:73',
		expectedTitle: 'Rust · LLDB / WAMR',
		expectedVariableTrees: [
			{
				parent: 'pair',
				variables: [
					{ name: 'first', value: '35' },
					{ name: 'second', value: '38' }
				]
			}
		],
		expectedVariableValueIncludes: [{ name: 'marker', value: 'Ready' }],
		language: 'RUST',
		programArgs: [],
		source: `#[derive(Copy, Clone)]
struct Pair {
    first: i32,
    second: i32,
}

#[repr(i32)]
enum Marker {
    Ready = 73,
}

fn main() {
    let pair = Pair { first: 35, second: 38 };
    let marker = Marker::Ready;
    let result = pair.first + pair.second;
    println!("lldb-rust-composite={result}:{}", marker as i32);
}`,
		testId: 'rust-composite-types'
	},
	{
		activePath: 'recursive.rs',
		backend: 'lldb',
		breakpointLine: 6,
		expectedFrameFunction: 'recurse',
		expectedFrameLocals: [
			{ name: 'n', value: '1' },
			{ name: 'n', value: '2' },
			{ name: 'n', value: '3' }
		],
		expectedLocal: { name: 'n', value: '1' },
		expectedOutput: 'lldb-rust-recursive=12',
		expectedTitle: 'Rust · LLDB / WAMR',
		language: 'RUST',
		programArgs: [],
		source: `#[inline(never)]
fn recurse(n: i32) -> i32 {
    let doubled = n * 2;
    if n == 1 {
        let stop = doubled;
        return std::hint::black_box(stop);
    }
    doubled + recurse(n - 1)
}

fn main() {
    let result = recurse(3);
    println!("lldb-rust-recursive={result}");
}`,
		testId: 'rust-recursive-frames'
	},
	{
		activePath: 'panic.rs',
		backend: 'lldb',
		breakpointLine: 2,
		expectedLocal: { name: 'value', value: '73' },
		expectedOutput: 'lldb-rust-panic=73',
		expectedStoppedLine: null,
		expectedStoppedReason: 'exception',
		expectedTitle: 'Rust · LLDB / WAMR',
		expectScopesAtStop: false,
		language: 'RUST',
		programArgs: [],
		source: `fn main() {
    let value = 73;
    panic!("lldb-rust-panic={value}");
}`,
		testId: 'rust-panic'
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
const knownDebugCaseIds = new Set<string>(
	debugCases.flatMap((testCase) => ('testId' in testCase ? [testCase.testId] : []))
);
const unknownRequestedDebugCases = [...requestedDebugCases].filter(
	(testId) => !knownDebugCaseIds.has(testId)
);
if (unknownRequestedDebugCases.length) {
	throw new Error(
		`Unknown WASM_IDLE_DEBUG_BROWSER_CASES selection: ${unknownRequestedDebugCases.join(', ')}`
	);
}
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
	let lastState:
		| {
				crossOriginIsolated: boolean;
				serviceWorkerControlled: boolean;
				sharedArrayBuffer: boolean;
		  }
		| undefined;
	for (let attempt = 0; attempt < 80; attempt += 1) {
		try {
			lastState = await page.evaluate(() => ({
				crossOriginIsolated,
				serviceWorkerControlled: !!navigator.serviceWorker?.controller,
				sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
			}));
		} catch (error) {
			if (!String(error).includes('Execution context was destroyed')) throw error;
			await page.waitForLoadState('domcontentloaded').catch(() => {});
			continue;
		}
		if (
			lastState.crossOriginIsolated &&
			lastState.serviceWorkerControlled &&
			lastState.sharedArrayBuffer
		) {
			return lastState;
		}
		await page.waitForTimeout(250);
	}
	const navigationStates = await page
		.evaluate(() =>
			JSON.parse(sessionStorage.getItem('wasm-idle:test:isolation-navigations') || '[]')
		)
		.catch(() => []);
	throw new Error(
		`Debug browser test requires a cross-origin-isolated service worker page: ${JSON.stringify({
			lastState,
			navigationStates,
			url: page.url()
		})}`
	);
}

async function verifyPagesIsolationBootstrap(page: Page, browserUrl: string) {
	let initialDocumentHeadersStripped = false;
	await page.addInitScript(() => {
		const key = 'wasm-idle:test:isolation-navigations';
		const previous = JSON.parse(sessionStorage.getItem(key) || '[]') as unknown[];
		const navigation = performance.getEntriesByType(
			'navigation'
		)[0] as PerformanceNavigationTiming;
		previous.push({
			controller: !!navigator.serviceWorker?.controller,
			crossOriginIsolated,
			type: navigation?.type
		});
		sessionStorage.setItem(key, JSON.stringify(previous));
	});
	await page.route(
		browserUrl,
		async (route) => {
			const response = await route.fetch();
			const headers = response.headers();
			delete headers['cross-origin-embedder-policy'];
			delete headers['cross-origin-opener-policy'];
			delete headers['cross-origin-resource-policy'];
			initialDocumentHeadersStripped = true;
			await route.fulfill({ response, headers });
		},
		{ times: 1 }
	);

	const state = await ensureSharedBrowserPage(page, browserUrl);
	const navigationStates = await page.evaluate(() =>
		JSON.parse(sessionStorage.getItem('wasm-idle:test:isolation-navigations') || '[]')
	);
	console.info(`[wasm-idle:coi-bootstrap] ${JSON.stringify(navigationStates)}`);
	expect(initialDocumentHeadersStripped).toBe(true);
	expect(navigationStates).toEqual([
		{ controller: false, crossOriginIsolated: false, type: 'navigate' },
		{ controller: true, crossOriginIsolated: true, type: 'reload' }
	]);
	return state;
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
					activeDebug: number;
					created: number;
					createdDebug: number;
					linearMemory: Record<'lldb' | 'target', { peakBytes: number; samples: number }>;
					peakActive: number;
					terminated: number;
					terminatedDebug: number;
				};
			}
		).__wasmIdleWorkerMetrics?.() ?? {
			active: 0,
			activeDebug: 0,
			created: 0,
			createdDebug: 0,
			linearMemory: {
				lldb: { peakBytes: 0, samples: 0 },
				target: { peakBytes: 0, samples: 0 }
			},
			peakActive: 0,
			terminated: 0,
			terminatedDebug: 0
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
			const isolationContext = await browser.newContext();
			try {
				await addBrowserTestCookies(isolationContext, previewServer.browserUrl);
				const isolationBootstrapPage = await isolationContext.newPage();
				const activeState = await verifyPagesIsolationBootstrap(
					isolationBootstrapPage,
					previewServer.browserUrl
				);
				expect(activeState).toEqual({
					crossOriginIsolated: true,
					serviceWorkerControlled: true,
					sharedArrayBuffer: true
				});
			} finally {
				await isolationContext.close();
			}
			const context = await browser.newContext();
			await addBrowserTestCookies(context, previewServer.browserUrl);
			await context.addInitScript(() => {
				const NativeWorker = globalThis.Worker;
				if (typeof NativeWorker !== 'function') return;
				let active = 0;
				let created = 0;
				let activeDebug = 0;
				let createdDebug = 0;
				let peakActive = 0;
				let terminated = 0;
				let terminatedDebug = 0;
				const liveWorkers = new WeakSet<Worker>();
				const debugWorkers = new Map<'lldb' | 'target', Worker>();
				type DebugQueueDescriptor = {
					control: SharedArrayBuffer;
					data: SharedArrayBuffer;
					generation: number;
				};
				const targetQueues = new Map<'stdin' | 'stdout' | 'stderr', DebugQueueDescriptor>();
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
							activeDebug += 1;
							createdDebug += 1;
							peakActive = Math.max(peakActive, activeDebug);
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

					override postMessage(
						message: any,
						transferOrOptions?: Transferable[] | StructuredSerializeOptions
					) {
						if (
							message?.type === 'initialize-target' &&
							message.stdout?.control instanceof SharedArrayBuffer &&
							message.stdout?.data instanceof SharedArrayBuffer &&
							message.stderr?.control instanceof SharedArrayBuffer &&
							message.stderr?.data instanceof SharedArrayBuffer
						) {
							targetQueues.set('stdout', message.stdout);
							targetQueues.set('stderr', message.stderr);
							if (
								message.stdin?.control instanceof SharedArrayBuffer &&
								message.stdin?.data instanceof SharedArrayBuffer
							) {
								targetQueues.set('stdin', message.stdin);
							}
						}
						if (Array.isArray(transferOrOptions)) {
							super.postMessage(message, transferOrOptions);
						} else {
							super.postMessage(message, transferOrOptions);
						}
					}

					override terminate() {
						if (liveWorkers.delete(this)) {
							active -= 1;
							terminated += 1;
						}
						for (const [kind, worker] of debugWorkers) {
							if (worker !== this) continue;
							debugWorkers.delete(kind);
							activeDebug -= 1;
							terminatedDebug += 1;
							if (kind === 'target') targetQueues.clear();
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
						activeDebug,
						created,
						createdDebug,
						linearMemory: {
							lldb: { ...linearMemory.lldb },
							target: { ...linearMemory.target }
						},
						peakActive,
						terminated,
						terminatedDebug
					})
				});
				Object.defineProperty(globalThis, '__wasmIdleDebugWorkerFaults', {
					configurable: true,
					value: {
						saturateOutputAndPause(durationMs: number) {
							if (!Number.isFinite(durationMs) || durationMs < 0) return null;
							const deadline = performance.now() + durationMs;
							while (performance.now() < deadline) {
								// Deliberately stop the product-side output readers while WAMR fills both rings.
							}
							const metric = (channel: 'stdout' | 'stderr') => {
								const descriptor = targetQueues.get(channel);
								if (!descriptor) return null;
								const header = new Int32Array(descriptor.control);
								const read = Atomics.load(header, 0) >>> 0;
								const write = Atomics.load(header, 1) >>> 0;
								return {
									available: (write - read) >>> 0,
									capacity: descriptor.data.byteLength
								};
							};
							const stdout = metric('stdout');
							const stderr = metric('stderr');
							const pauseButton = document.querySelector<HTMLButtonElement>(
								'button[aria-label="Pause"]'
							);
							const pauseRequested = !!pauseButton && !pauseButton.disabled;
							if (pauseRequested) pauseButton.click();
							return { pauseRequested, stdout, stderr };
						},
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
						},
						terminateWorker(workerKind: 'lldb' | 'target') {
							const worker = debugWorkers.get(workerKind);
							if (!worker) return false;
							worker.dispatchEvent(
								new ErrorEvent('error', {
									message: `injected ${workerKind} debug worker crash`
								})
							);
							worker.terminate();
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
					const requestFailures: Array<{ error: string; method: string; url: string }> =
						[];
					const debugAssetResponses = new Map<string, number>();
					page.on('console', (message) => {
						consoleMessages.push(`[${message.type()}] ${message.text()}`);
					});
					page.on('pageerror', (error) => {
						pageErrors.push(String(error.stack || error.message || error));
					});
					page.on('requestfailed', (request) => {
						requestFailures.push({
							error: request.failure()?.errorText || 'unknown request failure',
							method: request.method(),
							url: request.url()
						});
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
						if ('missingDebugResource' in testCase) {
							await page.addInitScript((resourcePath) => {
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
										if (url.pathname.endsWith(`/${resourcePath}`)) {
											return Promise.resolve(
												new Response(
													'missing debug runtime resource fixture',
													{
														status: 404
													}
												)
											);
										}
										return nativeFetch(input, init);
									},
									writable: true
								});
							}, testCase.missingDebugResource);
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
						const workerMetricsBeforeStart =
							'expectedNoDebugWorkers' in testCase
								? await readBrowserLifecycleMetrics(page)
								: null;
						await debugButton.click();
						if ('expectedSessionFailure' in testCase) {
							await page.waitForFunction(
								(expectedFailure) =>
									document
										.querySelector('[data-testid="terminal-debug-output"]')
										?.textContent?.includes(expectedFailure),
								testCase.expectedSessionFailure,
								{
									timeout: Number(
										process.env.WASM_IDLE_DEBUG_START_TIMEOUT_MS || '120000'
									)
								}
							);
							await debugButton.waitFor({ state: 'visible' });
							const transcript =
								(await page
									.locator('[data-testid="terminal-debug-output"]')
									.textContent()) || '';
							expect(transcript).toContain(testCase.expectedSessionFailure);
							expect(transcript).not.toContain(testCase.forbiddenOutput);
							expect(
								consoleMessages.some((message) =>
									message.includes('using trace debugging for this run')
								)
							).toBe(false);
							if (testCase.expectedNoDebugWorkers) {
								const workerMetricsAfterFailure =
									await readBrowserLifecycleMetrics(page);
								expect(workerMetricsAfterFailure.createdDebug).toBe(
									workerMetricsBeforeStart?.createdDebug
								);
								expect(workerMetricsAfterFailure.terminatedDebug).toBe(
									workerMetricsBeforeStart?.terminatedDebug
								);
								expect(workerMetricsAfterFailure.activeDebug).toBe(
									workerMetricsBeforeStart?.activeDebug
								);
							}
							expect(pageErrors).toEqual([]);
							continue;
						}
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
							expect(
								consoleMessages.some((message) =>
									message.includes('using trace debugging for this run')
								)
							).toBe(true);
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
						if ('workerFailures' in testCase) {
							for (const worker of testCase.workerFailures) {
								const beforeFailure = await readBrowserLifecycleMetrics(page);
								const injected = await page.evaluate(
									(workerKind) =>
										(
											window as any
										).__wasmIdleDebugWorkerFaults?.terminateWorker?.(
											workerKind
										) === true,
									worker
								);
								expect(injected).toBe(true);
								console.info(`[wasm-idle:lldb-worker-crash] injected ${worker}`);
								await debugButton.waitFor({
									state: 'visible',
									timeout: Number(
										process.env.WASM_IDLE_DEBUG_DISCONNECT_TIMEOUT_MS || '5000'
									)
								});
								await expect
									.poll(
										async () =>
											(await readBrowserLifecycleMetrics(page)).terminated,
										{ timeout: 5_000 }
									)
									.toBeGreaterThanOrEqual(beforeFailure.terminated + 2);
								const failedState = await page.evaluate(() =>
									(window as any).__wasmIdleDebug.getDebugState()
								);
								expect(failedState.paused).toBe(false);
								console.info(`[wasm-idle:lldb-worker-crash] recovered ${worker}`);
								if (worker !== testCase.workerFailures.at(-1)) {
									await debugButton.click();
									await page
										.getByRole('button', { name: 'Stop Debug' })
										.waitFor({ state: 'visible', timeout: 120_000 });
									await page
										.locator('.debug-status-pill--paused')
										.waitFor({ state: 'visible', timeout: 120_000 });
									console.info(
										`[wasm-idle:lldb-worker-crash] relaunched after ${worker}`
									);
								}
							}
							await page.evaluate(() =>
								(window as any).__wasmIdleDebug.setBreakpoints([])
							);
							await debugButton.click();
							await page
								.getByRole('button', { name: 'Stop Debug' })
								.waitFor({ state: 'visible', timeout: 120_000 });
							await page
								.locator('.debug-status-pill--paused')
								.waitFor({ state: 'visible', timeout: 120_000 });
							await page.locator('button[aria-label="Continue"]').click();
							await page.waitForFunction(
								(expectedOutput) =>
									document
										.querySelector('[data-testid="terminal-debug-output"]')
										?.textContent?.includes(expectedOutput),
								testCase.expectedOutput,
								{ timeout: 120_000 }
							);
							await debugButton.waitFor({ state: 'visible' });
							console.info('[wasm-idle:lldb-worker-crash] final run completed');
							expect(pageErrors).toEqual([]);
							continue;
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
							if ('expectedWatch' in testCase) {
								await page
									.locator('.watch-row input')
									.fill(testCase.expectedWatch.expression);
								await page.locator('.watch-add').click();
								const watchEntry = page.locator('.debug-entry--watch').filter({
									has: page.locator('.debug-expression', {
										hasText: testCase.expectedWatch.expression
									})
								});
								await expect
									.poll(
										async () =>
											(
												await watchEntry
													.locator('.debug-value')
													.textContent()
											)?.trim(),
										{ timeout: 30_000 }
									)
									.toBe(testCase.expectedWatch.value);
							}
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
							if ('expectedVariableValueIncludes' in testCase) {
								for (const expectedVariable of testCase.expectedVariableValueIncludes) {
									const variable = loadedVariables.find(
										(candidate) => candidate.name === expectedVariable.name
									);
									expect(variable?.value).toContain(expectedVariable.value);
								}
							}
							const loadedState = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.getDebugState()
							);
							expect(loadedState.variablesByReference.length).toBeGreaterThan(0);
							if ('expectedMemoryInspector' in testCase) {
								const referenceInput = page.getByLabel('Memory reference');
								const offsetInput = page.getByLabel('Memory offset');
								const countInput = page.getByLabel('Memory byte count');
								expect(await referenceInput.inputValue()).toBe('0x0');
								expect(await offsetInput.inputValue()).toBe('0');
								expect(await countInput.inputValue()).toBe(
									String(testCase.expectedMemoryInspector.count)
								);
								await page
									.locator('.debug-memory-read')
									.evaluate((button: HTMLButtonElement) => button.click());
								const cdpSession = await context.newCDPSession(page);
								await new Promise((resolve) => setTimeout(resolve, 2_000));
								const firstPageResponse = await cdpSession.send(
									'Runtime.evaluate',
									{
										expression: `({
										error: document.querySelector('.debug-memory-error')?.textContent?.trim() ?? '',
										bytes: Array.from(document.querySelectorAll('.debug-memory-byte'), (node) => node.textContent?.trim() ?? '')
									})`,
										returnByValue: true
									}
								);
								const firstPage = firstPageResponse.result.value as {
									bytes: string[];
									error: string;
								};
								expect(
									firstPage,
									JSON.stringify({
										consoleTail: consoleMessages.slice(-80),
										pageErrors
									})
								).toMatchObject({
									error: '',
									bytes: expect.any(Array)
								});
								const displayedBytes = firstPage.bytes;
								expect(displayedBytes).toHaveLength(
									testCase.expectedMemoryInspector.count
								);
								for (const byte of displayedBytes) {
									expect(byte.trim()).toMatch(/^[0-9a-f]{2}$/u);
								}
								await cdpSession.send('Runtime.evaluate', {
									expression: `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Next')?.click()`
								});
								await new Promise((resolve) => setTimeout(resolve, 2_000));
								const nextOffsetResponse = await cdpSession.send(
									'Runtime.evaluate',
									{
										expression: `document.querySelector('[aria-label="Memory offset"]')?.value`,
										returnByValue: true
									}
								);
								expect(nextOffsetResponse.result.value).toBe(
									String(testCase.expectedMemoryInspector.count)
								);
								await cdpSession.send('Runtime.evaluate', {
									expression: `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Previous')?.click()`
								});
								await new Promise((resolve) => setTimeout(resolve, 2_000));
								const previousOffsetResponse = await cdpSession.send(
									'Runtime.evaluate',
									{
										expression: `document.querySelector('[aria-label="Memory offset"]')?.value`,
										returnByValue: true
									}
								);
								expect(previousOffsetResponse.result.value).toBe('0');
								const inspectLabel = `Inspect memory for ${testCase.expectedMemoryInspector.variable}`;
								await cdpSession.send('Runtime.evaluate', {
									expression: `Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === ${JSON.stringify(inspectLabel)})?.click()`
								});
								const selectedInputsResponse = await cdpSession.send(
									'Runtime.evaluate',
									{
										expression: `({
											reference: document.querySelector('[aria-label="Memory reference"]')?.value,
											offset: document.querySelector('[aria-label="Memory offset"]')?.value
										})`,
										returnByValue: true
									}
								);
								const selectedInputs = selectedInputsResponse.result.value as {
									offset: string;
									reference: string;
								};
								expect(selectedInputs.reference).not.toBe('');
								expect(selectedInputs.reference).not.toBe('0x0');
								expect(selectedInputs.offset).toBe('0');
							}
							const memory = await page.evaluate(() =>
								(window as any).__wasmIdleDebug.readDebugMemory('0x0', 0, 4)
							);
							expect(memory).toMatchObject({
								data: expect.any(Array),
								unreadableBytes: 0
							});
							expect(memory.data).toHaveLength(4);
							if ('expectedMemoryWrite' in testCase) {
								const variable = loadedVariables.find(
									(candidate) =>
										candidate.name === testCase.expectedMemoryWrite.variable
								);
								expect(variable?.memoryReference).toBeTypeOf('string');
								if (!variable?.memoryReference) {
									throw new Error(
										`${testCase.language} did not expose a memory reference for ${testCase.expectedMemoryWrite.variable}`
									);
								}
								await page
									.getByLabel('Memory reference')
									.fill(variable.memoryReference);
								await page.getByLabel('Memory offset').fill('0');
								await page
									.getByLabel('Memory write bytes')
									.fill(
										testCase.expectedMemoryWrite.data
											.map((byte) => byte.toString(16).padStart(2, '0'))
											.join(' ')
									);
								await page.getByLabel('Write memory').click();
								await expect
									.poll(
										async () =>
											(
												await page
													.locator('.debug-memory-write-status')
													.textContent()
											)?.trim() || '',
										{ timeout: 30_000 }
									)
									.toContain('4 bytes written');
								const writtenMemory = await page.evaluate(
									(memoryReference) =>
										(window as any).__wasmIdleDebug.readDebugMemory(
											memoryReference,
											0,
											4
										),
									variable.memoryReference
								);
								expect(writtenMemory).toMatchObject({
									data: testCase.expectedMemoryWrite.data,
									unreadableBytes: 0
								});
							}
							if ('expectedDataBreakpoint' in testCase) {
								const variable = loadedVariables.find(
									(candidate) =>
										candidate.name === testCase.expectedDataBreakpoint.variable
								);
								expect(variable?.memoryReference).toBeTypeOf('string');
								if (!variable?.memoryReference) {
									throw new Error(
										`${testCase.language} did not expose a memory reference for ${testCase.expectedDataBreakpoint.variable}`
									);
								}
								await page
									.getByLabel('Memory reference')
									.fill(variable.memoryReference);
								const watchOffset =
									'offset' in testCase.expectedDataBreakpoint
										? testCase.expectedDataBreakpoint.offset
										: 0;
								const watchBytes =
									'bytes' in testCase.expectedDataBreakpoint
										? testCase.expectedDataBreakpoint.bytes
										: 4;
								await page.getByLabel('Memory offset').fill(String(watchOffset));
								await page.getByLabel('Memory byte count').fill(String(watchBytes));
								await page
									.getByLabel('Data breakpoint access')
									.selectOption(testCase.expectedDataBreakpoint.accessType);
								await page.getByLabel('Set data breakpoint').click();
								await expect
									.poll(
										async () =>
											(
												await page
													.locator('.debug-data-breakpoint-status')
													.textContent()
											)?.trim() || '',
										{ timeout: 30_000 }
									)
									.toContain(testCase.expectedDataBreakpoint.accessType);
								if ('initialData' in testCase.expectedDataBreakpoint) {
									const readOffset =
										'readOffset' in testCase.expectedDataBreakpoint
											? testCase.expectedDataBreakpoint.readOffset
											: 0;
									const initialMemory = await page.evaluate(
										({ count, memoryReference, offset }) =>
											(window as any).__wasmIdleDebug.readDebugMemory(
												memoryReference,
												offset,
												count
											),
										{
											count: testCase.expectedDataBreakpoint.initialData
												.length,
											memoryReference: variable.memoryReference,
											offset: readOffset
										}
									);
									expect(initialMemory).toMatchObject({
										data: testCase.expectedDataBreakpoint.initialData,
										unreadableBytes: 0
									});
								}
							}
							if ('testId' in testCase && testCase.testId === 'c-basic') {
								const workerMetrics = await readBrowserLifecycleMetrics(page);
								const linearMemoryLimits = {
									lldb: Number(
										process.env
											.WASM_IDLE_DEBUG_LLDB_LINEAR_MEMORY_LIMIT_BYTES ||
											String(320 * 1024 * 1024)
									),
									target: Number(
										process.env
											.WASM_IDLE_DEBUG_TARGET_LINEAR_MEMORY_LIMIT_BYTES ||
											String(80 * 1024 * 1024)
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
								const expectedFrameFunction =
									'expectedFrameFunction' in testCase
										? testCase.expectedFrameFunction
										: 'recurse';
								const recursiveFrames = debugState.callStack.filter(
									(frame: { id?: number; functionName?: string }) =>
										frame.functionName?.includes(expectedFrameFunction)
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
// edited while paused in ${testCase.breakpointSourcePath}`;
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
						if ('transportStress' in testCase) {
							await page
								.locator('.debug-status-pill--active')
								.waitFor({ state: 'visible' });
							const beforeStress = await readBrowserLifecycleMetrics(page);
							if (testCase.transportStress === 'output') {
								const saturation = await page.evaluate(
									(durationMs) =>
										(
											window as any
										).__wasmIdleDebugWorkerFaults?.saturateOutputAndPause?.(
											durationMs
										) ?? null,
									3_000
								);
								expect(saturation).toMatchObject({
									pauseRequested: true,
									stdout: {
										available: expect.any(Number),
										capacity: expect.any(Number)
									},
									stderr: {
										available: expect.any(Number),
										capacity: expect.any(Number)
									}
								});
								if (!saturation)
									throw new Error('output saturation hook is unavailable');
								for (const channel of [saturation.stdout, saturation.stderr]) {
									expect(channel.available).toBeGreaterThanOrEqual(
										channel.capacity - 16_384
									);
								}
							} else {
								await page.waitForFunction(
									(expectedPrompt) =>
										document
											.querySelector('[data-testid="terminal-debug-output"]')
											?.textContent?.includes(expectedPrompt),
									testCase.expectedPrompt
								);
								const pauseRequested = await page.evaluate(() => {
									const button = document.querySelector<HTMLButtonElement>(
										'button[aria-label="Pause"]'
									);
									if (!button || button.disabled) return false;
									button.click();
									return true;
								});
								expect(pauseRequested).toBe(true);
							}
							const stressPauseTimeoutMs = Number(
								process.env.WASM_IDLE_DEBUG_TRANSPORT_PAUSE_TIMEOUT_MS || '5000'
							);
							let pauseOutcome: 'paused' | 'timeout' = 'paused';
							try {
								await page
									.locator('.debug-status-pill--paused')
									.waitFor({ state: 'visible', timeout: stressPauseTimeoutMs });
							} catch (error) {
								if (!(error instanceof Error) || error.name !== 'TimeoutError')
									throw error;
								pauseOutcome = 'timeout';
							}
							if (testCase.transportStress === 'output') {
								expect(pauseOutcome).toBe('paused');
							}
							if (pauseOutcome === 'paused') {
								const pausedStressState = await page.evaluate(() =>
									(window as any).__wasmIdleDebug.getDebugState()
								);
								expect(pausedStressState.paused).toBe(true);
							}
							await page.getByRole('button', { name: 'Stop Debug' }).click();
							await debugButton.waitFor({
								state: 'visible',
								timeout: Number(
									process.env.WASM_IDLE_DEBUG_DISCONNECT_TIMEOUT_MS ||
										String(stressPauseTimeoutMs * 2)
								)
							});
							await expect
								.poll(
									async () =>
										(await readBrowserLifecycleMetrics(page)).terminated,
									{ timeout: 5_000 }
								)
								.toBeGreaterThanOrEqual(beforeStress.terminated + 2);
							await page.evaluate(
								async (source) =>
									await (window as any).__wasmIdleDebug.setEditorValue(source),
								testCase.recoverySource
							);
							await page.evaluate(() =>
								(window as any).__wasmIdleDebug.setBreakpoints([])
							);
							await debugButton.click();
							await page
								.getByRole('button', { name: 'Stop Debug' })
								.waitFor({ state: 'visible', timeout: 120_000 });
							await page
								.locator('.debug-status-pill--paused')
								.waitFor({ state: 'visible', timeout: 120_000 });
							await page.locator('button[aria-label="Continue"]').click();
							await page.waitForFunction(
								(expectedOutput) =>
									document
										.querySelector('[data-testid="terminal-debug-output"]')
										?.textContent?.includes(expectedOutput),
								testCase.recoveryOutput,
								{ timeout: 120_000 }
							);
							await debugButton.waitFor({ state: 'visible' });
							await expect
								.poll(
									async () =>
										(await readBrowserLifecycleMetrics(page)).terminated,
									{ timeout: 5_000 }
								)
								.toBeGreaterThanOrEqual(beforeStress.terminated + 4);
							const recoveredMetrics = await readBrowserLifecycleMetrics(page);
							expect(recoveredMetrics.created).toBeGreaterThanOrEqual(
								beforeStress.created + 2
							);
							expect(recoveredMetrics.active).toBeLessThanOrEqual(
								beforeStress.active - 2
							);
							console.info(
								`[wasm-idle:lldb-transport-stress] ${JSON.stringify({
									kind: testCase.transportStress,
									pauseOutcome,
									before: beforeStress,
									after: recoveredMetrics
								})}`
							);
							expect(pageErrors).toEqual([]);
							continue;
						}
						if (
							'afterContinue' in testCase &&
							testCase.afterContinue === 'disconnect'
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
						} else if (
							'afterContinue' in testCase &&
							testCase.afterContinue === 'relaunch'
						) {
							await page
								.locator('.debug-status-pill--active')
								.waitFor({ state: 'visible' });
							const repeatCount = Number(
								process.env.WASM_IDLE_DEBUG_RELAUNCH_COUNT || testCase.repeatCount
							);
							if (
								!Number.isSafeInteger(repeatCount) ||
								repeatCount < testCase.repeatCount
							) {
								throw new Error(
									`WASM_IDLE_DEBUG_RELAUNCH_COUNT must be an integer greater than or equal to ${testCase.repeatCount}`
								);
							}
							await page.requestGC();
							const baselineMetrics = await readBrowserLifecycleMetrics(page);
							expect(baselineMetrics.activeDebug).toBe(2);
							expect(baselineMetrics.usedJsHeapSize).toBeGreaterThan(0);
							const heapGrowthLimit = Number(
								process.env.WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES ||
									String(64 * 1024 * 1024)
							);
							let latestMetrics = baselineMetrics;
							const lifecycleMetrics = [baselineMetrics];
							for (let run = 1; run < repeatCount; run += 1) {
								const pausedStatus = page.locator('.debug-status-pill--paused');
								try {
									await page
										.getByRole('button', { name: 'Restart Debug' })
										.click();
									await pausedStatus.waitFor({ state: 'hidden' });
									await pausedStatus.waitFor({
										state: 'visible',
										timeout: 120_000
									});
								} catch (error) {
									const failureMetrics = await readBrowserLifecycleMetrics(
										page
									).catch(() => null);
									const debugState = await page
										.evaluate(() =>
											(window as any).__wasmIdleDebug.getDebugState()
										)
										.catch(() => null);
									const debugMetrics = await page
										.evaluate(() =>
											Array.from(
												document.querySelectorAll('.debug-metric')
											).map((metric) => metric.textContent?.trim() || '')
										)
										.catch(() => []);
									const transcript =
										(await page
											.locator('[data-testid="terminal-debug-output"]')
											.textContent()
											.catch(() => '')) || '';
									const previewStatus = await page.request
										.get(previewServer.browserUrl)
										.then((response) => response.status())
										.catch(() => null);
									throw new Error(
										`C LLDB relaunch ${run + 1}/${repeatCount} did not pause\n${JSON.stringify(
											{
												error:
													error instanceof Error
														? error.stack || error.message
														: String(error),
												failureMetrics,
												debugState,
												debugMetrics,
												pageClosed: page.isClosed(),
												pageUrl: page.url(),
												previewStatus,
												consoleTail: consoleMessages.slice(-80),
												pageErrors,
												requestFailures: requestFailures.slice(-80),
												transcript
											},
											null,
											2
										)}`
									);
								}
								latestMetrics = await readBrowserLifecycleMetrics(page);
								lifecycleMetrics.push(latestMetrics);
								console.info(
									`[wasm-idle:lldb-relaunch] ${JSON.stringify({ run: run + 1, repeatCount, metrics: latestMetrics })}`
								);
								expect(latestMetrics.activeDebug).toBe(2);
								expect(latestMetrics.peakActive).toBeLessThanOrEqual(2);
								expect(
									latestMetrics.created - baselineMetrics.created
								).toBeGreaterThanOrEqual(run * 2);
								expect(
									latestMetrics.terminated - baselineMetrics.terminated
								).toBeGreaterThanOrEqual(run * 2);
							}
							await page.getByRole('button', { name: 'Stop Debug' }).click();
							await debugButton.waitFor({
								state: 'visible',
								timeout: Number(
									process.env.WASM_IDLE_DEBUG_DISCONNECT_TIMEOUT_MS || '5000'
								)
							});
							await page.requestGC();
							latestMetrics = await readBrowserLifecycleMetrics(page);
							lifecycleMetrics.push(latestMetrics);
							expect(latestMetrics.activeDebug).toBe(0);
							expect(latestMetrics.peakActive).toBeLessThanOrEqual(2);
							expect(
								latestMetrics.usedJsHeapSize - baselineMetrics.usedJsHeapSize
							).toBeLessThanOrEqual(heapGrowthLimit);
							console.info(
								`[wasm-idle:lldb-lifecycle] ${JSON.stringify({
									heapGrowthLimit,
									runs: lifecycleMetrics
								})}`
							);
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
							if ('expectScopesAtStop' in testCase && !testCase.expectScopesAtStop) {
								expect(stoppedState.scopes).toEqual([]);
							} else {
								expect(stoppedState.scopes.length).toBeGreaterThan(0);
							}
							if (
								'expectedOutput' in testCase &&
								!('expectedDataBreakpoint' in testCase)
							) {
								await page.waitForFunction(
									(expectedOutput) =>
										document
											.querySelector('[data-testid="terminal-debug-output"]')
											?.textContent?.includes(expectedOutput),
									testCase.expectedOutput
								);
							}
							const stoppedLine = await readPausedLine(page);
							if ('expectedStoppedLine' in testCase) {
								expect(stoppedLine).toBe(
									testCase.expectedStoppedLine == null
										? '—'
										: `L${testCase.expectedStoppedLine}`
								);
							} else if ('afterContinue' in testCase) {
								expect(stoppedLine).toMatch(/^L[34]$/);
							} else {
								expect(stoppedLine).toBe('L3');
							}
							if ('expectedDataBreakpoint' in testCase) {
								const memoryReference = await page
									.getByLabel('Memory reference')
									.inputValue();
								const readOffset =
									'readOffset' in testCase.expectedDataBreakpoint
										? testCase.expectedDataBreakpoint.readOffset
										: 0;
								const watchedMemory = await page.evaluate(
									({ count, memoryReference, offset }) =>
										(window as any).__wasmIdleDebug.readDebugMemory(
											memoryReference,
											offset,
											count
										),
									{
										count: testCase.expectedDataBreakpoint.data.length,
										memoryReference,
										offset: readOffset
									}
								);
								expect(watchedMemory).toMatchObject({
									data: testCase.expectedDataBreakpoint.data,
									unreadableBytes: 0
								});
								await page.getByLabel('Clear data breakpoint').click();
								await page.locator('button[aria-label="Continue"]').click();
								await page.waitForFunction(
									(expectedOutput) =>
										document
											.querySelector('[data-testid="terminal-debug-output"]')
											?.textContent?.includes(expectedOutput),
									testCase.expectedOutput
								);
								await debugButton.waitFor({ state: 'visible' });
							} else {
								await page.getByRole('button', { name: 'Stop Debug' }).click();
							}
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
							if ('expectedTerminalError' in testCase) {
								await debugButton.waitFor({
									state: 'visible',
									timeout: Number(
										process.env.WASM_IDLE_DEBUG_STOP_TIMEOUT_MS || '30000'
									)
								});
								const transcript =
									(await page
										.locator('[data-testid="terminal-debug-output"]')
										.textContent()) || '';
								expect(transcript).toContain(testCase.expectedTerminalError);
							}
						}
						await page
							.locator('button.action-button--debug')
							.waitFor({ state: 'visible' });
						if (
							'expectedFallbackWarning' in testCase &&
							testCase.expectedNoDebugWorkers
						) {
							const workerMetricsAfterFallback =
								await readBrowserLifecycleMetrics(page);
							expect(workerMetricsAfterFallback.createdDebug).toBe(
								workerMetricsBeforeStart?.createdDebug
							);
							expect(workerMetricsAfterFallback.terminatedDebug).toBe(
								workerMetricsBeforeStart?.terminatedDebug
							);
							expect(workerMetricsAfterFallback.activeDebug).toBe(
								workerMetricsBeforeStart?.activeDebug
							);
						}
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
	});
});
