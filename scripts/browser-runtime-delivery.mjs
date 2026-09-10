/** Enable the application's real compressed-asset delivery on a minimal adapter page. */
export async function installBrowserRuntimeDelivery(page, baseUrl) {
	await page.evaluate(async (base) => {
		await navigator.serviceWorker.register(new URL('worker.js', base).href, {
			scope: new URL(base).pathname
		});
		await navigator.serviceWorker.ready;
	}, baseUrl);
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}
