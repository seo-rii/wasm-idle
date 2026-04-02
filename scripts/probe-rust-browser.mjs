import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from './browser-preview-server.mjs';
import { runRustBrowserProbe } from './rust-browser-probe-lib.mjs';

const browserUrl = process.env.WASM_IDLE_BROWSER_URL || 'http://127.0.0.1:4173/absproxy/5173/';
const runTimeoutMs = Number(process.env.WASM_IDLE_RUST_RUN_TIMEOUT_MS || '300000');
const chromiumExecutable = process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || '';
const stdinText = process.env.WASM_IDLE_RUST_STDIN || '5\n';
const sendEof = process.env.WASM_IDLE_RUST_SEND_EOF === '1';
const expectedOutput =
	process.env.WASM_IDLE_RUST_EXPECTED_OUTPUT || 'factorial_plus_bonus=123';
const serverMode =
	process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';

await runWithBrowserProbeSessionLock(async () => {
	let previewServer = null;
	try {
		const targetUrl = new URL(browserUrl);
		if (shouldReuseProvidedBrowserUrl(browserUrl)) {
			previewServer = {
				origin: `${targetUrl.protocol}//${targetUrl.host}`,
				browserUrl,
				close: async () => {}
			};
		} else if (targetUrl.hostname === 'localhost' || targetUrl.hostname === '127.0.0.1') {
			if (serverMode === 'preview') {
				await runBrowserPreparationScripts(['sync:wasm-rust', 'build:preview']);
			}
			previewServer = await startBrowserPreviewServer({
				origin: `${targetUrl.protocol}//${targetUrl.host}`,
				basePath: targetUrl.pathname,
				serverMode
			});
		}

		const summary = await runRustBrowserProbe({
			browserUrl: previewServer?.browserUrl || browserUrl,
			runTimeoutMs,
			chromiumExecutable,
			stdinText,
			sendEof,
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
