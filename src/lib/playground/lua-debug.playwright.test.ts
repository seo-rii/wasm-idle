// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

describe('Lua MobDebug in Chromium', () => {
	it(
		'uses the Lua VM for breakpoints, evaluation, stepping, stdin/stdout and restart',
		{
			skip: process.env.WASM_IDLE_RUN_LUA_DEBUG !== '1',
			timeout: 120_000
		},
		async () => {
			const browserUrl = process.env.WASM_IDLE_BROWSER_URL;
			if (!browserUrl) throw new Error('Set WASM_IDLE_BROWSER_URL to the Vite server.');
			const browser = await chromium.launch({
				executablePath: await resolveChromiumExecutable(),
				headless: true
			});
			try {
				const context = await browser.newContext();
				await addBrowserTestCookies(context, browserUrl);
				const page = await context.newPage();
				const probeUrl = new URL('__lua_debug_probe__', browserUrl).href;
				await page.route(probeUrl, (route) =>
					route.fulfill({
						status: 200,
						contentType: 'text/html',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						},
						body: '<!doctype html><title>Lua MobDebug integration</title>'
					})
				);
				await page.goto(probeUrl);
				const result = await page.evaluate(
					async ({ browserUrl }) => {
						const { default: Lua } = await new Function('url', 'return import(url)')(
							new URL('src/lib/playground/lua.ts', browserUrl).href
						);
						const sandbox = new Lua();
						const source =
							'local value = tonumber(io.read())\nlocal result = value * 2\nresult = result + 1\nprint(result)';
						const pauses: any[] = [];
						let output = '',
							evaluation = '',
							failure = '';
						sandbox.output = (chunk: string) => {
							output += chunk;
						};
						sandbox.ondebug = (event: any) => {
							if (event.type !== 'pause') return;
							pauses.push(event);
							void (async () => {
								if (pauses.length === 1) {
									evaluation = await sandbox.debugEvaluate('result + 4');
									// Dynamic breakpoint changes use the real MobDebug protocol while paused.
									sandbox.setBreakpoints([4]);
									await sandbox.debugCommand('nextLine');
								} else await sandbox.debugCommand('continue');
							})().catch((error) => {
								failure = String(error);
								sandbox.terminate();
							});
						};
						try {
							await sandbox.load({
								rootUrl: browserUrl,
								lua: { moduleUrl: new URL('wasm-lua/index.js', browserUrl).href }
							});
							const options = {
								debugMode: 'mobdebug',
								pauseOnEntry: false,
								breakpoints: [3],
								stdin: '6\n',
								activePath: 'main.lua'
							};
							await sandbox.run(source, true, false, undefined, [], options);
							await sandbox.run(source, false, false, undefined, [], options);
							await sandbox.run('print("restart-ok")', false, false);
							return { output, evaluation, failure, pauses };
						} catch (error) {
							throw new Error(`${String(error)}\n${output}\n${failure}`);
						} finally {
							await sandbox.dispose();
						}
					},
					{ browserUrl }
				);
				expect(result.failure).toBe('');
				expect(result.evaluation).toBe('16');
				expect(result.pauses.map((pause: any) => pause.line)).toEqual([3, 4]);
				expect(result.pauses[0].locals).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ name: 'value', value: '6' }),
						expect.objectContaining({ name: 'result', value: '12' })
					])
				);
				expect(result.pauses[1].locals).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ name: 'result', value: '13' })
					])
				);
				expect(result.output).toBe('13\nrestart-ok\n');
			} finally {
				await browser.close();
			}
		}
	);
});
