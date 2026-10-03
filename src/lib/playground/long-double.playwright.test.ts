// @vitest-environment node

import { afterAll, describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE === '1';
const objectiveCEnabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE === '1';
const runTimeoutMs = Number(process.env.WASM_IDLE_LONG_DOUBLE_RUN_TIMEOUT_MS || '420000');
let previewServerPromise: ReturnType<typeof startBrowserPreviewServer> | undefined;

afterAll(async () => {
	const preview = await previewServerPromise?.catch(() => undefined);
	await preview?.close();
});

async function browserPreview() {
	previewServerPromise ??= (async () => {
		const configuredUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		if (shouldReuseProvidedBrowserUrl(configuredUrl)) {
			return {
				browserUrl: configuredUrl,
				origin: new URL(configuredUrl).origin,
				close: async () => {}
			};
		}
		const serverMode = process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
		if (serverMode === 'preview') {
			await runBrowserPreparationScripts(['build:preview'], { timeoutMs: 900_000 });
		}
		return startBrowserPreviewServer({
			origin: configuredUrl ? new URL(configuredUrl).origin : 'http://127.0.0.1:4685',
			...(configuredUrl ? { basePath: new URL(configuredUrl).pathname } : {}),
			serverMode
		});
	})();
	return previewServerPromise;
}

interface LongDoubleCase {
	name: string;
	language: 'C' | 'CPP' | 'OBJC';
	activePath: string;
	cppVersion?: string;
	source: string;
	expectedOutput: string;
}

const cases: LongDoubleCase[] = [
	{
		name: 'C printf, snprintf and sscanf',
		language: 'C',
		activePath: 'main.c',
		source: `#include <stdio.h>
#include <string.h>

int main(void) {
    printf("C printf=%.3Lf ", 1.25L);
    char formatted[64];
    if (snprintf(formatted, sizeof formatted, "%.3Lf", 2.5L) != 5) return 1;
    if (strcmp(formatted, "2.500") != 0) return 2;
    char precise[64];
    if (snprintf(precise, sizeof precise, "%.21Lf", 1.0L + 0x1p-70L) != 23) return 5;
    if (strcmp(precise, "1.000000000000000000001") != 0) return 6;
    char input[64];
    long double value = 0.0L;
    if (!fgets(input, sizeof input, stdin)) return 3;
    if (sscanf(input, "%Lf", &value) != 1) return 4;
    printf("snprintf=%s sscanf=%.3Lf precise=%s\\n", formatted, value + 0.5L, precise);
    return 0;
}
`,
		expectedOutput: 'C printf=1.250 snprintf=2.500 sscanf=3.750 precise=1.000000000000000000001'
	},
	...[
		{ cppVersion: 'CPP20', minimum: 202002, maximum: 202302 },
		{ cppVersion: 'CPP23', minimum: 202302, maximum: 202400 },
		{ cppVersion: 'CPP26', minimum: 202400, maximum: undefined }
	].map(
		({ cppVersion, minimum, maximum }): LongDoubleCase => ({
			name: `${cppVersion} cout and cin`,
			language: 'CPP',
			activePath: 'main.cpp',
			cppVersion,
			source: `#if __cplusplus < ${minimum}L${maximum ? ` || __cplusplus >= ${maximum}L` : ''}
#error The selected C++ standard was not applied
#endif
#include <iomanip>
#include <iostream>

int main() {
    std::cout << std::fixed << std::setprecision(3) << "${cppVersion} cout=" << 1.25L;
    long double value = 0.0L;
    if (!(std::cin >> value)) return 1;
    std::cout << " cin=" << value + 0.5L << " precise="
              << std::setprecision(21) << (1.0L + 0x1p-70L) << '\\n';
    return 0;
}
`,
			expectedOutput: `${cppVersion} cout=1.250 cin=3.750 precise=1.000000000000000000001`
		})
	),
	{
		name: 'Objective-C printf, snprintf and sscanf',
		language: 'OBJC',
		activePath: 'main.m',
		source: `#if !defined(__OBJC__) || defined(__cplusplus)
#error The source must compile as Objective-C
#endif
#include <stdio.h>
#include <string.h>

int main(void) {
    printf("Objective-C printf=%.3Lf ", 1.25L);
    char formatted[64];
    if (snprintf(formatted, sizeof formatted, "%.3Lf", 2.5L) != 5) return 1;
    if (strcmp(formatted, "2.500") != 0) return 2;
    char precise[64];
    if (snprintf(precise, sizeof precise, "%.21Lf", 1.0L + 0x1p-70L) != 23) return 5;
    if (strcmp(precise, "1.000000000000000000001") != 0) return 6;
    char input[64];
    long double value = 0.0L;
    if (!fgets(input, sizeof input, stdin)) return 3;
    if (sscanf(input, "%Lf", &value) != 1) return 4;
    printf("snprintf=%s sscanf=%.3Lf precise=%s\\n", formatted, value + 0.5L, precise);
    return 0;
}
`,
		expectedOutput:
			'Objective-C printf=1.250 snprintf=2.500 sscanf=3.750 precise=1.000000000000000000001'
	},
	{
		name: 'Objective-C++ cout and cin',
		language: 'OBJC',
		activePath: 'main.mm',
		source: `#if !defined(__OBJC__) || !defined(__cplusplus)
#error The source must compile as Objective-C++
#endif
#include <iomanip>
#include <iostream>

int main() {
    std::cout << std::fixed << std::setprecision(3) << "Objective-C++ cout=" << 1.25L;
    long double value = 0.0L;
    if (!(std::cin >> value)) return 1;
    std::cout << " cin=" << value + 0.5L << " precise="
              << std::setprecision(21) << (1.0L + 0x1p-70L) << '\\n';
    return 0;
}
`,
		expectedOutput: 'Objective-C++ cout=1.250 cin=3.750 precise=1.000000000000000000001'
	}
];

describe('long double browser input and output', () => {
	for (const { name, language, activePath, cppVersion, source, expectedOutput } of cases) {
		const selected = language === 'OBJC' ? objectiveCEnabled : enabled;
		it(
			`${name} formats and parses long double through the real runtime`,
			{
				skip: !selected,
				meta: { browser: true, requiredBrowser: selected },
				timeout: runTimeoutMs + 180_000
			},
			async () => {
				expect.hasAssertions();
				await runWithBrowserProbeSessionLock(async () => {
					const preview = await browserPreview();
					const summary = await runStdinBrowserProbe({
						activePath,
						browserUrl: preview.browserUrl,
						language,
						cppVersion,
						source,
						stdinText: '3.25\n',
						expectedOutput,
						requireSharedArrayBuffer: false,
						checkLoadingProgress: false,
						runTimeoutMs
					});
					expect(summary.execution?.state).toMatchObject({
						status: 'completed',
						exitCode: 0
					});
					expect(summary.transcript).toContain(expectedOutput);
					if (language === 'OBJC') {
						expect(
							summary.consoleTail.some((line: string) =>
								line.includes(`compiling ${activePath}`)
							)
						).toBe(true);
					} else {
						expect(summary.transcript).toContain(
							language === 'C' ? '-x c main.c' : '-x c++ main.cpp'
						);
					}
					expect(summary.transcript).not.toContain('formatting disabled');
					expect(summary.transcript).not.toContain('unreachable');
					expect(summary.pageErrors).toEqual([]);
				});
			}
		);
	}
});
