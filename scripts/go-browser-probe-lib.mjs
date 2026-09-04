import { chromium } from 'playwright-core';

import {
	assertLoadingProgressTrace,
	installLoadingProgressProbe,
	markLoadingProgressReady,
	readLoadingProgressTrace,
	stopLoadingProgressProbe
} from './browser-progress-probe.mjs';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

export const DEFAULT_GO_BROWSER_EXPECTED_OUTPUT = 'fibonacci=11';

const GO_EDITOR_STABLE_READS = 3;
const GO_EDITOR_POLL_INTERVAL_MS = 100;

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
 * @param {{ editorApiReady: boolean; language: string; source: string }} state
 */
export function isGoEditorStateReady({ editorApiReady, language, source }) {
	return editorApiReady && language === 'GO' && /^\s*package\s+main\b/mu.test(source);
}

/**
 * @param {unknown} error
 */
function isTransientNavigationError(error) {
	const message = String(error);
	return (
		message.includes('Execution context was destroyed') ||
		message.includes('Cannot find context with specified id')
	);
}

/**
 * Wait until selecting Go has propagated through the async editor state. A single
 * non-empty read is insufficient because the previous language's source can still
 * be replaced on a later Svelte update.
 *
 * @param {import('playwright-core').Page} page
 * @param {number} timeoutMs
 */
export async function waitForStableGoEditorSource(page, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let previousSource = '';
	let selectionRecovered = false;
	let stableReads = 0;

	while (Date.now() < deadline) {
		let state;
		try {
			state = await page.evaluate(() => {
				const api = /** @type {any} */ (window).__wasmIdleDebug;
				const editorApiReady =
					typeof api?.getEditorValue === 'function' &&
					typeof api?.setEditorValue === 'function';
				return {
					editorApiReady,
					language: document.querySelector('#language-select')?.value || '',
					source: editorApiReady ? String(api.getEditorValue() || '') : ''
				};
			});
		} catch (error) {
			if (!isTransientNavigationError(error)) throw error;
			previousSource = '';
			selectionRecovered = false;
			stableReads = 0;
			await page.waitForTimeout(GO_EDITOR_POLL_INTERVAL_MS);
			continue;
		}

		if (isGoEditorStateReady(state)) {
			stableReads = state.source === previousSource ? stableReads + 1 : 1;
			previousSource = state.source;
			if (stableReads >= GO_EDITOR_STABLE_READS) {
				return state.source;
			}
		} else {
			previousSource = '';
			stableReads = 0;
			if (state.editorApiReady && !selectionRecovered) {
				await page.locator('#language-select').selectOption('GO', {
					timeout: Math.max(1, Math.min(1_000, deadline - Date.now()))
				});
				selectionRecovered = true;
			}
		}

		await page.waitForTimeout(GO_EDITOR_POLL_INTERVAL_MS);
	}

	throw new Error(`timed out after ${timeoutMs}ms waiting for stable Go editor source`);
}

/**
 * @param {import('playwright-core').Page} page
 * @param {BrowserConsoleMessage[]} messages
 * @param {(message: BrowserConsoleMessage) => boolean} predicate
 * @param {number} timeoutMs
 */
async function waitForConsoleMessage(page, messages, predicate, timeoutMs) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (messages.some(predicate)) return;
		await page.waitForTimeout(100);
	}
	throw new Error('timed out waiting for Go browser console message');
}

/**
 * @param {{ previousTranscript: string; previousFinishedCount: number }} options
 */
export function hasGoExecutionPhaseCompleted({ previousTranscript, previousFinishedCount }) {
	const text = document.querySelector('[data-testid="terminal-debug-output"]')?.textContent || '';
	if (text === previousTranscript) {
		return false;
	}
	const finishedCount = (text.match(/Process finished after/g) || []).length;
	return text.includes('Go compilation failed') || finishedCount >= previousFinishedCount + 1;
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
	const availableGoTargets = await page
		.locator('#go-target option')
		.evaluateAll((elements) =>
			elements
				.map((element) => element.getAttribute('value') || '')
				.filter((value) => value.length > 0)
		)
		.catch(() => []);
	const selectedGoTarget =
		(await page
			.locator('#go-target')
			.inputValue()
			.catch(() => '')) || '';
	const progressTrace = await readLoadingProgressTrace(page);
	return {
		activeState,
		availableGoTargets,
		browserUrl,
		consoleTail: summarizeConsole(consoleMessages),
		finalUrl: page.url(),
		goConsoleErrors: findGoConsoleErrors(consoleMessages),
		moduleResolutionErrors: findModuleResolutionErrors(consoleMessages),
		pageErrors,
		progressTrace,
		selectedGoTarget,
		title: await page.title().catch(() => ''),
		transcript
	};
}

/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput?: string; runTimeoutMs?: number; stdinText?: string; target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm'; stdinMethod?: 'debug-hook' | 'keyboard' }} options
 */
export async function runGoBrowserProbe({
	browserUrl,
	chromiumExecutable = '',
	expectedOutput = DEFAULT_GO_BROWSER_EXPECTED_OUTPUT,
	runTimeoutMs = 300_000,
	stdinText = '5\n',
	target = 'wasip1/wasm',
	stdinMethod = 'debug-hook'
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

		await page.evaluate(() => localStorage.clear());
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('#language-select', {
			state: 'attached',
			timeout: runTimeoutMs
		});
		await page.locator('#language-select').selectOption('GO');
		const editorReadyTimeoutMs = Math.min(runTimeoutMs, 30_000);
		try {
			await waitForStableGoEditorSource(page, editorReadyTimeoutMs);
		} catch (error) {
			throw new Error(
				`Go editor did not become ready within ${editorReadyTimeoutMs}ms\n${JSON.stringify(
					{
						activeState,
						browserUrl,
						consoleTail: summarizeConsole(consoleMessages),
						finalUrl: page.url(),
						pageErrors
					},
					null,
					2
				)}`,
				{ cause: error }
			);
		}
		await page.locator('#go-target').selectOption(target);

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
		const initialFinishedCount = (initialTranscript.match(/Process finished after/g) || [])
			.length;
		await installLoadingProgressProbe(page);
		await page.locator('button.action-button--run').first().click();
		if (stdinMethod === 'keyboard') {
			await waitForConsoleMessage(
				page,
				consoleMessages,
				(message) =>
					message.text.includes(`[wasm-idle:go-worker] runtime start target=${target}`),
				runTimeoutMs
			);
			const normalizedInput = stdinText.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
			await page.locator('.xterm').click();
			const segments = normalizedInput.split('\n');
			for (let index = 0; index < segments.length; index += 1) {
				if (segments[index]) {
					await page.keyboard.type(segments[index]);
				}
				if (index < segments.length - 1) {
					await page.keyboard.press('Enter');
				}
			}
		} else {
			await page.waitForFunction(
				() =>
					typeof (/** @type {any} */ (window).__wasmIdleDebug?.writeTerminalInput) ===
					'function'
			);
			await page.evaluate(async (text) => {
				await /** @type {any} */ (window).__wasmIdleDebug.writeTerminalInput(text, false);
			}, stdinText);
		}

		let progressReadiness;
		try {
			const readinessHandle = await page.waitForFunction(
				({ previousTranscript, previousFinishedCount, requiredOutput }) => {
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent || '';
					const delta = text.startsWith(previousTranscript)
						? text.slice(previousTranscript.length)
						: text;
					if (requiredOutput && delta.includes(requiredOutput)) {
						return 'expected terminal output';
					}
					const finishedCount = (text.match(/Process finished after/g) || []).length;
					if (
						delta.includes('Go compilation failed') ||
						finishedCount >= previousFinishedCount + 1
					) {
						return 'Go execution settled';
					}
					return false;
				},
				{
					previousTranscript: initialTranscript,
					previousFinishedCount: initialFinishedCount,
					requiredOutput: expectedOutput
				},
				{ polling: 50, timeout: runTimeoutMs }
			);
			const readinessReason = String(await readinessHandle.jsonValue());
			await readinessHandle.dispose();
			progressReadiness = await markLoadingProgressReady(page, readinessReason);
			await page.waitForFunction(
				hasGoExecutionPhaseCompleted,
				{
					previousTranscript: initialTranscript,
					previousFinishedCount: initialFinishedCount
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

		await stopLoadingProgressProbe(page);
		const summary = {
			...(await readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl)),
			progressReadiness
		};
		if (summary.pageErrors.length > 0) {
			throw new Error(`page errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.moduleResolutionErrors.length > 0) {
			throw new Error(
				`module resolution errors detected\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (summary.goConsoleErrors.length > 0) {
			throw new Error(`go console errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		assertLoadingProgressTrace(summary.progressTrace, `Go (${target})`, progressReadiness);
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
