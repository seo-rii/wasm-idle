/**
 * @typedef {{
 *   label: string;
 *   value: number | null;
 *   mode?: 'determinate' | 'indeterminate' | 'hidden';
 *   at?: number;
 * }} LoadingProgressEntry
 */

export const MAX_DETERMINATE_PROGRESS_PLATEAU_MS = 4_000;

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
			const trace = target.__wasmIdleProgressTrace;
			const previous = trace[trace.length - 1];
			const at = performance.now();
			if (!progressBar) {
				if (previous && previous.mode !== 'hidden') {
					trace.push({ label: previous.label, value: null, mode: 'hidden', at });
				}
				return;
			}
			const label = progressBar.getAttribute('aria-label') || '';
			const mode =
				progressBar.getAttribute('data-progress-mode') === 'indeterminate'
					? 'indeterminate'
					: 'determinate';
			const rawValue = progressBar.getAttribute('aria-valuenow');
			const value =
				mode === 'determinate' && rawValue !== null && rawValue.trim() !== ''
					? Number(rawValue)
					: null;
			if (
				!previous ||
				previous.value !== value ||
				previous.label !== label ||
				previous.mode !== mode
			) {
				trace.push({ label, value, mode, at });
			}
		};
		const observer = new MutationObserver(record);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ['aria-label', 'aria-valuenow', 'data-progress-mode'],
			childList: true,
			subtree: true
		});
		target.__wasmIdleProgressObserver = observer;
		target.__wasmIdleProgressRecord = record;
		record();
	});
}

/**
 * @param {import('playwright-core').Page} page
 * @returns {Promise<LoadingProgressEntry[]>}
 */
export async function readLoadingProgressTrace(page) {
	return await page
		.evaluate(() => {
			const target = /** @type {any} */ (globalThis);
			target.__wasmIdleProgressRecord?.();
			return target.__wasmIdleProgressTrace || [];
		})
		.catch(() => []);
}

/**
 * @param {import('playwright-core').Page} page
 */
export async function stopLoadingProgressProbe(page) {
	await page
		.evaluate(() => {
			const target = /** @type {any} */ (globalThis);
			target.__wasmIdleProgressRecord?.();
			target.__wasmIdleProgressObserver?.disconnect?.();
			delete target.__wasmIdleProgressRecord;
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
	const hasTimestamps = trace.some((entry) => entry.at !== undefined);
	let previousTimestamp = -1;
	let previousValue = -1;
	for (let index = 0; index < trace.length; index += 1) {
		const entry = trace[index];
		const mode = entry.mode || 'determinate';
		if (hasTimestamps) {
			if (
				typeof entry.at !== 'number' ||
				!Number.isFinite(entry.at) ||
				entry.at < previousTimestamp
			) {
				throw new Error(`invalid loading progress timestamp for ${runtimeLabel}`);
			}
			previousTimestamp = entry.at;
		}
		if (!['determinate', 'indeterminate', 'hidden'].includes(mode)) {
			throw new Error(`invalid loading progress for ${runtimeLabel}`);
		}
		if (mode === 'hidden') {
			if (entry.value !== null) {
				throw new Error(`invalid loading progress for ${runtimeLabel}`);
			}
			continue;
		}
		if (
			!entry.label ||
			(mode === 'determinate' &&
				(!Number.isFinite(entry.value) ||
					entry.value < 0 ||
					entry.value > 100 ||
					entry.value < previousValue))
		) {
			throw new Error(`invalid loading progress for ${runtimeLabel}`);
		}
		if (mode === 'determinate') previousValue = /** @type {number} */ (entry.value);
	}
	if (
		!trace.some(
			(entry) =>
				entry.mode === 'indeterminate' ||
				(typeof entry.value === 'number' && entry.value > 0)
		)
	) {
		throw new Error(`loading progress never advanced for ${runtimeLabel}`);
	}

	const hiddenEntries = trace.filter((entry) => entry.mode === 'hidden');
	if (hiddenEntries.length !== 1 || trace.at(-1)?.mode !== 'hidden') {
		throw new Error(`loading progress did not complete for ${runtimeLabel}`);
	}

	if (hasTimestamps) {
		for (let index = 0; index < trace.length - 1; index += 1) {
			const entry = trace[index];
			if ((entry.mode || 'determinate') !== 'determinate') continue;
			let endIndex = index + 1;
			while (
				endIndex < trace.length - 1 &&
				(trace[endIndex].mode || 'determinate') === 'determinate' &&
				trace[endIndex].value === entry.value
			) {
				endIndex += 1;
			}
			const elapsed =
				/** @type {number} */ (trace[endIndex].at) - /** @type {number} */ (entry.at);
			if (elapsed > MAX_DETERMINATE_PROGRESS_PLATEAU_MS) {
				throw new Error(
					`determinate loading progress stalled at ${entry.value}% for ${runtimeLabel}`
				);
			}
			index = endIndex - 1;
		}
	}
}
