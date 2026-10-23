import test from 'node:test';
import assert from 'node:assert/strict';
import { launchDebuggerBrowser } from './test-support.mjs';

const browserUrl = process.env.WASM_IDLE_BROWSER_URL;
test(
	'container owner relays native CDP controls to its nested JavaScript execution Worker',
	{ skip: process.env.WASM_IDLE_RUN_CDP_CONTAINER !== '1', timeout: 120_000 },
	async (t) => {
		if (!browserUrl) throw new Error('Set WASM_IDLE_BROWSER_URL to the local Vite root.');
		const probe = new URL('__container_cdp_probe__', browserUrl).href;
		const browser = await launchDebuggerBrowser(probe, {
			prepareContext: (context) =>
				context.route(probe, (route) =>
					route.fulfill({
						status: 200,
						contentType: 'text/html',
						body: '<!doctype html><title>Container CDP probe</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				)
		});
		try {
			const { page } = browser;
			page.on('pageerror', (error) => t.diagnostic(error.message));
			await page.evaluate(async (base) => {
				const { createContainerPlaygroundBinding } = await import(
					new URL('src/lib/playground/container/binding.ts', base)
				);
				globalThis.binding = createContainerPlaygroundBinding(
					{
						rootUrl: base,
						typescript: {
							javascriptModuleUrl: new URL('wasm-typescript/javascript.js', base).href
						}
					},
					{ applicationRootURL: base, workspaceId: `cdp-test-${crypto.randomUUID()}` }
				);
				globalThis.sandbox = await binding.load('JAVASCRIPT');
				globalThis.source =
					'const fs = require("fs");\nlet value = Number(fs.readFileSync(0, "utf8"));\nvalue += 2;\nconsole.log(value);';
				await binding.syncWorkspace('JAVASCRIPT', [{ path: 'main.js', content: source }]);
				globalThis.events = [];
				globalThis.output = [];
				sandbox.ondebug = (event) => events.push(event);
				sandbox.output = (chunk) => output.push(chunk);
				await sandbox.load();
				globalThis.running = sandbox
					.run(source, false, false, undefined, [], {
						debugMode: 'cdp',
						stdin: '7\n',
						pauseOnEntry: false,
						breakpoints: [3],
						activePath: 'main.js'
					})
					.then(
						(result) => {
							globalThis.result = result;
						},
						(error) => {
							globalThis.error = String(error);
						}
					);
			}, browserUrl);
			await page.waitForFunction(
				() => events.some((event) => event.type === 'pause') || globalThis.error
			);
			assert.equal(await page.evaluate(() => globalThis.error), undefined);
			assert.deepEqual(
				await page.evaluate(async () => {
					const pause = events.find((event) => event.type === 'pause');
					return {
						line: pause.line,
						value: pause.locals.find((item) => item.name === 'value')?.value,
						evaluation: await sandbox.debugEvaluate('value + 4')
					};
				}),
				{ line: 3, value: '7', evaluation: '11' }
			);
			await page.evaluate(() => sandbox.debugCommand('nextLine'));
			await page.waitForFunction(
				() =>
					events.filter((event) => event.type === 'pause').length === 2 ||
					globalThis.error
			);
			assert.equal(
				await page.evaluate(
					() => events.filter((event) => event.type === 'pause').at(-1).line
				),
				4
			);
			await page.evaluate(() => sandbox.debugCommand('continue'));
			await page.evaluate(() => running);
			assert.equal(await page.evaluate(() => globalThis.error), undefined);
			assert.equal(await page.evaluate(() => output.join('')), '9\n');
			await page.evaluate(() => binding.dispose());
		} finally {
			await browser.dispose();
		}
	}
);
