import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright-core';

/**
 * @typedef {{ type: string; text: string }} BrowserConsoleMessage
 */

/**
 * @param {string} explicitPath
 */
export async function resolveChromiumExecutable(explicitPath = '') {
	if (explicitPath) {
		return explicitPath;
	}
	const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
	const entries = await fs.readdir(cacheRoot, { withFileTypes: true });
	const chromiumFolder = entries
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
		.map((entry) => entry.name)
		.sort()
		.at(-1);
	if (!chromiumFolder) {
		throw new Error('failed to locate a cached Chromium build under ~/.cache/ms-playwright');
	}
	return path.join(cacheRoot, chromiumFolder, 'chrome-linux64', 'chrome');
}

/**
 * @param {BrowserConsoleMessage[]} messages
 */
function summarizeConsole(messages) {
	return messages.slice(-160).map((message) => `[${message.type}] ${message.text}`);
}

/**
 * @param {string[]} pageErrors
 */
function filterBenignPageErrors(pageErrors) {
	return pageErrors.filter((entry) => !entry.includes('Canceled: Canceled'));
}

/**
 * @param {BrowserConsoleMessage[]} messages
 */
function findBootstrapErrors(messages) {
	return messages
		.filter(
			(entry) =>
				entry.text.includes('[wasm-rust] compile worker bootstrap failed') ||
				entry.text.includes('worker script error [worker=') ||
				entry.text.includes('Rust worker script error:')
		)
		.map((entry) => `[${entry.type}] ${entry.text}`);
}

/**
 * @param {BrowserConsoleMessage[]} messages
 */
function findRustConsoleErrors(messages) {
	return messages
		.filter(
			(entry) =>
				entry.type === 'error' &&
				(entry.text.includes('[wasm-rust] compile worker bootstrap failed') ||
					entry.text.includes('[wasm-rust:compiler-worker]') ||
					entry.text.includes('[wasm-rust:thread-worker') ||
					entry.text.includes('Rust worker script error:'))
		)
		.map((entry) => `[${entry.type}] ${entry.text}`);
}

/**
 * @param {BrowserConsoleMessage[]} messages
 * @param {string[]} pageErrors
 */
function findMaximumCallStackErrors(messages, pageErrors) {
	const isMaximumCallStackError = (text) => /maximum call stack/i.test(text);
	return [
		...pageErrors
			.filter((entry) => isMaximumCallStackError(entry))
			.map((entry) => `[pageerror] ${entry}`),
		...messages
			.filter((entry) => isMaximumCallStackError(entry.text))
			.map((entry) => `[${entry.type}] ${entry.text}`)
	];
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
	const availableRustTargets = await page
		.locator('#rust-target-triple option')
		.evaluateAll((elements) =>
			elements
				.map((element) => element.getAttribute('value') || '')
				.filter((value) => value.length > 0)
		)
		.catch(() => []);
	return {
		url: browserUrl,
		finalUrl: page.url(),
		title: await page.title().catch(() => ''),
		activeState,
		availableRustTargets,
		pageErrors,
		transcript,
		consoleTail: summarizeConsole(consoleMessages),
		bootstrapErrors: findBootstrapErrors(consoleMessages),
		rustConsoleErrors: findRustConsoleErrors(consoleMessages),
		callStackErrors: findMaximumCallStackErrors(consoleMessages, pageErrors)
	};
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
 * @param {{ browserUrl: string; runTimeoutMs?: number; chromiumExecutable?: string; stdinText?: string; sendEof?: boolean; expectedOutput?: string; targetTriple?: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3' }} options
 */
export async function runRustBrowserProbe({
	browserUrl,
	runTimeoutMs = 300_000,
	chromiumExecutable = '',
	stdinText = '5\n',
	sendEof = false,
	expectedOutput = 'factorial_plus_bonus=123',
	targetTriple = 'wasm32-wasip1'
}) {
	if (!browserUrl) {
		throw new Error('runRustBrowserProbe requires a browserUrl');
	}
	const executablePath = await resolveChromiumExecutable(chromiumExecutable);
	const browser = await chromium.launch({
		headless: true,
		executablePath
	});
	const context = await browser.newContext();

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
					// Ignore readiness errors and retry via a fresh navigation.
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
			const summary = await readProbeSummary(
				page,
				activeState,
				pageErrors,
				consoleMessages,
				browserUrl
			);
			throw new Error(`page is not ready for wasm-rust\n${JSON.stringify(summary, null, 2)}`);
		}
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1_000);
		await page.waitForSelector('select', { state: 'attached', timeout: runTimeoutMs });

		await page.locator('select').selectOption('RUST');
		await page.locator('#rust-target-triple').selectOption(targetTriple);
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
					return text.includes('Rust compilation failed') || text.includes('Process finished after');
				},
				initialTranscript,
				{
					polling: 250,
					timeout: runTimeoutMs
				}
			);
		} catch (error) {
			const summary = await readProbeSummary(
				page,
				activeState,
				pageErrors,
				consoleMessages,
				browserUrl
			);
			throw new Error(
				`rust browser probe timed out waiting for prepare to finish: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(summary, null, 2)}`
			);
		}
		const prepareTranscript =
			(await page.locator('[data-testid="terminal-debug-output"]').textContent().catch(() => '')) || '';
		const prepareFinishedCount = (prepareTranscript.match(/Process finished after/g) || []).length;
		await page.waitForFunction(() => typeof window.__wasmIdleDebug?.writeTerminalInput === 'function');
		await page.evaluate(
			async ({ text, eof }) => {
				await window.__wasmIdleDebug.writeTerminalInput(text, eof);
			},
			{ text: stdinText, eof: sendEof }
		);

		try {
			await page.waitForFunction(
				({
					previousTranscript,
					requiredOutput,
					previousFinishedCount
				}) => {
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')?.textContent || '';
					if (text === previousTranscript) {
						return false;
					}
					const finishedCount = (text.match(/Process finished after/g) || []).length;
					return (
						text.includes('Rust compilation failed') ||
						finishedCount >= previousFinishedCount + 1 ||
						(Boolean(requiredOutput) && text.includes(requiredOutput))
					);
				},
				{
					previousTranscript: prepareTranscript,
					requiredOutput: expectedOutput,
					previousFinishedCount: prepareFinishedCount
				},
				{
					polling: 250,
					timeout: runTimeoutMs
				}
			);
		} catch (error) {
			const summary = await readProbeSummary(
				page,
				activeState,
				pageErrors,
				consoleMessages,
				browserUrl
			);
			throw new Error(
				`rust browser probe timed out waiting for terminal output: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(summary, null, 2)}`
			);
		}

		const summary = await readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl);
		const relevantPageErrors = filterBenignPageErrors(pageErrors);

		if (relevantPageErrors.length > 0) {
			throw new Error(`page errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.bootstrapErrors.length > 0) {
			throw new Error(`rust worker bootstrap errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.rustConsoleErrors.length > 0) {
			throw new Error(`unexpected rust console errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.transcript.includes('Rust compilation failed')) {
			throw new Error(`rust run failed\n${JSON.stringify(summary, null, 2)}`);
		}
		if (expectedOutput && !summary.transcript.includes(expectedOutput)) {
			throw new Error(
				`terminal transcript did not contain expected rust output ${JSON.stringify(expectedOutput)}\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (
			!summary.transcript.includes('Process finished after') &&
			!summary.consoleTail.some((entry) => entry.includes('wasi run complete exitCode=0'))
		) {
			throw new Error(
				`terminal transcript did not contain a completed rust run\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (
			!summary.consoleTail.some((entry) =>
				entry.includes('[wasm-idle:rust-worker] compile settled success=true')
			)
		) {
			throw new Error(
				`browser probe did not observe a successful rust compile settle log\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (
			summary.transcript.includes('memory access out of bounds') ||
			summary.consoleTail.some((entry) => entry.includes('memory access out of bounds'))
		) {
			throw new Error(
				`browser probe still observed memory access out of bounds for ${targetTriple}\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (
			/maximum call stack/i.test(summary.transcript) ||
			summary.callStackErrors.length > 0
		) {
			throw new Error(
				`browser probe still observed maximum call stack errors for ${targetTriple}\n${JSON.stringify(summary, null, 2)}`
			);
		}

		return summary;
	} finally {
		await browser.close();
	}
}
