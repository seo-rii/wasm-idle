// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const bashStdinSource = `IFS= read -r value
printf 'main=%d\\n' "$(( value + 5 ))"
`;

describe('wasm-idle Bash browser playwright integration', () => {
	it('runs the real GNU Bash WASIX runtime and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_BASH !== '1') return;

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(
					[
						'sync:wasm-bash',
						'build:static-runtime-modules',
						'compress:static-runtimes',
						'build:preview'
					],
					{ timeoutMs: Number(process.env.WASM_IDLE_BASH_PREP_TIMEOUT_MS || '900000') }
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
							: { origin: 'http://127.0.0.1:4682', serverMode }
					);

			try {
				const probeOptions = {
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'BASH',
					preloadStdin: true,
					runTimeoutMs: Number(process.env.WASM_IDLE_BASH_RUN_TIMEOUT_MS || '180000'),
					source: bashStdinSource,
					stdinText: '68\n'
				};
				const summary = await runStdinBrowserProbe(probeOptions);

				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
			} finally {
				await previewServer.close();
			}
		});
	}, 960_000);
});
