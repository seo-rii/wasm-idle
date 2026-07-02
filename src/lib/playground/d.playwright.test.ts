// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const dStdinSource = `import std.stdio;
import std.string;

void main()
{
    auto line = stdin.readln();
    writeln("main=", line.chomp());
}`;

describe('wasm-idle D browser playwright integration', () => {
	it('runs the real D page path through bundled LDC and Emscripten LLD assets', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_D !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['sync:wasm-d', 'build:preview'], {
					timeoutMs: Number(process.env.WASM_IDLE_D_PREP_TIMEOUT_MS || '600000')
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
							: { origin: 'http://127.0.0.1:4673', serverMode }
					);

			try {
				const summary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'D',
					runTimeoutMs: Number(process.env.WASM_IDLE_D_RUN_TIMEOUT_MS || '420000'),
					source: dStdinSource,
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
						entry.includes('[wasm-idle:d-worker] compile settled success=true')
					)
				).toBe(true);
			} finally {
				await previewServer.close();
			}
		});
	}, 720_000);
});
