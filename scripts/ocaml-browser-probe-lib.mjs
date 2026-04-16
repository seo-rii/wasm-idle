import { chromium } from 'playwright-core';

import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

/**
 * @typedef {{ type: string; text: string }} BrowserConsoleMessage
 */
/**
 * @typedef {{ method: string; url: string }} BrowserNetworkRequest
 */
/**
 * @typedef {{ status: number; url: string }} BrowserNetworkResponse
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
function findOcamlConsoleErrors(messages) {
	return messages
		.filter(
			(entry) =>
				(entry.type === 'error' || entry.type === 'warning') &&
				(entry.text.includes('[wasm-idle:ocaml-worker] failed') ||
					entry.text.includes('OCaml worker script error:') ||
					entry.text.includes('OCaml runtime is not configured'))
		)
		.map((entry) => `[${entry.type}] ${entry.text}`);
}

/**
 * @param {import('playwright-core').Page} page
 * @param {{ crossOriginIsolated: boolean; sharedArrayBuffer: boolean; serviceWorkerControlled: boolean }} activeState
 * @param {string[]} pageErrors
 * @param {BrowserConsoleMessage[]} consoleMessages
 * @param {BrowserNetworkRequest[]} binaryenBridgeRequests
 * @param {BrowserNetworkResponse[]} binaryenBridgeResponses
 * @param {BrowserNetworkRequest[]} binaryenToolRequests
 * @param {BrowserNetworkResponse[]} binaryenToolResponses
 * @param {string} browserUrl
 */
async function readProbeSummary(
	page,
	activeState,
	pageErrors,
	consoleMessages,
	binaryenBridgeRequests,
	binaryenBridgeResponses,
	binaryenToolRequests,
	binaryenToolResponses,
	browserUrl
) {
	const transcript =
		(await page
			.locator('[data-testid="terminal-debug-output"]')
			.textContent()
			.catch(() => '')) || '';
	const selectedOcamlBackend =
		(await page
			.locator('#ocaml-backend')
			.inputValue()
			.catch(() => '')) || '';
	const storedCode = await page
		.evaluate(() => window.localStorage.getItem('code') || '')
		.catch(() => '');
	return {
		activeState,
		binaryenBridgeRequests,
		binaryenBridgeResponses,
		binaryenToolRequests,
		binaryenToolResponses,
		browserUrl,
		consoleTail: summarizeConsole(consoleMessages),
		finalUrl: page.url(),
		moduleResolutionErrors: findModuleResolutionErrors(consoleMessages),
		ocamlConsoleErrors: findOcamlConsoleErrors(consoleMessages),
		pageErrors,
		selectedOcamlBackend,
		storedCode,
		title: await page.title().catch(() => ''),
		transcript
	};
}

/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput?: string; runTimeoutMs?: number; backend?: 'js' | 'wasm'; code?: string; stdinText?: string; sendEof?: boolean; stdinMethod?: 'debug-hook' | 'keyboard' }} options
 */
export async function runOcamlBrowserProbe({
	browserUrl,
	chromiumExecutable = '',
	expectedOutput = 'hello from ocaml fixture',
	runTimeoutMs = 300_000,
	backend = 'js',
	code = 'let () = print_endline "hello from ocaml fixture"',
	stdinText = '',
	sendEof = false,
	stdinMethod = 'debug-hook'
}) {
	if (!browserUrl) {
		throw new Error('runOcamlBrowserProbe requires a browserUrl');
	}

	const executablePath = await resolveChromiumExecutable(chromiumExecutable);
	const browser = await chromium.launch({
		headless: true,
		executablePath
	});
	const targetUrl = new URL(browserUrl);

	const context = await browser.newContext();
	await context.addCookies([
		{
			name: 'dev_bypass_waf',
			value: 'seorii_bypass_token_is_this',
			url: targetUrl.origin
		}
	]);
	const page = await context.newPage();
	page.setDefaultTimeout(runTimeoutMs);

	/** @type {BrowserConsoleMessage[]} */
	const consoleMessages = [];
	/** @type {string[]} */
	const pageErrors = [];
	/** @type {BrowserNetworkRequest[]} */
	const binaryenBridgeRequests = [];
	/** @type {BrowserNetworkResponse[]} */
	const binaryenBridgeResponses = [];
	/** @type {BrowserNetworkRequest[]} */
	const binaryenToolRequests = [];
	/** @type {BrowserNetworkResponse[]} */
	const binaryenToolResponses = [];
	page.on('console', (message) => {
		consoleMessages.push({
			type: message.type(),
			text: message.text()
		});
	});
	page.on('pageerror', (error) => {
		pageErrors.push(String(error.stack || error.message || error));
	});
	page.on('crash', () => {
		pageErrors.push('Page crashed');
	});
	page.on('request', (request) => {
		if (request.url().includes('/api/binaryen-command')) {
			binaryenBridgeRequests.push({
				method: request.method(),
				url: request.url()
			});
		}
		if (
			request.url().includes('/wasm-opt.browser.js') ||
			request.url().includes('/wasm-merge.browser.js') ||
			request.url().includes('/wasm-metadce.browser.js')
		) {
			binaryenToolRequests.push({
				method: request.method(),
				url: request.url()
			});
		}
	});
	page.on('response', (response) => {
		if (response.url().includes('/api/binaryen-command')) {
			binaryenBridgeResponses.push({
				status: response.status(),
				url: response.url()
			});
		}
		if (
			response.url().includes('/wasm-opt.browser.js') ||
			response.url().includes('/wasm-merge.browser.js') ||
			response.url().includes('/wasm-metadce.browser.js')
		) {
			binaryenToolResponses.push({
				status: response.status(),
				url: response.url()
			});
		}
	});

	try {
		await page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' });
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
			await page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' });
			await page.waitForTimeout(2_500 + attempt * 500);
			activeState = await readActiveState(page);
		}

		if (
			!activeState.crossOriginIsolated ||
			!activeState.sharedArrayBuffer ||
			!activeState.serviceWorkerControlled
		) {
			throw new Error(
				`page is not ready for wasm-idle OCaml\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, binaryenBridgeRequests, binaryenBridgeResponses, binaryenToolRequests, binaryenToolResponses, targetUrl.toString()), null, 2)}`
			);
		}

		await page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1_000);
		await page.waitForSelector('select', { state: 'attached', timeout: runTimeoutMs });
		await page.locator('select').first().selectOption('OCAML');
		await page.waitForSelector('#ocaml-backend', { state: 'attached', timeout: runTimeoutMs });
		await page.locator('#ocaml-backend').selectOption(backend);
		await page.waitForFunction(
			() =>
				typeof (/** @type {any} */ (window).__wasmIdleDebug?.setEditorValue) === 'function'
		);
		const editorValueSet = await page.evaluate(async (nextCode) => {
			return await /** @type {any} */ (window).__wasmIdleDebug.setEditorValue(nextCode);
		}, code);
		if (!editorValueSet) {
			throw new Error(
				`OCaml browser probe could not write editor contents\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, binaryenBridgeRequests, binaryenBridgeResponses, binaryenToolRequests, binaryenToolResponses, targetUrl.toString()), null, 2)}`
			);
		}
		await page.waitForFunction(
			(expectedCode) => {
				return (
					/** @type {any} */ (window).__wasmIdleDebug?.getEditorValue?.() === expectedCode
				);
			},
			code,
			{
				polling: 100,
				timeout: runTimeoutMs
			}
		);
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
		await page.locator('button.action-button--run').first().click();
		if (stdinText || sendEof) {
			try {
				await page.waitForFunction(
					(previousFinishedCount) => {
						const text =
							document.querySelector('[data-testid="terminal-debug-output"]')
								?.textContent || '';
						const finishedCount = (text.match(/Process finished after/g) || []).length;
						return (
							text.includes('OCaml compilation failed') ||
							finishedCount >= previousFinishedCount + 1
						);
					},
					initialFinishedCount,
					{
						polling: 250,
						timeout: runTimeoutMs
					}
				);
			} catch (error) {
				throw new Error(
					`OCaml browser probe timed out waiting for compile preparation\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, binaryenBridgeRequests, binaryenBridgeResponses, binaryenToolRequests, binaryenToolResponses, targetUrl.toString()), null, 2)}`,
					{ cause: error }
				);
			}
			if (stdinMethod === 'keyboard') {
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
				if (sendEof) {
					await page.keyboard.press('Control+D');
				}
			} else {
				await page.waitForFunction(
					() =>
						typeof (/** @type {any} */ (window).__wasmIdleDebug?.writeTerminalInput) ===
						'function'
				);
				await page.evaluate(
					async ({ text, eof }) => {
						await /** @type {any} */ (window).__wasmIdleDebug.writeTerminalInput(text, eof);
					},
					{ text: stdinText, eof: sendEof }
				);
			}
			const compileTranscript =
				(await page
					.locator('[data-testid="terminal-debug-output"]')
					.textContent()
					.catch(() => '')) || '';
			const compileFinishedCount = (compileTranscript.match(/Process finished after/g) || [])
				.length;
			if (
				!compileTranscript.includes('OCaml compilation failed') &&
				!(Boolean(expectedOutput) && compileTranscript.includes(expectedOutput))
			) {
				try {
					await page.waitForFunction(
						({ previousTranscript, requiredOutput, previousFinishedCount }) => {
							const text =
								document.querySelector('[data-testid="terminal-debug-output"]')
									?.textContent || '';
							if (text === previousTranscript) {
								return false;
							}
							const finishedCount = (text.match(/Process finished after/g) || [])
								.length;
							return (
								text.includes('OCaml compilation failed') ||
								finishedCount >= previousFinishedCount + 1 ||
								(Boolean(requiredOutput) && text.includes(requiredOutput))
							);
						},
						{
							previousTranscript: compileTranscript,
							requiredOutput: expectedOutput,
							previousFinishedCount: compileFinishedCount
						},
						{
							polling: 250,
							timeout: runTimeoutMs
						}
					);
				} catch (error) {
					throw new Error(
						`OCaml browser probe timed out waiting for stdin execution\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, binaryenBridgeRequests, binaryenBridgeResponses, binaryenToolRequests, binaryenToolResponses, targetUrl.toString()), null, 2)}`,
						{ cause: error }
					);
				}
			}
		} else {
			try {
				await page.waitForFunction(
					(previousTranscript) => {
						const text =
							document.querySelector('[data-testid="terminal-debug-output"]')
								?.textContent || '';
						if (text === previousTranscript) {
							return false;
						}
						return (
							text.includes('OCaml compilation failed') ||
							(text.match(/Process finished after/g) || []).length >= 2
						);
					},
					initialTranscript,
					{
						polling: 250,
						timeout: runTimeoutMs
					}
				);
			} catch (error) {
				throw new Error(
					`OCaml browser probe timed out waiting for the execution phase\n${JSON.stringify(await readProbeSummary(page, activeState, pageErrors, consoleMessages, binaryenBridgeRequests, binaryenBridgeResponses, binaryenToolRequests, binaryenToolResponses, targetUrl.toString()), null, 2)}`,
					{ cause: error }
				);
			}
		}

		const summary = await readProbeSummary(
			page,
			activeState,
			pageErrors,
			consoleMessages,
			binaryenBridgeRequests,
			binaryenBridgeResponses,
			binaryenToolRequests,
			binaryenToolResponses,
			targetUrl.toString()
		);
		if (summary.pageErrors.length > 0) {
			throw new Error(`page errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.moduleResolutionErrors.length > 0) {
			throw new Error(
				`module resolution errors detected\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (summary.ocamlConsoleErrors.length > 0) {
			throw new Error(`ocaml console errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (!summary.transcript.includes(expectedOutput)) {
			throw new Error(
				`expected OCaml output "${expectedOutput}" was not found\n${JSON.stringify(summary, null, 2)}`
			);
		}
		return summary;
	} finally {
		await browser.close();
	}
}
