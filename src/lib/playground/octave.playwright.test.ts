// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const octaveStdinSource = `line = fgetl(stdin);
value = str2double(line);
printf("main=%d\\n", value);
`;

describe('wasm-idle Octave browser playwright integration', () => {
	it('runs the real GNU Octave wasm runtime and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_OCTAVE !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(
					['sync:wasm-octave', 'compress:static-runtimes', 'build:preview'],
					{
						timeoutMs: Number(process.env.WASM_IDLE_OCTAVE_PREP_TIMEOUT_MS || '900000')
					}
				);
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
							: { origin: 'http://127.0.0.1:4675', serverMode }
					);

			try {
				const summary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'OCTAVE',
					runTimeoutMs: Number(process.env.WASM_IDLE_OCTAVE_RUN_TIMEOUT_MS || '480000'),
					source: octaveStdinSource,
					stdinText: '73\n'
				});

				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				expect(
					summary.consoleTail.some((entry: string) =>
						entry.includes('[wasm-idle:octave-worker] run start')
					)
				).toBe(true);
			} finally {
				await previewServer.close();
			}
		});
	}, 960_000);
});
