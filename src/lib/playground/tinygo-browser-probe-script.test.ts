import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
	delete process.env.WASM_IDLE_BROWSER_URL;
	delete process.env.WASM_IDLE_BROWSER_SERVER_MODE;
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('probe-tinygo-browser script', () => {
	it('uses the configured preview base path by default when no browser url override is provided', async () => {
		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
		const runBrowserPreparationScripts = vi.fn(async () => {});
		const startBrowserPreviewServer = vi.fn(async ({ origin, basePath }) => ({
			origin,
			browserUrl: new URL(basePath, origin).toString(),
			close: async () => {}
		}));
		const runTinyGoBrowserProbe = vi.fn(async () => ({
			activeState: {},
			consoleTail: [],
			pageErrors: [],
			transcript: ''
		}));

		vi.doMock('../../../scripts/browser-preview-server.mjs', () => ({
			DEFAULT_BROWSER_BASE_PATH: '/wasm-idle/',
			runBrowserPreparationScripts,
			runWithBrowserProbeSessionLock: async (action: () => Promise<unknown>) =>
				await action(),
			shouldReuseProvidedBrowserUrl: () => false,
			startBrowserPreviewServer
		}));
		vi.doMock('../../../scripts/tinygo-browser-probe-lib.mjs', () => ({
			runTinyGoBrowserProbe
		}));

		await import('../../../scripts/probe-tinygo-browser.mjs');

		expect(startBrowserPreviewServer).toHaveBeenCalledWith(
			expect.objectContaining({
				origin: 'http://127.0.0.1:4173',
				basePath: '/wasm-idle/',
				serverMode: 'preview'
			})
		);
		expect(runBrowserPreparationScripts).toHaveBeenCalledWith([
			'sync:wasm-tinygo',
			'build:preview'
		]);
		expect(runTinyGoBrowserProbe).toHaveBeenCalledWith(
			expect.objectContaining({
				browserUrl: 'http://127.0.0.1:4173/wasm-idle/'
			})
		);
		expect(consoleLog).toHaveBeenCalled();
	});
});
