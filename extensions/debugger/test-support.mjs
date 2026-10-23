import { readFile, mkdtemp, rm, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';

export async function launchDebuggerBrowser(origin, options = {}) {
	const extension = dirname(fileURLToPath(import.meta.url));
	const profile = await mkdtemp(resolve(tmpdir(), 'wasm-idle-cdp-'));
	const testExtension = resolve(profile, 'extension');
	await mkdir(testExtension);
	for (const file of ['background.js', 'content.js']) {
		await copyFile(resolve(extension, file), resolve(testExtension, file));
	}
	const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
	// A toolbar click grants activeTab in normal use. The harness grants only its
	// loopback origin and calls the identical action handler from a static module.
	manifest.host_permissions = ['http://127.0.0.1/*'];
	manifest.background.service_worker = 'test-background.js';
	await writeFile(resolve(testExtension, 'manifest.json'), JSON.stringify(manifest));
	await writeFile(
		resolve(testExtension, 'test-background.js'),
		'import {toggleDebugger} from "./background.js"; globalThis.enableTestDebugger = toggleDebugger;'
	);
	let context;
	const dispose = async () => {
		await context?.close();
		await rm(profile, { recursive: true, force: true });
	};
	try {
		context = await chromium.launchPersistentContext(profile, {
			channel: 'chromium',
			headless: true,
			timeout: 30_000,
			args: [
				`--disable-extensions-except=${testExtension}`,
				`--load-extension=${testExtension}`
			]
		});
		context.setDefaultTimeout(20_000);
		await addBrowserTestCookies(context, origin);
		await options.prepareContext?.(context);
		const page = await context.newPage();
		await page.goto(origin);
		const background =
			context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
		await background.evaluate(async (origin) => {
			const tab = (await chrome.tabs.query({})).find((item) => item.url?.startsWith(origin));
			await globalThis.enableTestDebugger(tab);
			if ((await chrome.action.getBadgeText({ tabId: tab.id })) !== 'ON')
				throw new Error('Could not enable debugger');
		}, origin);
		return { context, page, dispose };
	} catch (error) {
		await dispose();
		throw error;
	}
}
