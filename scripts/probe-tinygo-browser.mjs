import {
	DEFAULT_BROWSER_BASE_PATH,
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from './browser-preview-server.mjs';
import { runTinyGoBrowserProbe } from './tinygo-browser-probe-lib.mjs';

const browserUrl =
	process.env.WASM_IDLE_BROWSER_URL || `http://127.0.0.1:4173${DEFAULT_BROWSER_BASE_PATH}`;
const disableHostCompile = process.env.WASM_IDLE_DISABLE_TINYGO_HOST_COMPILE === '1';
const forceHostCompile = process.env.WASM_IDLE_FORCE_TINYGO_HOST_COMPILE === '1';
const runTimeoutMs = Number(process.env.WASM_IDLE_TINYGO_RUN_TIMEOUT_MS || '300000');
const chromiumExecutable = process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || '';
const stdinText = process.env.WASM_IDLE_TINYGO_STDIN || '5\n';
const expectedOutput =
	process.env.WASM_IDLE_TINYGO_EXPECTED_OUTPUT || 'factorial_plus_bonus=123';
const serverMode =
	process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';

await runWithBrowserProbeSessionLock(async () => {
	let previewServer = null;
	try {
		const targetUrl = new URL(browserUrl);
		if (disableHostCompile) {
			targetUrl.searchParams.set('tinygoCompilePath', 'browser');
		} else if (forceHostCompile) {
			targetUrl.searchParams.set('tinygoCompilePath', 'host');
		}
		if (shouldReuseProvidedBrowserUrl(browserUrl)) {
			previewServer = {
				origin: `${targetUrl.protocol}//${targetUrl.host}`,
				browserUrl: targetUrl.toString(),
				close: async () => {}
			};
		} else if (targetUrl.hostname === 'localhost' || targetUrl.hostname === '127.0.0.1') {
			if (serverMode === 'preview') {
				await runBrowserPreparationScripts(['sync:wasm-tinygo', 'build:preview']);
			}
			previewServer = await startBrowserPreviewServer({
				origin: `${targetUrl.protocol}//${targetUrl.host}`,
				basePath: targetUrl.pathname,
				serverMode
			});
		}

		const probeBrowserUrl = (() => {
			const resolvedBrowserUrl = new URL(previewServer?.browserUrl || targetUrl.toString());
			resolvedBrowserUrl.search = targetUrl.search;
			resolvedBrowserUrl.hash = targetUrl.hash;
			return resolvedBrowserUrl.toString();
		})();

		const summary = await runTinyGoBrowserProbe({
			browserUrl: probeBrowserUrl,
			runTimeoutMs,
			chromiumExecutable,
			disableHostCompile,
			expectedCompilePath: forceHostCompile ? 'host' : 'browser',
			stdinText,
			expectedOutput
		});

		console.log(
			JSON.stringify(
				{
					...summary,
					success: true
				},
				null,
				2
			)
		);
	} finally {
		await previewServer?.close?.();
	}
});
