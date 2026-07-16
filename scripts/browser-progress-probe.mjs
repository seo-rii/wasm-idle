/**
 * @typedef {{ label: string; value: number }} LoadingProgressEntry
 */

/**
 * @param {import('playwright-core').Page} page
 */
export async function installLoadingProgressProbe(page) {
	await page.evaluate(() => {
		const target = /** @type {any} */ (globalThis);
		target.__wasmIdleProgressTrace = [];
		target.__wasmIdleProgressObserver?.disconnect?.();
		const record = () => {
			const progressBar = document.querySelector('.progress-track[role="progressbar"]');
			if (!progressBar) return;
			const value = Number(progressBar.getAttribute('aria-valuenow'));
			const label = progressBar.getAttribute('aria-label') || '';
			if (!Number.isFinite(value)) return;
			const trace = target.__wasmIdleProgressTrace;
			const previous = trace[trace.length - 1];
			if (!previous || previous.value !== value || previous.label !== label) {
				trace.push({ label, value });
			}
		};
		const observer = new MutationObserver(record);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ['aria-label', 'aria-valuenow'],
			childList: true,
			subtree: true
		});
		target.__wasmIdleProgressObserver = observer;
		record();
	});
}

/**
 * @param {import('playwright-core').Page} page
 * @returns {Promise<LoadingProgressEntry[]>}
 */
export async function readLoadingProgressTrace(page) {
	return await page
		.evaluate(() => /** @type {any} */ (globalThis).__wasmIdleProgressTrace || [])
		.catch(() => []);
}

/**
 * @param {import('playwright-core').Page} page
 */
export async function stopLoadingProgressProbe(page) {
	await page
		.evaluate(() => {
			/** @type {any} */ (globalThis).__wasmIdleProgressObserver?.disconnect?.();
		})
		.catch(() => {});
}

/**
 * @param {LoadingProgressEntry[]} trace
 * @param {string} runtimeLabel
 */
export function assertLoadingProgressTrace(trace, runtimeLabel) {
	if (trace.length === 0) {
		throw new Error(`loading progress was never rendered for ${runtimeLabel}`);
	}
	for (let index = 0; index < trace.length; index += 1) {
		const entry = trace[index];
		const previous = trace[index - 1];
		if (
			!entry.label ||
			!Number.isFinite(entry.value) ||
			entry.value < 0 ||
			entry.value > 100 ||
			(previous && entry.value < previous.value)
		) {
			throw new Error(`invalid loading progress for ${runtimeLabel}`);
		}
	}
	if (!trace.some((entry) => entry.value > 0)) {
		throw new Error(`loading progress never advanced for ${runtimeLabel}`);
	}
}
