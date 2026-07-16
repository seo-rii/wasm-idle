import { chromium } from 'playwright-core';

import {
	assertLoadingProgressTrace,
	installLoadingProgressProbe,
	readLoadingProgressTrace,
	stopLoadingProgressProbe
} from './browser-progress-probe.mjs';
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

export function classifyTerminalRun(previousTranscript, transcript, expectedOutput) {
	if (transcript === previousTranscript) return 'running';
	const delta = transcript.startsWith(previousTranscript)
		? transcript.slice(previousTranscript.length)
		: transcript;
	if (delta.includes(expectedOutput)) return 'success';
	if (
		/process exited with code \d+/i.test(delta) ||
		delta.includes('Process finished after') ||
		delta.includes('\x1b[1;3;31m')
	) {
		return 'failure';
	}
	return 'running';
}

export async function withWallClockTimeout(promise, timeoutMs, label = 'browser operation') {
	let timeoutId;
	try {
		return await Promise.race([
			Promise.resolve(promise),
			new Promise((_, reject) => {
				timeoutId = setTimeout(
					() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
					timeoutMs
				);
			})
		]);
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * @param {import('playwright-core').Page} page
 */
async function readActiveState(page) {
	let lastError;
	for (let attempt = 0; attempt < 12; attempt += 1) {
		try {
			return await page.evaluate(() => ({
				crossOriginIsolated,
				sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
				serviceWorkerControlled: !!navigator.serviceWorker?.controller
			}));
		} catch (error) {
			lastError = error;
			if (!String(error).includes('Execution context was destroyed')) throw error;
			await page.waitForTimeout(250);
		}
	}
	throw lastError;
}

/**
 * @param {import('playwright-core').Page} page
 * @param {{ crossOriginIsolated: boolean; sharedArrayBuffer: boolean; serviceWorkerControlled: boolean }} activeState
 * @param {string[]} pageErrors
 * @param {BrowserConsoleMessage[]} consoleMessages
 */
async function readProbeSummary(page, activeState, pageErrors, consoleMessages) {
	const readTimeoutMs = 2_000;
	const transcript =
		(await withWallClockTimeout(
			page
				.locator('[data-testid="terminal-debug-output"]')
				.textContent({ timeout: readTimeoutMs }),
			readTimeoutMs + 250,
			'terminal summary read'
		).catch(() => '')) || '';
	const progressTrace = await withWallClockTimeout(
		readLoadingProgressTrace(page),
		readTimeoutMs,
		'progress summary read'
	).catch(() => []);
	return {
		activeState,
		consoleTail: summarizeConsole(consoleMessages),
		finalUrl: page.url(),
		language:
			(await withWallClockTimeout(
				page.locator('select').first().inputValue({ timeout: readTimeoutMs }),
				readTimeoutMs + 250,
				'language summary read'
			).catch(() => '')) || '',
		pageErrors,
		progressTrace,
		title: await withWallClockTimeout(page.title(), readTimeoutMs, 'title summary read').catch(
			() => ''
		),
		transcript
	};
}

/**
 * @typedef {object} StdinBrowserProbeOptions
 * @property {string} [activePath]
 * @property {string} browserUrl
 * @property {string} [chromiumExecutable]
 * @property {string} expectedOutput
 * @property {string} language
 * @property {boolean} [preloadStdin]
 * @property {boolean} [requireSharedArrayBuffer]
 * @property {number} [runTimeoutMs]
 * @property {boolean} [sendEof]
 * @property {string} source
 * @property {string} stdinText
 * @property {{ path: string; content: string }[]} [workspaceFiles]
 */

/**
 * @param {StdinBrowserProbeOptions & { preloadStdin?: boolean }} options
 */
export async function runStdinBrowserProbe(options) {
	const {
		activePath = '',
		browserUrl = '',
		chromiumExecutable = '',
		expectedOutput = '',
		language = '',
		preloadStdin = false,
		requireSharedArrayBuffer = true,
		runTimeoutMs = 120_000,
		sendEof = false,
		source = '',
		stdinText = '',
		workspaceFiles = []
	} = options;
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
	/** @type {string[]} */
	const preselectionRuntimeRequests = [];
	/** @type {string[]} */
	const selectedRuntimeRequests = [];
	let languageSelected = false;
	page.on('request', (request) => {
		const pathname = new URL(request.url()).pathname;
		if (
			/\/(?:clang\/bin|clangd|pyodide|teavm|webr|wasm-(?!idle(?:\/|$))[^/]+)\//u.test(
				pathname
			)
		) {
			(languageSelected ? selectedRuntimeRequests : preselectionRuntimeRequests).push(
				request.url()
			);
		}
	});
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

		const isProbeReady = (
			/** @type {{ crossOriginIsolated: boolean; sharedArrayBuffer: boolean; serviceWorkerControlled: boolean }} */ state
		) =>
			state.serviceWorkerControlled &&
			(!requireSharedArrayBuffer || (state.crossOriginIsolated && state.sharedArrayBuffer));

		let activeState = await readActiveState(page);
		for (let attempt = 0; attempt < 4; attempt += 1) {
			if (isProbeReady(activeState)) {
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
		if (!isProbeReady(activeState)) {
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
		activeState = await readActiveState(page);
		await page.waitForFunction(
			() =>
				typeof (/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue) ===
					'function' &&
				typeof (/** @type {any} */ (window).__wasmIdleDebug?.setEditorValue) ===
					'function' &&
				typeof (/** @type {any} */ (window).__wasmIdleDebug?.writeTerminalInput) ===
					'function',
			undefined,
			{ timeout: runTimeoutMs }
		);
		if (preselectionRuntimeRequests.length > 0) {
			throw new Error(
				`runtime assets loaded before selecting ${language}\n${JSON.stringify(
					preselectionRuntimeRequests,
					null,
					2
				)}`
			);
		}
		languageSelected = true;
		await page.locator('select').selectOption(language);
		await page.waitForFunction(
			(expectedLanguage) =>
				document.querySelector('select')?.value === expectedLanguage &&
				typeof (/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue) ===
					'function' &&
				typeof (/** @type {any} */ (window).__wasmIdleDebug?.setEditorValue) ===
					'function' &&
				typeof (/** @type {any} */ (window).__wasmIdleDebug?.writeTerminalInput) ===
					'function',
			language,
			{ timeout: runTimeoutMs }
		);
		let previousEditorValue = await page.evaluate(
			() => /** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() ?? ''
		);
		if (!previousEditorValue) {
			await page
				.waitForFunction(
					() => {
						const value =
							/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() ?? '';
						return value.length > 0;
					},
					undefined,
					{ polling: 100, timeout: Math.min(runTimeoutMs, 10_000) }
				)
				.catch(() => {});
			previousEditorValue = await page.evaluate(
				() => /** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() ?? ''
			);
		}
		let stableEditorReads = 0;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			await page.waitForTimeout(250);
			const nextEditorValue = await page.evaluate(
				() => /** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() ?? ''
			);
			if (nextEditorValue === previousEditorValue) {
				stableEditorReads += 1;
				if (stableEditorReads >= 2) break;
				continue;
			}
			previousEditorValue = nextEditorValue;
			stableEditorReads = 0;
		}
		let editorValueStable = false;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const editorValueSet = await page.evaluate(async (text) => {
				return await /** @type {any} */ (window).__wasmIdleDebug.setEditorValue(text);
			}, source);
			if (!editorValueSet) {
				await page.waitForTimeout(500);
				continue;
			}
			await page.waitForFunction(
				(expectedSource) =>
					/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() ===
					expectedSource,
				source,
				{
					polling: 100,
					timeout: runTimeoutMs
				}
			);
			await page.waitForTimeout(500);
			editorValueStable = await page.evaluate(
				(expectedSource) =>
					/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() ===
					expectedSource,
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
		if (workspaceFiles.length > 0 || activePath) {
			const workspaceConfigured = await page.evaluate(
				async ({ nextActivePath, nextFiles }) => {
					const api = /** @type {any} */ (window).__wasmIdleDebug;
					if (typeof api?.setWorkspaceFiles !== 'function') return false;
					return await api.setWorkspaceFiles(nextFiles, nextActivePath);
				},
				{ nextActivePath: activePath, nextFiles: workspaceFiles }
			);
			if (!workspaceConfigured) {
				throw new Error(
					`stdin browser probe could not configure workspace files\n${JSON.stringify(
						await readProbeSummary(page, activeState, pageErrors, consoleMessages),
						null,
						2
					)}`
				);
			}
			await page.waitForFunction(
				(expectedSource) =>
					/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() ===
					expectedSource,
				source,
				{
					polling: 100,
					timeout: runTimeoutMs
				}
			);
		}
		await page.waitForSelector('[data-testid="terminal-debug-output"]', { state: 'attached' });
		const initialTranscript =
			(await page
				.locator('[data-testid="terminal-debug-output"]')
				.textContent()
				.catch(() => '')) || '';
		const editorValueBeforeRun = await page.evaluate(
			(expectedSource) =>
				/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() === expectedSource,
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
		await installLoadingProgressProbe(page);
		activeState = await readActiveState(page);
		const usePreloadedStdin = preloadStdin || !activeState.sharedArrayBuffer;
		if (usePreloadedStdin) {
			const stdinPrepared = await page.evaluate((text) => {
				const api = /** @type {any} */ (window).__wasmIdleDebug;
				if (typeof api?.setPreloadedStdin !== 'function') return false;
				api.setPreloadedStdin(text);
				return true;
			}, stdinText);
			if (!stdinPrepared) {
				throw new Error(
					`stdin browser probe could not prepare preloaded stdin\n${JSON.stringify(
						await readProbeSummary(page, activeState, pageErrors, consoleMessages),
						null,
						2
					)}`
				);
			}
		}
		await page.locator('button.action-button--run').first().click();
		/** @type {unknown} */
		let stdinDeliveryError = null;
		let stdinDelivery = Promise.resolve();
		if (!usePreloadedStdin) {
			stdinDelivery = (async () => {
				await page.evaluate(async (text) => {
					await /** @type {any} */ (window).__wasmIdleDebug.writeTerminalInput(
						text,
						false
					);
				}, stdinText);
				if (sendEof) {
					await page.waitForTimeout(500);
					await page.evaluate(async () => {
						await /** @type {any} */ (window).__wasmIdleDebug.writeTerminalInput(
							'',
							true
						);
					});
				}
			})().catch((error) => {
				stdinDeliveryError = error;
			});
		}

		const runDeadline = Date.now() + runTimeoutMs;
		let terminalRunStatus = 'running';
		while (terminalRunStatus === 'running' && !stdinDeliveryError && Date.now() < runDeadline) {
			const pollTimeoutMs = Math.max(1, Math.min(1_000, runDeadline - Date.now()));
			const transcript =
				(await withWallClockTimeout(
					page
						.locator('[data-testid="terminal-debug-output"]')
						.textContent({ timeout: pollTimeoutMs }),
					pollTimeoutMs + 250,
					'terminal poll'
				).catch(() => '')) || '';
			terminalRunStatus = classifyTerminalRun(initialTranscript, transcript, expectedOutput);
			if (terminalRunStatus === 'running') {
				await withWallClockTimeout(page.waitForTimeout(250), 500, 'terminal poll delay').catch(
					() => {}
				);
			}
		}
		if (stdinDeliveryError) {
			throw new Error(
				`stdin browser probe could not deliver ${language} input: ${String(stdinDeliveryError)}\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`
			);
		}
		if (terminalRunStatus === 'running') {
			throw new Error(
				`stdin browser probe timed out waiting for ${language} output\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`
			);
		}
		if (terminalRunStatus === 'failure') {
			throw new Error(
				`stdin browser probe observed ${language} failure before expected output\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`
			);
		}
		await stdinDelivery;
		if (stdinDeliveryError) {
			throw new Error(
				`stdin browser probe could not finish delivering ${language} input: ${String(stdinDeliveryError)}\n${JSON.stringify(
					await readProbeSummary(page, activeState, pageErrors, consoleMessages),
					null,
					2
				)}`
			);
		}
		await page.waitForFunction(
			() =>
				(
					document.querySelector('[data-testid="terminal-debug-output"]')?.textContent ||
					''
				).includes('Process finished after'),
			undefined,
			{ polling: 100, timeout: runTimeoutMs }
		);

		await stopLoadingProgressProbe(page);
		const summary = {
			...(await readProbeSummary(page, activeState, pageErrors, consoleMessages)),
			runtimeRequests: [...new Set(selectedRuntimeRequests)]
		};
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
			throw new Error(
				`stdin browser run did not finish\n${JSON.stringify(summary, null, 2)}`
			);
		}
		try {
			assertLoadingProgressTrace(summary.progressTrace, language);
		} catch (error) {
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(summary, null, 2)}`,
				{ cause: error }
			);
		}
		return summary;
	} finally {
		await withWallClockTimeout(page.close(), 2_000, 'page close').catch(() => {});
		await withWallClockTimeout(context.close(), 2_000, 'browser context close').catch(() => {});
		await withWallClockTimeout(browser.close(), 5_000, 'browser close').catch(() => {});
	}
}
