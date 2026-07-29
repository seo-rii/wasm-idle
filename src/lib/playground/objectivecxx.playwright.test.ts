// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const objectiveCxxStdinSource = `#include <stdio.h>
#include <objc/runtime.h>
#include "Greeter.h"

int main(void) {
    int value = 0;
    if (scanf("%d", &value) != 1) {
        value = 0;
    }
    Greeter *greeter = (Greeter *)class_createInstance(objc_getClass("Greeter"), 0);
    printf("main=%d\\n", [greeter offset:value]);
    object_dispose(greeter);
    return 0;
}`;

const objectiveCxxGreeterHeader = `#include <objc/runtime.h>

__attribute__((objc_root_class))
@interface Greeter {
    Class isa;
}
- (int)offset:(int)value;
@end`;

const objectiveCxxGreeterImplementation = `#include <string>
#include "Greeter.h"

@implementation Greeter
- (int)offset:(int)value {
    const std::string step = "12345";
    return value + (int)step.size();
}
@end`;

describe('wasm-idle Objective-C++ browser playwright integration', () => {
	it('compiles .mm active and workspace sources and connects stdin in Chromium', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVECXX !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['build:preview'], {
					timeoutMs: Number(
						process.env.WASM_IDLE_OBJECTIVECXX_PREP_TIMEOUT_MS || '900000'
					)
				});
			}
			const previewServer = reuseProvidedBrowserUrl
				? {
						origin: new URL(configuredBrowserUrl).origin,
						browserUrl: configuredBrowserUrl,
						close: async () => {}
					}
				: await startBrowserPreviewServer(
						configuredBrowserUrl
							? {
									origin: new URL(configuredBrowserUrl).origin,
									basePath: new URL(configuredBrowserUrl).pathname,
									serverMode
								}
							: { origin: 'http://127.0.0.1:4676', serverMode }
					);

			try {
				const summary = await runStdinBrowserProbe({
					activePath: 'main.mm',
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'OBJC',
					requireSharedArrayBuffer: false,
					runTimeoutMs: Number(
						process.env.WASM_IDLE_OBJECTIVECXX_RUN_TIMEOUT_MS || '420000'
					),
					source: objectiveCxxStdinSource,
					stdinText: '68\n',
					workspaceFiles: [
						{ path: 'Greeter.h', content: objectiveCxxGreeterHeader },
						{ path: 'Greeter.mm', content: objectiveCxxGreeterImplementation }
					]
				});

				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				expect(
					summary.consoleTail.some((entry: string) => entry.includes('compiling main.mm'))
				).toBe(true);
				expect(
					summary.consoleTail.some((entry: string) =>
						entry.includes('compiling Greeter.mm')
					)
				).toBe(true);
			} finally {
				await previewServer.close();
			}
		});
	}, 960_000);
});
