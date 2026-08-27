// @vitest-environment node

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runRustBrowserProbe } from '../../../scripts/rust-browser-probe-lib.mjs';
import { WASM_RUST_EXECUTABLE_GRAPH_PROFILE } from './wasmRustVersion';

const defaultBrowserRepeats = {
	'wasm32-wasip1': 4,
	'wasm32-wasip2': 4,
	'wasm32-wasip3': 2
} as const;

describe('wasm-idle rust browser playwright integration', () => {
	it('keeps the default retry-race stress above eight fresh Chromium sessions', () => {
		expect(
			Object.values(defaultBrowserRepeats).reduce((total, value) => total + value, 0)
		).toBe(10);
		expect(Object.keys(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules)).toHaveLength(42);
		expect(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules['thread-worker-budget.js']).toBeDefined();
	});

	it('rejects an unbounded executable graph contract before browser startup', async () => {
		const modules = Object.fromEntries(
			Array.from({ length: 257 }, (_, index) => [
				`module-${index}.js`,
				{
					delivery: {
						storagePath: `module-${index}.js.bin`,
						encoding: 'identity' as const
					},
					storage: { sha256: 'a'.repeat(64) }
				}
			])
		);

		await expect(
			runRustBrowserProbe({
				browserUrl: 'https://example.com/wasm-idle/',
				rustExecutableGraphProfile: { entryPath: 'module-0.js', modules }
			})
		).rejects.toThrow('must contain 1-256 modules');
	});

	it('runs the real Rust page path for every shipped wasm-rust target without worker bootstrap or memory-oob failures', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_RUST !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['sync:wasm-rust', 'build:preview']);
			}
			const runtimeManifest = JSON.parse(
				await readFile(
					new URL(
						'../../../static/wasm-rust/runtime/runtime-manifest.v3.json',
						import.meta.url
					),
					'utf8'
				)
			) as {
				targets: Record<string, unknown>;
			};
			const expectedRustTargets = Object.keys(runtimeManifest.targets) as Array<
				'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3'
			>;

			for (const targetTriple of expectedRustTargets) {
				const configuredRepeats =
					targetTriple === 'wasm32-wasip2'
						? process.env.WASM_IDLE_WASIP2_BROWSER_REPEATS
						: targetTriple === 'wasm32-wasip3'
							? process.env.WASM_IDLE_WASIP3_BROWSER_REPEATS
							: process.env.WASM_IDLE_WASIP1_BROWSER_REPEATS;
				const targetRuns = Number(configuredRepeats ?? defaultBrowserRepeats[targetTriple]);
				if (!Number.isSafeInteger(targetRuns) || targetRuns <= 0) {
					throw new Error(
						`Invalid ${targetTriple} browser repeat count: ${configuredRepeats}`
					);
				}
				for (let runIndex = 0; runIndex < targetRuns; runIndex += 1) {
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
									: { origin: 'http://127.0.0.1:4173', serverMode }
							);
					try {
						const summary = await runRustBrowserProbe({
							browserUrl: previewServer.browserUrl,
							runTimeoutMs: Number(
								process.env.WASM_IDLE_RUST_RUN_TIMEOUT_MS || '300000'
							),
							stdinText: '5\n',
							sendEof: false,
							expectedOutput: 'factorial_plus_bonus=123',
							targetTriple,
							rustExecutableGraphProfile: WASM_RUST_EXECUTABLE_GRAPH_PROFILE
						});

						expect(summary.activeState.crossOriginIsolated).toBe(true);
						expect(summary.activeState.sharedArrayBuffer).toBe(true);
						expect(summary.activeState.serviceWorkerControlled).toBe(true);
						expect(summary.availableRustTargets).toEqual(expectedRustTargets);
						expect(
							summary.pageErrors.filter(
								(entry: string) => !entry.includes('Canceled: Canceled')
							)
						).toEqual([]);
						expect(summary.bootstrapErrors).toEqual([]);
						expect(summary.rustConsoleErrors).toEqual([]);
						expect(summary.compilerRetries).toEqual([]);
						expect(summary.callStackErrors).toEqual([]);
						expect(summary.rustExecutableHttpRequests).toEqual([]);
						expect(summary.rustLogicalModuleHttpRequests).toEqual([]);
						expect(summary.unexpectedRustExecutableStorageRequests).toEqual([]);
						expect(summary.rustExecutableGraphStorageEvidence).toHaveLength(
							Object.keys(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules).length
						);
						for (const evidence of summary.rustExecutableGraphStorageEvidence) {
							const module =
								WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules[
									evidence.modulePath as keyof typeof WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules
								];
							expect(module).toBeDefined();
							expect(evidence).toMatchObject({
								encoding: module.delivery.encoding,
								storagePath: module.delivery.storagePath
							});
							const expectedUrl = new URL(evidence.expectedUrl);
							expect(
								expectedUrl.pathname.endsWith(
									`/wasm-rust/${module.delivery.storagePath}`
								)
							).toBe(true);
							expect([...expectedUrl.searchParams]).toEqual([
								['v', module.storage.sha256]
							]);
							expect(evidence.requests.length).toBeGreaterThan(0);
							expect(
								evidence.requests.every(({ url }) => url === evidence.expectedUrl)
							).toBe(true);
							expect(evidence.responses.length).toBeGreaterThan(0);
							for (const response of evidence.responses) {
								expect(response).toMatchObject({
									url: evidence.expectedUrl,
									ok: true
								});
								expect(response.contentType?.split(';', 1)[0]).toBe(
									'application/octet-stream'
								);
								if (module.delivery.encoding === 'gzip') {
									expect(response.contentEncoding).toBeNull();
								}
							}
						}
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
								entry.includes(
									'[wasm-idle:rust-worker] compile settled success=true'
								)
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
							summary.consoleTail.some((entry: string) =>
								/maximum call stack/i.test(entry)
							)
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
		});
	}, 780_000);
});
