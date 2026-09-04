/**
 * @typedef {'aria-label' | 'aria-valuenow' | 'data-progress-mode' | 'snapshot' | 'visibility'} LoadingProgressObservation
 */

/**
 * @typedef {{
 *   label: string;
 *   value: number | null;
 *   mode?: 'determinate' | 'indeterminate' | 'hidden';
 *   at?: number;
 *   observed?: LoadingProgressObservation[];
 * }} LoadingProgressEntry
 */

/**
 * @typedef {{ at: number; reason: string }} LoadingProgressReadiness
 */

const VALID_OBSERVATIONS = new Set([
	'aria-label',
	'aria-valuenow',
	'data-progress-mode',
	'snapshot',
	'visibility'
]);

/**
 * @param {import('playwright-core').Page} page
 */
export async function installLoadingProgressProbe(page) {
	await page.evaluate(() => {
		const target = /** @type {any} */ (globalThis);
		target.__wasmIdleProgressTrace = [];
		target.__wasmIdleProgressObserver?.disconnect?.();

		/**
		 * @param {MutationRecord[]} mutations
		 * @param {boolean} snapshot
		 */
		const record = (mutations = [], snapshot = false) => {
			const observations = new Set();
			if (snapshot) observations.add('snapshot');
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					observations.add('visibility');
				} else if (mutation.attributeName) {
					observations.add(mutation.attributeName);
				}
			}

			const progressBar = document.querySelector('.progress-track[role="progressbar"]');
			const trace = target.__wasmIdleProgressTrace;
			const previous = trace[trace.length - 1];
			const at = performance.now();
			if (!progressBar) {
				if (previous && previous.mode !== 'hidden') {
					trace.push({
						label: previous.label,
						value: null,
						mode: 'hidden',
						at,
						observed: [...observations]
					});
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
				trace.push({ label, value, mode, at, observed: [...observations] });
			}
		};
		const observer = new MutationObserver((mutations) => record(mutations, false));
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ['aria-label', 'aria-valuenow', 'data-progress-mode'],
			childList: true,
			subtree: true
		});
		target.__wasmIdleProgressObserver = observer;
		target.__wasmIdleProgressRecord = () => record([], true);
		record([], true);
	});
}

/**
 * Records the first point at which the probe has independently observed that the
 * program is useful to the user (for example, expected output or a settled run).
 * It intentionally does not infer readiness from a progress percentage.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} reason
 * @returns {Promise<LoadingProgressReadiness>}
 */
export async function markLoadingProgressReady(page, reason) {
	return await page.evaluate(
		(readyReason) => ({ at: performance.now(), reason: readyReason }),
		reason
	);
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
 * @param {LoadingProgressReadiness | null} [readiness]
 */
export function assertLoadingProgressTrace(trace, runtimeLabel, readiness = null) {
	if (trace.length === 0) {
		throw new Error(`loading progress was never rendered for ${runtimeLabel}`);
	}
	const hasTimestamps = trace.some((entry) => entry.at !== undefined);
	const hasObservations = trace.some((entry) => entry.observed !== undefined);
	let previousTimestamp = -1;
	/** @type {LoadingProgressEntry | undefined} */
	let previousVisible;

	for (const entry of trace) {
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
		if (hasObservations) {
			if (
				!Array.isArray(entry.observed) ||
				entry.observed.length === 0 ||
				entry.observed.some((observation) => !VALID_OBSERVATIONS.has(observation))
			) {
				throw new Error(`loading progress change was not observed for ${runtimeLabel}`);
			}
		}
		if (!['determinate', 'indeterminate', 'hidden'].includes(mode)) {
			throw new Error(`invalid loading progress for ${runtimeLabel}`);
		}
		if (mode === 'hidden') {
			if (entry.value !== null) {
				throw new Error(`invalid loading progress for ${runtimeLabel}`);
			}
			previousVisible = undefined;
			continue;
		}
		if (!entry.label || (mode === 'indeterminate' && entry.value !== null)) {
			throw new Error(`invalid loading progress for ${runtimeLabel}`);
		}
		if (mode === 'determinate') {
			if (
				typeof entry.value !== 'number' ||
				!Number.isFinite(entry.value) ||
				entry.value < 0 ||
				entry.value > 100
			) {
				throw new Error(`invalid loading progress for ${runtimeLabel}`);
			}
			if (
				previousVisible &&
				(previousVisible.mode || 'determinate') === 'determinate' &&
				previousVisible.label === entry.label &&
				typeof previousVisible.value === 'number' &&
				entry.value < previousVisible.value
			) {
				throw new Error(`invalid loading progress for ${runtimeLabel}`);
			}
			if (
				hasObservations &&
				previousVisible &&
				((previousVisible.mode || 'determinate') !== 'determinate' ||
					entry.value !== previousVisible.value) &&
				!entry.observed?.some(
					(observation) => observation === 'aria-valuenow' || observation === 'visibility'
				)
			) {
				throw new Error(
					`determinate progress moved without an observed event for ${runtimeLabel}`
				);
			}
		}
		previousVisible = entry;
	}

	const hiddenEntries = trace.filter((entry) => entry.mode === 'hidden');
	if (hiddenEntries.length !== 1 || trace.at(-1)?.mode !== 'hidden') {
		throw new Error(`loading progress did not become hidden for ${runtimeLabel}`);
	}

	if (readiness) {
		if (!Number.isFinite(readiness.at) || !readiness.reason) {
			throw new Error(`invalid loading readiness observation for ${runtimeLabel}`);
		}
		const hiddenAt = hiddenEntries[0].at;
		if (typeof hiddenAt !== 'number' || hiddenAt > readiness.at) {
			throw new Error(
				`loading progress remained visible after ${readiness.reason} for ${runtimeLabel}`
			);
		}
	}
}
