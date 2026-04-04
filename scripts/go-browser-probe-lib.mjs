import { chromium } from 'playwright-core';

import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

/**
 * @typedef {{ type: string; text: string }} BrowserConsoleMessage
 */

/**
 * @param {BrowserConsoleMessage[]} messages
 */
function summarizeConsole(messages) {
	return messages.slice(-160).map((message) => `[${message.type}] ${message.text}`);
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
 * @param {BrowserConsoleMessage[]} messages
 */
function findModuleResolutionErrors(messages) {
	return messages
		.filter(
			(entry) =>
				entry.type === 'error' &&
				(entry.text.includes('Failed to resolve module specifier') ||
					entry.text.includes('@bjorn3/browser_wasi_shim'))
		)
		.map((entry) => `[${entry.type}] ${entry.text}`);
}

/**
 * @param {BrowserConsoleMessage[]} messages
 */
function findGoConsoleErrors(messages) {
	return messages
		.filter(
			(entry) =>
				entry.type === 'error' &&
				(entry.text.includes('[wasm-idle:go-worker]') ||
					entry.text.includes('Go worker script error:'))
		)
		.map((entry) => `[${entry.type}] ${entry.text}`);
}

/**
 * @param {import('playwright-core').Page} page
 * @param {{ crossOriginIsolated: boolean; sharedArrayBuffer: boolean; serviceWorkerControlled: boolean }} activeState
 * @param {string[]} pageErrors
 * @param {BrowserConsoleMessage[]} consoleMessages
 * @param {string} browserUrl
 */
async function readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl) {
	const transcript =
		(await page.locator('[data-testid="terminal-debug-output"]').textContent().catch(() => '')) || '';
	const availableGoTargets = await page
		.locator('#go-target option')
		.evaluateAll((elements) =>
			elements
				.map((element) => element.getAttribute('value') || '')
				.filter((value) => value.length > 0)
		)
		.catch(() => []);
	const selectedGoTarget =
		(await page.locator('#go-target').inputValue().catch(() => '')) || '';
	return {
		activeState,
		availableGoTargets,
		browserUrl,
		consoleTail: summarizeConsole(consoleMessages),
		finalUrl: page.url(),
		goConsoleErrors: findGoConsoleErrors(consoleMessages),
		moduleResolutionErrors: findModuleResolutionErrors(consoleMessages),
		pageErrors,
		selectedGoTarget,
		title: await page.title().catch(() => ''),
		transcript
	};
}

/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput?: string; runTimeoutMs?: number; stdinText?: string; target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' }} options
 */
export async function runGoBrowserProbe({
	browserUrl,
	chromiumExecutable = '',
	expectedOutput = 'factorial_plus_bonus=123',
	runTimeoutMs = 300_000,
	stdinText = '5\n',
	target = 'wasip1/wasm'
}) {
	if (!browserUrl) {
		throw new Error('runGoBrowserProbe requires a browserUrl');
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
					// Ignore readiness errors and retry with a fresh navigation.
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
				`page is not ready for wasm-idle Go\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl), null, 2)}`
			);
		}

		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1_000);
		await page.waitForSelector('select', { state: 'attached', timeout: runTimeoutMs });
		await page.locator('select').selectOption('GO');
		await page.locator('#go-target').selectOption(target);

		const logToggle = page.locator('#log-toggle');
		if (!(await logToggle.isChecked())) {
			await logToggle.check();
		}

		await page.waitForSelector('[data-testid="terminal-debug-output"]', { state: 'attached' });
		const initialTranscript =
			(await page.locator('[data-testid="terminal-debug-output"]').textContent().catch(() => '')) || '';
		await page.locator('button.action-button--run').first().click();
		try {
			await page.waitForFunction(
				(previousTranscript) => {
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')?.textContent || '';
					if (text === previousTranscript) {
						return false;
					}
					return text.includes('Go compilation failed') || text.includes('Process finished after');
				},
				initialTranscript,
				{
					polling: 250,
					timeout: runTimeoutMs
				}
			);
		} catch (error) {
			throw new Error(
				`Go browser probe timed out waiting for the prepare phase\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl), null, 2)}`,
				{ cause: error }
			);
		}
		const prepareTranscript =
			(await page.locator('[data-testid="terminal-debug-output"]').textContent().catch(() => '')) || '';
		const prepareFinishedCount = (prepareTranscript.match(/Process finished after/g) || []).length;
		await page.waitForFunction(
			() => typeof /** @type {any} */ (window).__wasmIdleDebug?.writeTerminalInput === 'function'
		);
		await page.evaluate(async (text) => {
			await /** @type {any} */ (window).__wasmIdleDebug.writeTerminalInput(text, false);
		}, stdinText);

		try {
			await page.waitForFunction(
				({ previousTranscript, previousFinishedCount, requiredOutput }) => {
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')?.textContent || '';
					if (text === previousTranscript) {
						return false;
					}
					const finishedCount = (text.match(/Process finished after/g) || []).length;
					return (
						text.includes(requiredOutput) ||
						text.includes('Go compilation failed') ||
						finishedCount >= previousFinishedCount + 1
					);
				},
				{
					previousTranscript: prepareTranscript,
					previousFinishedCount: prepareFinishedCount,
					requiredOutput: expectedOutput
				},
				{
					polling: 250,
					timeout: runTimeoutMs
				}
			);
		} catch (error) {
			throw new Error(
				`Go browser probe timed out waiting for the execution phase\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl), null, 2)}`,
				{ cause: error }
			);
		}

		const summary = await readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl);
		if (summary.pageErrors.length > 0) {
			throw new Error(`page errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.moduleResolutionErrors.length > 0) {
			throw new Error(`module resolution errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.goConsoleErrors.length > 0) {
			throw new Error(`go console errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.transcript.includes('Go compilation failed')) {
			throw new Error(`Go run failed\n${JSON.stringify(summary, null, 2)}`);
		}
		if (!summary.transcript.includes(expectedOutput)) {
			throw new Error(
				`terminal transcript did not contain expected Go output ${JSON.stringify(expectedOutput)}\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (summary.selectedGoTarget !== target) {
			throw new Error(
				`go target selector did not retain ${target}\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (
			!summary.transcript.includes('Process finished after') &&
			!summary.consoleTail.some((entry) =>
				entry.includes('[wasm-idle:go-worker] wasi run complete exitCode=0')
			)
		) {
			throw new Error(`Go run did not finish cleanly\n${JSON.stringify(summary, null, 2)}`);
		}
		return summary;
	} finally {
		await page.close().catch(() => {});
		await context.close().catch(() => {});
		await browser.close().catch(() => {});
	}
}
