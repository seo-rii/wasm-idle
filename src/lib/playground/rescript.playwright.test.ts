// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const runRealBrowser = process.env.WASM_IDLE_RUN_REAL_BROWSER_RESCRIPT === '1';

const rescriptStdinSource = `@module("fs") external readLineSync: int => string = "readLineSync"

Console.log("value?")
let n = readLineSync(0)->String.trim->Int.fromString->Option.getOr(0)
Console.log(\`main=\${Int.toString(n + 5)}\`)
`;

async function withPreviewServer(
	timeoutMs: number,
	callback: (browserUrl: string) => Promise<void>
) {
	await runWithBrowserProbeSessionLock(async () => {
		const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const serverMode = process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
		const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
		if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
			await runBrowserPreparationScripts(
				['sync:wasm-rescript', 'compress:static-runtimes', 'build:preview'],
				{ timeoutMs }
			);
		}
		const previewServer = reuseProvidedBrowserUrl
			? {
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
						: { origin: 'http://127.0.0.1:4678', serverMode }
				);
		try {
			await callback(previewServer.browserUrl);
		} finally {
			await previewServer.close();
		}
	});
}

describe('wasm-idle ReScript browser integration', () => {
	it(
		'compiles with the real ReScript compiler and connects stdin on the page path',
		{
			skip: !runRealBrowser,
			meta: { browser: true, requiredBrowser: runRealBrowser },
			timeout: 960_000
		},
		async () => {
			expect.hasAssertions();
			await withPreviewServer(
				Number(process.env.WASM_IDLE_RESCRIPT_PREP_TIMEOUT_MS || '900000'),
				async (browserUrl) => {
					const summary = await runStdinBrowserProbe({
						browserUrl,
						expectedOutput: 'main=73',
						language: 'RESCRIPT',
						runTimeoutMs: Number(
							process.env.WASM_IDLE_RESCRIPT_RUN_TIMEOUT_MS || '240000'
						),
						sendEof: true,
						source: rescriptStdinSource,
						stdinText: '68\n',
						waitForOutputBeforeStdin: 'value?'
					});
					expect(summary.activeState.crossOriginIsolated).toBe(true);
					expect(summary.activeState.sharedArrayBuffer).toBe(true);
					expect(summary.activeState.serviceWorkerControlled).toBe(true);
					expect(summary.pageErrors).toEqual([]);
					expect(summary.transcript).toContain('value?');
					expect(summary.transcript).toContain('main=73');
					expect(summary.transcript).toContain('Process finished after');
					const runtimePaths = summary.runtimeRequests.map(
						(requestUrl: string) => new URL(requestUrl).pathname
					);
					for (const asset of [
						'runtime-manifest.v1.json',
						'compiler.js.gz.bin',
						'runner-worker.js'
					]) {
						expect(
							runtimePaths.some((path: string) =>
								path.endsWith(`/wasm-rescript/${asset}`)
							)
						).toBe(true);
					}
					expect(
						runtimePaths.some((path: string) =>
							path.endsWith('/wasm-rescript/compiler.js')
						)
					).toBe(false);
				}
			);
		}
	);
});
