// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runOcamlBrowserProbe } from '../../../scripts/ocaml-browser-probe-lib.mjs';

describe('wasm-idle OCaml browser playwright integration', () => {
	it(
		'runs the real OCaml page path through both bundled browser-native backends',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_OCAML !== '1') {
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
										'sync:wasm-of-js-of-ocaml',
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
										: { origin: 'http://127.0.0.1:4573', serverMode }
								);
							})();

				try {
					for (const backend of ['js', 'wasm'] as const) {
						const summary = await runOcamlBrowserProbe({
							browserUrl: previewServer.browserUrl,
							runTimeoutMs: Number(process.env.WASM_IDLE_OCAML_RUN_TIMEOUT_MS || '300000'),
							expectedOutput: 'hello from ocaml fixture',
							backend
						});

						expect(summary.activeState.crossOriginIsolated).toBe(true);
						expect(summary.activeState.sharedArrayBuffer).toBe(true);
						expect(summary.activeState.serviceWorkerControlled).toBe(true);
						expect(summary.selectedOcamlBackend).toBe(backend);
						expect(summary.pageErrors).toEqual([]);
						expect(summary.moduleResolutionErrors).toEqual([]);
						expect(summary.ocamlConsoleErrors).toEqual([]);
						expect(summary.transcript).toContain('hello from ocaml fixture');
						expect(summary.transcript).toContain('Process finished after');
						if (backend === 'wasm') {
							expect(summary.transcript).not.toContain('binaryen bridge exit: 0');
						}
						expect(
							summary.consoleTail.some((entry) =>
								entry.includes(
									`[wasm-idle:ocaml-worker] compile start prepare=true target=${backend}`
								)
							)
						).toBe(true);
						expect(
							summary.consoleTail.some((entry) =>
								entry.includes('[wasm-idle:ocaml-worker] compile settled success=true')
							)
						).toBe(true);
					}
				} finally {
					await previewServer.close();
				}
			});
		},
		420_000
	);

	it(
		'accepts stdin on the real browser-native js_of_ocaml path',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_OCAML !== '1') {
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
										'sync:wasm-of-js-of-ocaml',
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
										: { origin: 'http://127.0.0.1:4573', serverMode }
								);
							})();

				try {
					const summary = await runOcamlBrowserProbe({
						browserUrl: previewServer.browserUrl,
						runTimeoutMs: Number(process.env.WASM_IDLE_OCAML_RUN_TIMEOUT_MS || '300000'),
						expectedOutput: '5',
						backend: 'js',
						code: 'let () = print_endline (read_line ())',
						stdinText: '5\n'
					});

					expect(summary.activeState.crossOriginIsolated).toBe(true);
					expect(summary.activeState.sharedArrayBuffer).toBe(true);
					expect(summary.activeState.serviceWorkerControlled).toBe(true);
					expect(summary.selectedOcamlBackend).toBe('js');
					expect(summary.pageErrors).toEqual([]);
					expect(summary.moduleResolutionErrors).toEqual([]);
					expect(summary.ocamlConsoleErrors).toEqual([]);
					expect(summary.transcript).toContain('5');
					expect(summary.transcript).toContain('Process finished after');
					expect(
						summary.consoleTail.some((entry) =>
							entry.includes('[wasm-idle:ocaml-stdin] read(bytes=')
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
