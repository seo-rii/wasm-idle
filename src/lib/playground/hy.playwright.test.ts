// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';
import { WASM_HY_WHEELS } from './wasmHyVersion';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_HY === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };
const runTimeoutMs = Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || 300_000);

const hyStdinSource = `(setv [name #* rest] (.split (input)))
(setv nums (lfor x rest (int x)))
(defmacro twice [form] \`(do ~form ~form))
(twice (print "hy" :end "|"))
(print)
(print (+ "main=" name ":" (str (sum nums))))`;

let previewServerPromise: ReturnType<typeof startBrowserPreviewServer> | null = null;

afterAll(async () => {
	const previewServer = await previewServerPromise?.catch(() => null);
	await previewServer?.close();
});

async function withBrowserPreview(action: (browserUrl: string) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		previewServerPromise ??= (async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			if (shouldReuseProvidedBrowserUrl(configuredBrowserUrl)) {
				return {
					origin: new URL(configuredBrowserUrl).origin,
					browserUrl: configuredBrowserUrl,
					close: async () => {}
				};
			}
			if (serverMode === 'preview') {
				await runBrowserPreparationScripts(['build:preview'], { timeoutMs: 900_000 });
			}
			return await startBrowserPreviewServer(
				configuredBrowserUrl
					? {
							origin: new URL(configuredBrowserUrl).origin,
							basePath: new URL(configuredBrowserUrl).pathname,
							serverMode
						}
					: { origin: 'http://localhost:4581', serverMode }
			);
		})();
		await action((await previewServerPromise).browserUrl);
	});
}

function expectLocalHyWheelsOnly(runtimeRequests: string[]) {
	const paths = runtimeRequests.map((request) => new URL(request).pathname);
	for (const wheel of WASM_HY_WHEELS) {
		expect(paths.some((path) => path.endsWith(`/wasm-hy/${wheel.fileName}`))).toBe(true);
	}
	expect(runtimeRequests.some((request) => /pypi|pythonhosted/u.test(request))).toBe(false);
}

describe.skipIf(!enabled)('real Hy browser runtime on Pyodide', () => {
	it(
		'runs Hy macros with stdin and stdout through the playground',
		{ timeout: runTimeoutMs + 900_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			await withBrowserPreview(async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=wasm:6',
					language: 'HY',
					runTimeoutMs,
					source: hyStdinSource,
					stdinText: 'wasm 1 2 3\n'
				});
				expect(summary.transcript).toContain('hy|hy|');
				expect(summary.transcript).toContain('main=wasm:6');
				expectLocalHyWheelsOnly(summary.runtimeRequests);
			});
		}
	);

	it(
		'runs the default Hy editor program with terminal stdin',
		{ timeout: runTimeoutMs + 900_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			await withBrowserPreview(async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'fibonacci=92',
					language: 'HY',
					runTimeoutMs,
					source: editorDefaults.hy,
					stdinText: '10\n'
				});
				expect(summary.transcript).toContain('fibonacci=92');
			});
		}
	);
});
