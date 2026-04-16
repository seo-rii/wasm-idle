// @vitest-environment node

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runGoBrowserProbe } from '../../../scripts/go-browser-probe-lib.mjs';

describe('wasm-idle Go browser playwright integration', () => {
	it(
		'runs the real Go page path through the bundled wasm-go browser compiler',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_GO !== '1') {
				return;
			}

			await runWithBrowserProbeSessionLock(async () => {
				const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
				const serverMode =
					process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
				const runtimeManifest = JSON.parse(
					await readFile(
						new URL('../../../static/wasm-go/runtime/runtime-manifest.v1.json', import.meta.url),
						'utf8'
					)
				) as {
					targets: Record<string, unknown>;
				};
				const expectedGoTargets = Object.keys(runtimeManifest.targets) as Array<
					'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm'
				>;
				const previewServer =
					shouldReuseProvidedBrowserUrl(configuredBrowserUrl)
						? {
								origin: new URL(configuredBrowserUrl).origin,
								browserUrl: configuredBrowserUrl,
								close: async () => {}
							}
						: await (async () => {
								if (serverMode === 'preview') {
									await runBrowserPreparationScripts(['sync:wasm-go', 'build:preview']);
								}
								return await startBrowserPreviewServer(
									configuredBrowserUrl
										? {
												origin: new URL(configuredBrowserUrl).origin,
												basePath: new URL(configuredBrowserUrl).pathname,
												serverMode
											}
										: { origin: 'http://127.0.0.1:4373', serverMode }
								);
							})();

				try {
					for (const target of expectedGoTargets) {
						const summary = await runGoBrowserProbe({
							browserUrl: previewServer.browserUrl,
							runTimeoutMs: Number(process.env.WASM_IDLE_GO_RUN_TIMEOUT_MS || '300000'),
							stdinText: '5\n',
							expectedOutput: 'factorial_plus_bonus=123',
							target,
							stdinMethod: 'keyboard'
						});

						expect(summary.activeState.crossOriginIsolated).toBe(true);
						expect(summary.activeState.sharedArrayBuffer).toBe(true);
						expect(summary.activeState.serviceWorkerControlled).toBe(true);
						expect(summary.availableGoTargets).toEqual(expectedGoTargets);
						expect(summary.selectedGoTarget).toBe(target);
						expect(summary.pageErrors).toEqual([]);
						expect(summary.moduleResolutionErrors).toEqual([]);
						expect(summary.goConsoleErrors).toEqual([]);
						expect(summary.transcript).toContain('factorial_plus_bonus=123');
						expect(summary.transcript).toContain('Process finished after');
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes(`[wasm-idle:go-worker] compile start prepare=true target=${target}`)
							)
						).toBe(true);
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes('[wasm-idle:go-worker] compile settled success=true')
							)
						).toBe(true);
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes(`[wasm-idle:go-worker] runtime start target=${target}`)
							)
						).toBe(true);
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes('[wasm-idle:go-worker] wasi run complete exitCode=0')
							)
						).toBe(true);
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes('Failed to resolve module specifier')
							)
						).toBe(false);
					}
				} finally {
					await previewServer.close();
				}
			});
		},
		420_000
	);
});
