// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { runRustBrowserProbe } from '../../../scripts/rust-browser-probe-lib.mjs';

describe('wasm-idle rust browser playwright integration', () => {
	it(
		'runs the real Rust page path repeatedly without worker bootstrap or rust console errors',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_RUST !== '1') {
				return;
			}

			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const previewServer = await startBrowserPreviewServer(
				configuredBrowserUrl
					? {
							origin: new URL(configuredBrowserUrl).origin,
							basePath: new URL(configuredBrowserUrl).pathname
						}
					: undefined
			);

			try {
				for (let run = 0; run < 2; run += 1) {
					const summary = await runRustBrowserProbe({
						browserUrl: previewServer.browserUrl,
						runTimeoutMs: Number(process.env.WASM_IDLE_RUST_RUN_TIMEOUT_MS || '300000'),
						stdinText: '5\n',
						sendEof: false,
						expectedOutput: 'factorial_plus_bonus=123'
					});

					expect(summary.activeState.crossOriginIsolated).toBe(true);
					expect(summary.activeState.sharedArrayBuffer).toBe(true);
					expect(summary.activeState.serviceWorkerControlled).toBe(true);
					expect(
						summary.pageErrors.filter((entry: string) => !entry.includes('Canceled: Canceled'))
					).toEqual([]);
					expect(summary.bootstrapErrors).toEqual([]);
					expect(summary.rustConsoleErrors).toEqual([]);
					expect(summary.transcript).toContain('[wasm-rust] manifest loaded');
					expect(summary.transcript).toContain('[wasm-rust:compiler-worker] starting rustc main');
					expect(summary.transcript).toContain('factorial_plus_bonus=123');
					expect(summary.transcript).toContain('Process finished after');
					expect(
						summary.consoleTail.some((entry: string) =>
							entry.includes('[wasm-idle:rust-stdin] fd_read(bytes=0, eof=true)')
						)
					).toBe(false);
					expect(
						summary.consoleTail.some((entry: string) =>
							entry.includes('[wasm-idle:rust-worker] compile settled success=true')
						)
					).toBe(true);
					const sawRetryAttempt = summary.consoleTail.some((entry: string) =>
						entry.includes('[wasm-rust] compile worker started attempt=2/5')
					);
					if (sawRetryAttempt) {
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes('[wasm-rust] browser rustc attempt 1/5 failed; retrying reason=')
							)
						).toBe(true);
					}
					expect(
						summary.consoleTail.some((entry: string) =>
							entry.includes('[wasm-rust] compile worker bootstrap failed')
						)
					).toBe(false);
				}
			} finally {
				await previewServer.close();
			}
		},
		780_000
	);
});
