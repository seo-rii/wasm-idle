/**
 * These predicates are serialized by Playwright into the page. Keep them self-contained:
 * no captured module state, elapsed-time guesses, or changes to application state.
 */
export function editorWorkspaceReady() {
	const select = /** @type {HTMLSelectElement | null} */ (
		document.querySelector('#language-select')
	);
	const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
	return Boolean(
		select &&
			select.dataset.workspaceReady === 'true' &&
			!select.disabled &&
			editor?.getModel?.()?.uri
	);
}

/** @param {{ language: string, fileName: string }} expected */
export function selectedEditorModelReady(expected) {
	const select = /** @type {HTMLSelectElement | null} */ (
		document.querySelector('#language-select')
	);
	const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
	const model = editor?.getModel?.();
	return Boolean(
		select &&
			select.dataset.workspaceReady === 'true' &&
			!select.disabled &&
			select.value === expected.language &&
			model &&
			String(model.uri) === `file:///workspace/${expected.fileName}`
	);
}

/** @param {import('playwright-core').Page} page */
export async function waitForEditorWorkspace(page) {
	await page.waitForFunction(editorWorkspaceReady);
}

/**
 * Observe the selected language and active model in the same page evaluation.
 * Separate waits can accept a transient tab before workspace restoration replaces it.
 * @param {import('playwright-core').Page} page
 * @param {string} language
 * @param {string} fileName
 */
export async function waitForSelectedEditorModel(page, language, fileName) {
	await page.waitForFunction(selectedEditorModelReady, { language, fileName });
}
