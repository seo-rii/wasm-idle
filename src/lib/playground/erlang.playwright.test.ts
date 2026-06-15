// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const erlangStdinSource = `Line = io:get_line(""),
io:format("main=~s", [Line]).`;

describe('wasm-idle Erlang browser playwright integration', () => {
	it('runs Erlang through the Popcorn/AtomVM wasm runtime and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_ERLANG !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(
					['sync:wasm-elixir', 'compress:static-runtimes', 'build:preview'],
					{
						timeoutMs: Number(process.env.WASM_IDLE_ERLANG_PREP_TIMEOUT_MS || '900000')
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
					language: 'ERLANG',
					runTimeoutMs: Number(process.env.WASM_IDLE_ERLANG_RUN_TIMEOUT_MS || '240000'),
					source: erlangStdinSource,
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
						entry.includes('[wasm-idle:elixir-worker] erlang eval bytes=')
					)
				).toBe(true);
			} finally {
				await previewServer.close();
			}
		});
	}, 960_000);
});
