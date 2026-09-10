import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { chromium } from 'playwright-core';

import {
	assertLoadingProgressTrace,
	installLoadingProgressProbe,
	markLoadingProgressReady,
	readLoadingProgressTrace,
	stopLoadingProgressProbe
} from './browser-progress-probe.mjs';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { classifyTerminalRun } from './stdin-browser-probe-lib.mjs';

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
 * @param {import('playwright-core').Page} page
 * @param {{ crossOriginIsolated: boolean; sharedArrayBuffer: boolean; serviceWorkerControlled: boolean }} activeState
 * @param {string[]} pageErrors
 * @param {BrowserConsoleMessage[]} consoleMessages
 * @param {string} browserUrl
 */
async function readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl) {
	const transcript =
		(await page
			.locator('[data-testid="terminal-debug-output"]')
			.textContent()
			.catch(() => '')) || '';
	const progressTrace = await readLoadingProgressTrace(page);
	const executionState = await page.evaluate(
		() => /** @type {any} */ (window).__wasmIdleDebug?.getExecutionState?.() ?? null
	);
	return {
		activeState,
		browserUrl,
		consoleTail: summarizeConsole(consoleMessages),
		finalUrl: page.url(),
		pageErrors,
		progressTrace,
		executionState,
		title: await page.title().catch(() => ''),
		transcript
	};
}

/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput?: string; runTimeoutMs?: number; stdinText?: string }} options
 */
export async function runTinyGoBrowserProbe({
	browserUrl,
	chromiumExecutable = '',
	expectedOutput = 'fibonacci=11',
	runTimeoutMs = 300_000,
	stdinText = '5\n'
}) {
	if (!browserUrl) {
		throw new Error('runTinyGoBrowserProbe requires a browserUrl');
	}

	const executablePath = await resolveChromiumExecutable(chromiumExecutable);
	const browser = await chromium.launch({
		headless: true,
		executablePath
	});
	const context = await browser.newContext();
	const resolvedBrowserUrl = new URL(browserUrl);
	await addBrowserTestCookies(context, browserUrl);
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
		await page.goto(resolvedBrowserUrl.toString(), { waitUntil: 'domcontentloaded' });
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
			await page.goto(resolvedBrowserUrl.toString(), { waitUntil: 'domcontentloaded' });
			await page.waitForTimeout(2_500 + attempt * 500);
			activeState = await readActiveState(page);
		}
		if (
			!activeState.crossOriginIsolated ||
			!activeState.sharedArrayBuffer ||
			!activeState.serviceWorkerControlled
		) {
			throw new Error(
				`page is not ready for wasm-idle TinyGo\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, resolvedBrowserUrl.toString()), null, 2)}`
			);
		}

		await page.goto(resolvedBrowserUrl.toString(), { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1_000);
		await page.waitForSelector('#language-select', {
			state: 'attached',
			timeout: runTimeoutMs
		});
		await page.locator('#language-select').selectOption('TINYGO');
		await page.waitForFunction(() => {
			const debug = /** @type {any} */ (window).__wasmIdleDebug;
			const source = debug?.getEditorValue?.() ?? '';
			return (
				source.includes('package main') &&
				source.includes('fibonacci=') &&
				typeof debug?.getExecutionState === 'function'
			);
		});

		const logToggle = page.locator('#log-toggle');
		if (!(await logToggle.isChecked())) {
			await logToggle.check();
		}
		await page.waitForSelector('[data-testid="terminal-debug-output"]', { state: 'attached' });
		const initialTranscript =
			(await page
				.locator('[data-testid="terminal-debug-output"]')
				.textContent()
				.catch(() => '')) || '';
		const previousRunId = await page.evaluate(
			() => /** @type {any} */ (window).__wasmIdleDebug.getExecutionState().id
		);
		await installLoadingProgressProbe(page);
		await page.locator('button.action-button--run').first().click();
		try {
			await page.waitForFunction(
				({ previousTranscript, previousId }) => {
					const state = /** @type {any} */ (
						window
					).__wasmIdleDebug?.getExecutionState?.();
					if (!state || state.id <= previousId) return false;
					if (state.endedAt !== null) return true;
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent || '';
					const delta = text.startsWith(previousTranscript)
						? text.slice(previousTranscript.length)
						: text;
					return (
						delta.includes('upstream TinyGo artifact ready:') &&
						!['idle', 'preparing'].includes(state.status)
					);
				},
				{ previousTranscript: initialTranscript, previousId: previousRunId },
				{ polling: 50, timeout: runTimeoutMs }
			);
		} catch (error) {
			throw new Error(
				`TinyGo browser probe timed out waiting for the prepare phase\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, resolvedBrowserUrl.toString()), null, 2)}`,
				{ cause: error }
			);
		}
		const prepareTranscript =
			(await page
				.locator('[data-testid="terminal-debug-output"]')
				.textContent()
				.catch(() => '')) || '';
		const prepareState = await page.evaluate(() =>
			/** @type {any} */ (window).__wasmIdleDebug.getExecutionState()
		);
		if (prepareState.endedAt !== null) {
			throw new Error(
				`TinyGo execution ended before accepting input\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, resolvedBrowserUrl.toString()), null, 2)}`
			);
		}
		await page.evaluate(async (text) => {
			await /** @type {any} */ (window).__wasmIdleDebug.writeTerminalInput(text, false);
		}, stdinText);

		let progressReadiness;
		try {
			const readinessHandle = await page.waitForFunction(
				({ previousTranscript, requiredOutput, previousId }) => {
					const state = /** @type {any} */ (
						window
					).__wasmIdleDebug?.getExecutionState?.();
					if (!state || state.id <= previousId) return false;
					if (state.endedAt !== null) return 'TinyGo execution settled';
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent || '';
					const delta = text.startsWith(previousTranscript)
						? text.slice(previousTranscript.length)
						: text;
					return requiredOutput && delta.includes(requiredOutput)
						? 'expected terminal output'
						: false;
				},
				{
					previousTranscript: prepareTranscript,
					requiredOutput: expectedOutput,
					previousId: previousRunId
				},
				{ polling: 50, timeout: runTimeoutMs }
			);
			const readinessReason = String(await readinessHandle.jsonValue());
			await readinessHandle.dispose();
			progressReadiness = await markLoadingProgressReady(page, readinessReason);
			await page.waitForFunction(
				(previousId) => {
					const state = /** @type {any} */ (
						window
					).__wasmIdleDebug?.getExecutionState?.();
					return state && state.id > previousId && state.endedAt !== null;
				},
				previousRunId,
				{ polling: 50, timeout: runTimeoutMs }
			);
		} catch (error) {
			throw new Error(
				`TinyGo browser probe timed out waiting for the execution phase\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, resolvedBrowserUrl.toString()), null, 2)}`,
				{ cause: error }
			);
		}

		await stopLoadingProgressProbe(page);
		const summary = {
			...(await readProbeSummary(
				page,
				activeState,
				pageErrors,
				consoleMessages,
				resolvedBrowserUrl.toString()
			)),
			progressReadiness
		};
		if (summary.pageErrors.length > 0) {
			throw new Error(`page errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		assertLoadingProgressTrace(summary.progressTrace, 'TinyGo', progressReadiness);
		if (
			classifyTerminalRun(
				initialTranscript,
				summary.transcript,
				expectedOutput,
				summary.executionState,
				previousRunId
			) !== 'success'
		) {
			throw new Error(
				`TinyGo execution did not complete successfully with the expected output\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (
			!summary.consoleTail.some((entry) =>
				entry.includes('[wasm-idle:tinygo-worker] wasi run complete exitCode=0')
			)
		) {
			throw new Error(
				`browser probe did not observe a successful TinyGo worker completion log\n${JSON.stringify(summary, null, 2)}`
			);
		}

		return summary;
	} finally {
		await browser.close();
	}
}
