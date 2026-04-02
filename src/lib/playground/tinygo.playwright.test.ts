// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runTinyGoBrowserProbe } from '../../../scripts/tinygo-browser-probe-lib.mjs';

describe('wasm-idle TinyGo browser playwright integration', () => {
	it(
		'runs the real TinyGo page path through the host-assisted compile seam',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_TINYGO !== '1') {
				return;
			}

			await runWithBrowserProbeSessionLock(async () => {
				const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
				const serverMode =
					process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
				const previewServer =
					shouldReuseProvidedBrowserUrl(configuredBrowserUrl)
						? {
								origin: new URL(configuredBrowserUrl).origin,
								browserUrl: configuredBrowserUrl,
								close: async () => {}
							}
						: await (async () => {
								if (serverMode === 'preview') {
									await runBrowserPreparationScripts([
										'sync:wasm-tinygo',
										'build:preview'
									]);
								}
								return await startBrowserPreviewServer(
									configuredBrowserUrl
										? {
												origin: new URL(configuredBrowserUrl).origin,
												basePath: new URL(configuredBrowserUrl).pathname,
												serverMode
											}
										: { origin: 'http://127.0.0.1:4273', serverMode }
								);
							})();

				try {
					const summary = await runTinyGoBrowserProbe({
						browserUrl: previewServer.browserUrl,
						runTimeoutMs: Number(process.env.WASM_IDLE_TINYGO_RUN_TIMEOUT_MS || '300000'),
						expectedCompilePath: 'host',
						stdinText: '5\n'
					});

				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('tinygo host compile ready: target=wasip1');
				expect(summary.transcript).toContain('factorial_plus_bonus=123');
				expect(summary.transcript).toContain('Process finished after');
				expect(
					summary.consoleTail.some((entry: string) =>
						entry.includes('[wasm-idle:tinygo-worker] wasi run complete exitCode=0')
					)
				).toBe(true);
				} finally {
					await previewServer.close();
				}
			});
		},
		420_000
	);

	it(
		'runs the real TinyGo page path through the browser runtime when host compile is unavailable',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_TINYGO !== '1') {
				return;
			}

			await runWithBrowserProbeSessionLock(async () => {
				const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
				const serverMode =
					process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
				const previewServer =
					shouldReuseProvidedBrowserUrl(configuredBrowserUrl)
						? {
								origin: new URL(configuredBrowserUrl).origin,
								browserUrl: configuredBrowserUrl,
								close: async () => {}
							}
						: await (async () => {
								if (serverMode === 'preview') {
									await runBrowserPreparationScripts([
										'sync:wasm-tinygo',
										'build:preview'
									]);
								}
								return await startBrowserPreviewServer(
									configuredBrowserUrl
										? {
												origin: new URL(configuredBrowserUrl).origin,
												basePath: new URL(configuredBrowserUrl).pathname,
												serverMode
											}
										: { origin: 'http://127.0.0.1:4273', serverMode }
								);
							})();

				try {
					const summary = await runTinyGoBrowserProbe({
						browserUrl: previewServer.browserUrl,
						disableHostCompile: true,
						expectedCompilePath: 'browser',
						runTimeoutMs: Number(process.env.WASM_IDLE_TINYGO_RUN_TIMEOUT_MS || '300000'),
						stdinText: '5\n'
					});

				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.hostCompileRequests).toEqual([]);
				expect(summary.transcript).not.toContain('tinygo host compile ready: target=wasip1');
				expect(summary.transcript).not.toContain('artifact probe failed:');
				expect(summary.transcript).toContain('factorial_plus_bonus=123');
				expect(summary.transcript).toContain('Process finished after');
				expect(
					summary.consoleTail.some((entry: string) =>
						entry.includes('[wasm-idle:tinygo-worker] wasi run complete exitCode=0')
					)
				).toBe(true);
				} finally {
					await previewServer.close();
				}
			});
		},
		420_000
	);
});
