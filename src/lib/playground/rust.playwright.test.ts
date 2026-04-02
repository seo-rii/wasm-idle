// @vitest-environment node

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runRustBrowserProbe } from '../../../scripts/rust-browser-probe-lib.mjs';

describe('wasm-idle rust browser playwright integration', () => {
	it(
		'runs the real Rust page path for every shipped wasm-rust target without worker bootstrap or memory-oob failures',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_RUST !== '1') {
				return;
			}

			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['sync:wasm-rust', 'build:preview']);
			}
			const runtimeManifest = JSON.parse(
				await readFile(
					new URL('../../../static/wasm-rust/runtime/runtime-manifest.v3.json', import.meta.url),
					'utf8'
				)
			) as {
				targets: Record<string, unknown>;
			};
			const expectedRustTargets = Object.keys(runtimeManifest.targets) as Array<
				'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3'
			>;

			for (const targetTriple of expectedRustTargets) {
				const targetRuns =
					targetTriple === 'wasm32-wasip2'
						? Number(process.env.WASM_IDLE_WASIP2_BROWSER_REPEATS || '4')
						: targetTriple === 'wasm32-wasip3'
							? Number(process.env.WASM_IDLE_WASIP3_BROWSER_REPEATS || '1')
							: Number(process.env.WASM_IDLE_WASIP1_BROWSER_REPEATS || '2');
				for (let runIndex = 0; runIndex < targetRuns; runIndex += 1) {
					const previewServer =
						reuseProvidedBrowserUrl
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
										: { origin: 'http://127.0.0.1:4173', serverMode }
								);
					try {
						const summary = await runRustBrowserProbe({
							browserUrl: previewServer.browserUrl,
							runTimeoutMs: Number(process.env.WASM_IDLE_RUST_RUN_TIMEOUT_MS || '300000'),
							stdinText: '5\n',
							sendEof: false,
							expectedOutput: 'factorial_plus_bonus=123',
							targetTriple
						});

						expect(summary.activeState.crossOriginIsolated).toBe(true);
						expect(summary.activeState.sharedArrayBuffer).toBe(true);
						expect(summary.activeState.serviceWorkerControlled).toBe(true);
						expect(summary.availableRustTargets).toEqual(expectedRustTargets);
						expect(
							summary.pageErrors.filter((entry: string) => !entry.includes('Canceled: Canceled'))
						).toEqual([]);
						expect(summary.bootstrapErrors).toEqual([]);
						expect(summary.rustConsoleErrors).toEqual([]);
						expect(summary.callStackErrors).toEqual([]);
						expect(summary.transcript).toContain('factorial_plus_bonus=123');
						if (targetTriple === 'wasm32-wasip2') {
							expect(summary.transcript).toContain('preview2_component=preview2-cli');
						}
						if (targetTriple === 'wasm32-wasip3') {
							expect(summary.transcript).toContain(
								'preview3_transition=preview3-transition'
							);
						}
						expect(summary.transcript).toContain('Process finished after');
						expect(summary.transcript).not.toContain('memory access out of bounds');
						expect(summary.transcript).not.toMatch(/maximum call stack/i);
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
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes('state_proxy_equality_mismatch')
							)
						).toBe(false);
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes('memory access out of bounds')
							)
						).toBe(false);
						expect(
							summary.consoleTail.some((entry: string) => /maximum call stack/i.test(entry))
						).toBe(false);
						expect(
							summary.consoleTail.some((entry: string) =>
								entry.includes('[wasm-rust] compile worker bootstrap failed')
							)
						).toBe(false);
					} finally {
						await previewServer.close();
					}
				}
			}
		},
		780_000
	);
});
