/**
 * Disable speculative runtime work through the public Save-Data policy while
 * leaving requestIdleCallback available to Monaco and other browser code.
 * @param {{ addInitScript: (script: () => void) => Promise<unknown> }} context
 */
export async function disableBrowserPrewarm(context) {
	await context.addInitScript(() => {
		const connection = navigator.connection;
		if (connection) {
			Object.defineProperty(connection, 'saveData', { configurable: true, value: true });
			return;
		}
		Object.defineProperty(navigator, 'connection', {
			configurable: true,
			value: { saveData: true }
		});
	});
}
