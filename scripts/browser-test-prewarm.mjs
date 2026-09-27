/**
 * Keep speculative work queued until a browser test's foreground load claims it.
 * This preserves cold-path request assertions while exercising prewarm handoff.
 * @param {{ addInitScript: (script: () => void) => Promise<unknown> }} context
 */
export async function deferBrowserPrewarm(context) {
	await context.addInitScript(() => {
		let nextIdleCallbackId = 0;
		/** @type {Set<number>} */
		const pendingIdleCallbacks = new Set();
		Object.defineProperty(window, 'requestIdleCallback', {
			configurable: true,
			value: () => {
				const id = ++nextIdleCallbackId;
				pendingIdleCallbacks.add(id);
				return id;
			}
		});
		Object.defineProperty(window, 'cancelIdleCallback', {
			configurable: true,
			value: (/** @type {number} */ id) => {
				pendingIdleCallbacks.delete(id);
			}
		});
	});
}
