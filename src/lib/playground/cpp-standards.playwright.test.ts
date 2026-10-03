// @vitest-environment node

import { afterAll, describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS === '1';
const runTimeoutMs = Number(process.env.WASM_IDLE_CPP_STANDARDS_RUN_TIMEOUT_MS || '420000');
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
			origin: configuredUrl ? new URL(configuredUrl).origin : 'http://127.0.0.1:4683',
			...(configuredUrl ? { basePath: new URL(configuredUrl).pathname } : {}),
			serverMode
		});
	})();
	return previewServerPromise;
}

const cases = [
	{ cppVersion: 'CPP20', minimum: 202002, maximum: 202302 },
	{ cppVersion: 'CPP23', minimum: 202302, maximum: 202400 },
	{ cppVersion: 'CPP26', minimum: 202400, maximum: undefined }
] as const;

describe('C++ standard library browser compatibility', () => {
	it.each(cases)(
		'$cppVersion compiles iostream and runs stdin/stdout with the bundled sysroot',
		{
			skip: !enabled,
			meta: { browser: true, requiredBrowser: enabled },
			timeout: runTimeoutMs + 180_000
		},
		async ({ cppVersion, minimum, maximum }) => {
			expect.hasAssertions();
			await runWithBrowserProbeSessionLock(async () => {
				const preview = await browserPreview();
				const source = `#if __cplusplus < ${minimum}L${maximum ? ` || __cplusplus >= ${maximum}L` : ''}
#error The selected C++ standard was not applied
#endif
#include <iostream>

int main() {
    int value = 0;
    if (!(std::cin >> value)) return 1;
    std::cout << "${cppVersion} main=" << value + 5 << '\\n';
    return 0;
}
`;
				const expectedOutput = `${cppVersion} main=73`;
				const summary = await runStdinBrowserProbe({
					browserUrl: preview.browserUrl,
					language: 'CPP',
					cppVersion,
					source,
					stdinText: '68\n',
					expectedOutput,
					requireSharedArrayBuffer: false,
					// This regression checks header completeness and the actual compiler result.
					checkLoadingProgress: false,
					runTimeoutMs
				});
				expect(summary.execution?.state).toMatchObject({
					status: 'completed',
					exitCode: 0
				});
				expect(summary.transcript).toContain(expectedOutput);
				expect(summary.pageErrors).toEqual([]);
				const requestedPaths = summary.runtimeRequests.map((url) => new URL(url).pathname);
				expect(
					requestedPaths.some((name) => name.endsWith('/clang/bin/c-sysroot.tar.gz'))
				).toBe(true);
				expect(
					requestedPaths.some((name) => name.endsWith('/clang/bin/cpp-addon.tar.gz'))
				).toBe(true);
				expect(
					requestedPaths.some((name) => name.endsWith('/clang/bin/sysroot.tar.gz'))
				).toBe(false);
			});
		}
	);
});
