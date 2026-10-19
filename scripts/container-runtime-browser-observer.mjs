/**
 * Start UI probes in the document controlled by the runtime compression service
 * worker. Preview security headers can enable isolation before that worker takes
 * control, while production Pages reaches isolation through its reload.
 * @param {import('playwright-core').Page} page
 * @param {string} browserUrl
 */
export async function prepareContainerRuntimePage(page, browserUrl) {
	await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
	await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
	await page.waitForFunction(
		() =>
			crossOriginIsolated &&
			Boolean(navigator.serviceWorker?.controller) &&
			Boolean(/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.())
	);
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
	await page.waitForFunction(
		() =>
			crossOriginIsolated &&
			Boolean(navigator.serviceWorker?.controller) &&
			Boolean(/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.())
	);
	await page.evaluate(async () => {
		await /** @type {any} */ (window).__wasmIdleContainer.inspect();
	});
}

/**
 * Runtime workers belong to the container owner rather than the window. Observe
 * their actual requests and evidence without changing their transport behavior.
 * @param {import('playwright-core').Page} page
 * @param {{ runtimePath: string; evidenceProtocol?: string; evidenceKind?: string }} options
 */
export async function observeContainerRuntimeWorkers(page, options) {
	const owner = page.workers().find((worker) => /\/owner\.worker[-.]/u.test(worker.url()));
	if (!owner) throw new Error('The initialized container owner Worker is missing');
	await owner.evaluate(({ runtimePath, evidenceProtocol, evidenceKind }) => {
		const target = /** @type {any} */ (globalThis);
		const result = (target.__containerRuntimeBrowserObservation = {
			runs: /** @type {any[]} */ ([]),
			evidence: /** @type {any[]} */ ([])
		});
		const observed = new WeakSet();
		const originalPostMessage = Worker.prototype.postMessage;
		/**
		 * @param {any} message
		 * @param {...any} args
		 */
		Worker.prototype.postMessage = function (message, ...args) {
			if (!observed.has(this)) {
				observed.add(this);
				this.addEventListener('message', ({ data }) => {
					if (
						(evidenceProtocol && data?.evidence?.protocol === evidenceProtocol) ||
						(evidenceKind && data?.evidence?.kind === evidenceKind)
					)
						result.evidence.push(data.evidence);
				});
			}
			if (message?.run && message.baseUrl?.includes(runtimePath))
				result.runs.push(
					structuredClone({
						limits: message.limits,
						code: message.code,
						activePath: message.activePath
					})
				);
			return Reflect.apply(originalPostMessage, this, [message, ...args]);
		};
	}, options);
	return {
		read: () =>
			owner.evaluate(
				() => /** @type {any} */ (globalThis).__containerRuntimeBrowserObservation
			)
	};
}
