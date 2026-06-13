import { chromium } from 'playwright-core';

import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

/**
 * @typedef {{ type: string; text: string }} BrowserConsoleMessage
 */

/**
 * @param {BrowserConsoleMessage[]} messages
 */
function summarizeConsole(messages) {
	return messages.slice(-120).map((message) => `[${message.type}] ${message.text}`);
}

/**
 * @param {string[]} pageErrors
 */
function filterBenignPageErrors(pageErrors) {
	return pageErrors.filter(
		(entry) =>
			!entry.includes('Missing requestHandler or method: getSyntacticDiagnostics') &&
			!entry.includes('Missing requestHandler or method: provideInlayHints') &&
			!entry.includes('Missing requestHandler or method: getCodeFixesAtPosition') &&
			!entry.includes('Missing requestHandler or method: getNavigationTree')
	);
}

/**
 * @param {import('playwright-core').Page} page
 */
async function readActiveState(page) {
	return await page.evaluate(() => ({
		crossOriginIsolated,
		sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
		serviceWorkerControlled: !!navigator.serviceWorker?.controller
	}));
}

/**
 * @param {import('playwright-core').Page} page
 * @param {{ crossOriginIsolated: boolean; sharedArrayBuffer: boolean; serviceWorkerControlled: boolean }} activeState
 * @param {string[]} pageErrors
 * @param {BrowserConsoleMessage[]} consoleMessages
 */
async function readProbeSummary(page, activeState, pageErrors, consoleMessages) {
	const transcript =
		(await page.locator('[data-testid="terminal-debug-output"]').textContent().catch(() => '')) ||
		'';
	return {
		activeState,
		consoleTail: summarizeConsole(consoleMessages),
		finalUrl: page.url(),
		language: (await page.locator('select').first().inputValue().catch(() => '')) || '',
		pageErrors,
		title: await page.title().catch(() => ''),
		transcript
	};
}

/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput: string; language: 'ASSEMBLYSCRIPT' | 'WAT'; runTimeoutMs?: number; source: string; stdinText: string }} options
 */
export async function runStdinBrowserProbe({
	browserUrl,
	chromiumExecutable = '',
	expectedOutput,
	language,
	runTimeoutMs = 120_000,
	source,
	stdinText
}) {
	if (!browserUrl) {
		throw new Error('runStdinBrowserProbe requires a browserUrl');
	}
	const executablePath = await resolveChromiumExecutable(chromiumExecutable);
	const browser = await chromium.launch({
		headless: true,
		executablePath
	});
	const context = await browser.newContext();
	await context.addCookies([
		{
			name: 'dev_bypass_waf',
			value: 'seorii_bypass_token_is_this',
			url: new URL(browserUrl).origin
		}
	]);
	await context.setExtraHTTPHeaders({
		Cookie: 'dev_bypass_waf=seorii_bypass_token_is_this'
	});
	const page = await context.newPage();
	page.setDefaultTimeout(runTimeoutMs);

	/** @type {BrowserConsoleMessage[]} */
	const consoleMessages = [];
	/** @type {string[]} */
	const pageErrors = [];
	page.on('console', (message) => {
		consoleMessages.push({
			type: message.type(),
			text: message.text()
		});
	});
	page.on('pageerror', (error) => {
		pageErrors.push(String(error.stack || error.message || error));
	});

	try {
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(2_000);

		let activeState = await readActiveState(page);
		for (let attempt = 0; attempt < 4; attempt += 1) {
			if (
				activeState.crossOriginIsolated &&
				activeState.sharedArrayBuffer &&
				activeState.serviceWorkerControlled
			) {
				break;
			}
			await page.evaluate(async () => {
				if (!navigator.serviceWorker) return;
				try {
					await Promise.race([
						navigator.serviceWorker.ready,
						new Promise((resolve) => setTimeout(resolve, 1_500))
					]);
				} catch {
					// Retry with a fresh navigation below.
				}
			});
			await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
			await page.waitForTimeout(2_500 + attempt * 500);
			activeState = await readActiveState(page);
		}
		if (
			!activeState.crossOriginIsolated ||
			!activeState.sharedArrayBuffer ||
			!activeState.serviceWorkerControlled
		) {
			throw new Error(
				`page is not ready for stdin browser probe\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`
			);
		}

		await page.evaluate(() => localStorage.clear());
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('select', { state: 'attached', timeout: runTimeoutMs });
		await page.locator('select').selectOption(language);
		await page.waitForFunction(
			(expectedLanguage) =>
				document.querySelector('select')?.value === expectedLanguage &&
				typeof window.__wasmIdleDebug?.getEditorValue === 'function' &&
				typeof window.__wasmIdleDebug?.setEditorValue === 'function' &&
				typeof window.__wasmIdleDebug?.writeTerminalInput === 'function',
			language,
			{ timeout: runTimeoutMs }
		);
		await page.waitForTimeout(500);
		let editorValueStable = false;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const editorValueSet = await page.evaluate(async (text) => {
				return await window.__wasmIdleDebug.setEditorValue(text);
			}, source);
			if (!editorValueSet) {
				throw new Error(
					`stdin browser probe could not write editor contents\n${JSON.stringify(
						await readProbeSummary(page, activeState, pageErrors, consoleMessages),
						null,
						2
					)}`
				);
			}
			await page.waitForFunction(
				(expectedSource) => window.__wasmIdleDebug?.getEditorValue?.() === expectedSource,
				source,
				{
					polling: 100,
					timeout: runTimeoutMs
				}
			);
			await page.waitForTimeout(250);
			editorValueStable = await page.evaluate(
				(expectedSource) => window.__wasmIdleDebug?.getEditorValue?.() === expectedSource,
				source
			);
			if (editorValueStable) {
				break;
			}
		}
		if (!editorValueStable) {
			throw new Error(
				`stdin browser probe editor contents were overwritten\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`
			);
		}
		await page.waitForSelector('[data-testid="terminal-debug-output"]', { state: 'attached' });
		const initialTranscript =
			(await page.locator('[data-testid="terminal-debug-output"]').textContent().catch(() => '')) ||
			'';
		const editorValueBeforeRun = await page.evaluate(
			(expectedSource) => window.__wasmIdleDebug?.getEditorValue?.() === expectedSource,
			source
		);
		if (!editorValueBeforeRun) {
			throw new Error(
				`stdin browser probe editor contents changed before run\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`
			);
		}
		await page.evaluate(() => document.querySelector('button.action-button--run')?.click());
		await page.evaluate(async (text) => {
			await window.__wasmIdleDebug.writeTerminalInput(text, false);
		}, stdinText);

		try {
			await page.waitForFunction(
				({ previousTranscript, requiredOutput }) => {
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')?.textContent || '';
					return text !== previousTranscript && text.includes(requiredOutput);
				},
				{
					previousTranscript: initialTranscript,
					requiredOutput: expectedOutput
				},
				{
					polling: 250,
					timeout: runTimeoutMs
				}
			);
		} catch (error) {
			throw new Error(
				`stdin browser probe timed out waiting for ${language} output\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`,
				{ cause: error }
			);
		}

		const summary = await readProbeSummary(page, activeState, pageErrors, consoleMessages);
		const relevantPageErrors = filterBenignPageErrors(summary.pageErrors);
		if (relevantPageErrors.length > 0) {
			throw new Error(`page errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.language !== language) {
			throw new Error(
				`language selector did not retain ${language}\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (!summary.transcript.includes(expectedOutput)) {
			throw new Error(
				`terminal transcript did not contain ${JSON.stringify(expectedOutput)}\n${JSON.stringify(
					summary,
					null,
					2
				)}`
			);
		}
		if (!summary.transcript.includes('Process finished after')) {
			throw new Error(`stdin browser run did not finish\n${JSON.stringify(summary, null, 2)}`);
		}
		return summary;
	} finally {
		await page.close().catch(() => {});
		await context.close().catch(() => {});
		await browser.close().catch(() => {});
	}
}
