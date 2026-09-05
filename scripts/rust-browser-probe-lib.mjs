import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright-core';

import {
	assertLoadingProgressTrace,
	installLoadingProgressProbe,
	markLoadingProgressReady,
	readLoadingProgressTrace,
	stopLoadingProgressProbe
} from './browser-progress-probe.mjs';

/**
 * @typedef {{ type: string; text: string }} BrowserConsoleMessage
 */

/**
 * @typedef {{
 *   delivery: { storagePath: string; encoding: 'identity' | 'gzip' };
 *   storage: { sha256: string };
 * }} RustExecutableGraphProbeModule
 */

/**
 * @typedef {{
 *   entryPath: string;
 *   modules: Readonly<Record<string, RustExecutableGraphProbeModule>>;
 * }} RustExecutableGraphProbeProfile
 */

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_RUST_EXECUTABLE_GRAPH_MODULES = 256;

/**
 * @param {unknown} value
 * @param {string} label
 * @param {string} suffix
 */
function requireSafeGraphPath(value, label, suffix) {
	if (
		typeof value !== 'string' ||
		!value.endsWith(suffix) ||
		!/^[A-Za-z0-9._/-]+$/u.test(value) ||
		value.startsWith('/') ||
		value.includes('//') ||
		value.split('/').some((segment) => segment === '.' || segment === '..') ||
		path.posix.normalize(value) !== value
	) {
		throw new Error(`${label} must be a safe relative ${suffix} path`);
	}
	return value;
}

/**
 * @param {string} browserUrl
 * @param {RustExecutableGraphProbeProfile | undefined} profile
 */
function createRustExecutableGraphProbeContract(browserUrl, profile) {
	if (profile === undefined) return [];
	if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
		throw new Error('Rust executable graph probe profile must be an object');
	}
	if (!profile.modules || typeof profile.modules !== 'object' || Array.isArray(profile.modules)) {
		throw new Error('Rust executable graph probe profile must contain modules');
	}
	const moduleEntries = Object.entries(profile.modules);
	if (moduleEntries.length === 0 || moduleEntries.length > MAX_RUST_EXECUTABLE_GRAPH_MODULES) {
		throw new Error(
			`Rust executable graph probe profile must contain 1-${MAX_RUST_EXECUTABLE_GRAPH_MODULES} modules`
		);
	}
	const entryPath = requireSafeGraphPath(
		profile.entryPath,
		'Rust executable graph entryPath',
		'.js'
	);
	if (!Object.prototype.hasOwnProperty.call(profile.modules, entryPath)) {
		throw new Error('Rust executable graph probe profile entryPath is missing from modules');
	}

	const applicationRootUrl = new URL(browserUrl);
	applicationRootUrl.hash = '';
	applicationRootUrl.search = '';
	if (!applicationRootUrl.pathname.endsWith('/')) applicationRootUrl.pathname += '/';
	const runtimeBaseUrl = new URL('wasm-rust/', applicationRootUrl);
	const storagePaths = new Set();
	return moduleEntries
		.map(([rawModulePath, rawModule]) => {
			const modulePath = requireSafeGraphPath(
				rawModulePath,
				'Rust executable graph module path',
				'.js'
			);
			if (!rawModule || typeof rawModule !== 'object' || Array.isArray(rawModule)) {
				throw new Error(`Rust executable graph module ${modulePath} must be an object`);
			}
			const encoding = rawModule.delivery?.encoding;
			if (encoding !== 'identity' && encoding !== 'gzip') {
				throw new Error(
					`Rust executable graph module ${modulePath} has an invalid encoding`
				);
			}
			const expectedStoragePath =
				encoding === 'gzip' ? `${modulePath}.gz.bin` : `${modulePath}.bin`;
			const storagePath = requireSafeGraphPath(
				rawModule.delivery?.storagePath,
				`Rust executable graph module ${modulePath} storagePath`,
				encoding === 'gzip' ? '.js.gz.bin' : '.js.bin'
			);
			if (storagePath !== expectedStoragePath) {
				throw new Error(
					`Rust executable graph module ${modulePath} has a non-inert storagePath`
				);
			}
			if (storagePaths.has(storagePath)) {
				throw new Error(`Rust executable graph repeats storagePath ${storagePath}`);
			}
			storagePaths.add(storagePath);
			const receipt = rawModule.storage?.sha256;
			if (typeof receipt !== 'string' || !SHA256_PATTERN.test(receipt)) {
				throw new Error(
					`Rust executable graph module ${modulePath} has an invalid receipt`
				);
			}
			const logicalUrl = new URL(modulePath, runtimeBaseUrl);
			const storageUrl = new URL(storagePath, runtimeBaseUrl);
			storageUrl.searchParams.set('v', receipt);
			return Object.freeze({
				encoding,
				expectedUrl: storageUrl.href,
				logicalPathname: logicalUrl.pathname,
				modulePath,
				storagePath,
				storagePathname: storageUrl.pathname
			});
		})
		.sort((left, right) => left.modulePath.localeCompare(right.modulePath));
}

/** @param {string | null} contentType */
function responseMediaType(contentType) {
	return (contentType || '').split(';', 1)[0].trim().toLowerCase();
}

/**
 * @param {string} explicitPath
 */
export async function resolveChromiumExecutable(explicitPath = '') {
	if (explicitPath) {
		return explicitPath;
	}
	const playwrightExecutable = chromium.executablePath();
	try {
		await fs.access(playwrightExecutable);
		return playwrightExecutable;
	} catch {
		// Fall back to the cache scan below for older Playwright layouts.
	}
	const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
	let entries = [];
	try {
		entries = await fs.readdir(cacheRoot, { withFileTypes: true });
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		throw new Error(
			`failed to locate a cached Chromium build. Tried ${playwrightExecutable} and ${cacheRoot}. Run "pnpm exec playwright-core install chromium" or set WASM_IDLE_CHROMIUM_EXECUTABLE.`
		);
	}
	const chromiumFolder = entries
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
		.map((entry) => entry.name)
		.sort()
		.at(-1);
	if (!chromiumFolder) {
		throw new Error(
			`failed to locate a cached Chromium build under ${cacheRoot}. Run "pnpm exec playwright-core install chromium" or set WASM_IDLE_CHROMIUM_EXECUTABLE.`
		);
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
 */
export function findRustCompilerRetries(messages) {
	return messages
		.filter(
			(entry) =>
				entry.text.includes('[wasm-rust] browser rustc attempt ') &&
				entry.text.includes(' failed; retrying')
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
		(await page
			.locator('[data-testid="terminal-debug-output"]')
			.textContent()
			.catch(() => '')) || '';
	const availableRustTargets = await page
		.locator('#rust-target-triple option')
		.evaluateAll((elements) =>
			elements
				.map((element) => element.getAttribute('value') || '')
				.filter((value) => value.length > 0)
		)
		.catch(() => []);
	const progressTrace = await readLoadingProgressTrace(page);
	return {
		url: browserUrl,
		finalUrl: page.url(),
		title: await page.title().catch(() => ''),
		activeState,
		availableRustTargets,
		pageErrors,
		progressTrace,
		transcript,
		consoleTail: summarizeConsole(consoleMessages),
		bootstrapErrors: findBootstrapErrors(consoleMessages),
		rustConsoleErrors: findRustConsoleErrors(consoleMessages),
		compilerRetries: findRustCompilerRetries(consoleMessages),
		callStackErrors: findMaximumCallStackErrors(consoleMessages, pageErrors)
	};
}

/**
 * @param {'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3'} targetTriple
 */
function rustSourceForTarget(targetTriple) {
	if (targetTriple === 'wasm32-wasip2') {
		return `#[cfg(not(target_env = "p2"))]
compile_error!("This example requires wasm32-wasip2.");

use std::env;
use std::io;

static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let preview2_label = env::args().nth(1).unwrap_or_else(|| "preview2-cli".to_string());
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview2_component={}", preview2_label);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`;
	}
	if (targetTriple === 'wasm32-wasip3') {
		return `#[cfg(not(target_env = "p3"))]
compile_error!("This example requires wasm32-wasip3.");

use std::env;
use std::io;

static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let preview3_label = env::args()
        .nth(1)
        .unwrap_or_else(|| "preview3-transition".to_string());
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview3_transition={}", preview3_label);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`;
	}
	return `use std::io;

static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`;
}

/**
 * @param {import('playwright-core').Page} page
 */
export async function readActiveState(page) {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		try {
			return await page.evaluate(() => ({
				crossOriginIsolated,
				sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
				serviceWorkerControlled: !!navigator.serviceWorker?.controller
			}));
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			const navigationReplacedContext =
				detail.includes('Execution context was destroyed') ||
				detail.includes('Cannot find context with specified id') ||
				detail.includes('most likely because of a navigation');
			if (!navigationReplacedContext || attempt === 3) {
				throw error;
			}
			await page.waitForLoadState('domcontentloaded').catch(() => {});
		}
	}
	throw new Error('Rust browser page readiness could not be measured');
}

/**
 * @param {{ browserUrl: string; runTimeoutMs?: number; chromiumExecutable?: string; stdinText?: string; sendEof?: boolean; expectedOutput?: string; targetTriple?: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3'; rustExecutableGraphProfile?: RustExecutableGraphProbeProfile }} options
 */
export async function runRustBrowserProbe({
	browserUrl,
	runTimeoutMs = 300_000,
	chromiumExecutable = '',
	stdinText = '5\n',
	sendEof = false,
	expectedOutput = 'factorial_plus_bonus=123',
	targetTriple = 'wasm32-wasip1',
	rustExecutableGraphProfile
}) {
	if (!browserUrl) {
		throw new Error('runRustBrowserProbe requires a browserUrl');
	}
	const executableGraphContract = createRustExecutableGraphProbeContract(
		browserUrl,
		rustExecutableGraphProfile
	);
	const executablePath = await resolveChromiumExecutable(chromiumExecutable);
	const browser = await chromium.launch({
		headless: true,
		executablePath
	});
	const context = await browser.newContext();
	await addBrowserTestCookies(context, browserUrl);

	const page = await context.newPage();
	page.setDefaultTimeout(runTimeoutMs);

	/** @type {BrowserConsoleMessage[]} */
	const consoleMessages = [];
	/** @type {string[]} */
	const pageErrors = [];
	/** @type {string[]} */
	const requestUrls = [];
	/** @type {Array<{ url: string; resourceType: string }>} */
	const requestRecords = [];
	/** @type {Array<{ url: string; status: number; ok: boolean; contentType: string | null; contentEncoding: string | null }>} */
	const responseRecords = [];
	page.on('console', (message) => {
		consoleMessages.push({
			type: message.type(),
			text: message.text()
		});
	});
	page.on('pageerror', (error) => {
		pageErrors.push(String(error.stack || error.message || error));
	});
	page.on('request', (request) => {
		requestUrls.push(request.url());
		requestRecords.push({ url: request.url(), resourceType: request.resourceType() });
	});
	page.on('response', (response) => {
		const headers = response.headers();
		responseRecords.push({
			url: response.url(),
			status: response.status(),
			ok: response.ok(),
			contentType: headers['content-type'] || null,
			contentEncoding: headers['content-encoding'] || null
		});
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
		try {
			await page.waitForSelector('#language-select', {
				state: 'attached',
				timeout: runTimeoutMs
			});
		} catch (error) {
			const summary = await readProbeSummary(
				page,
				activeState,
				pageErrors,
				consoleMessages,
				browserUrl
			);
			throw new Error(
				`rust browser probe timed out waiting for the language selector: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(summary, null, 2)}`
			);
		}

		const prematureRuntimeRequests = requestUrls.filter((requestUrl) => {
			const pathname = new URL(requestUrl).pathname;
			return pathname.includes('/wasm-rust/') || pathname.includes('/lsp/');
		});
		if (prematureRuntimeRequests.length > 0) {
			throw new Error(
				`Rust or LSP assets loaded before Rust was selected:\n${prematureRuntimeRequests.join('\n')}`
			);
		}

		const source = rustSourceForTarget(targetTriple);
		const rustBrowserUrl = new URL(browserUrl);
		rustBrowserUrl.searchParams.set('lang', 'RUST');
		rustBrowserUrl.searchParams.set('rustTargetTriple', targetTriple);
		rustBrowserUrl.searchParams.set('code64', Buffer.from(source).toString('base64url'));
		await page.goto(rustBrowserUrl.toString(), { waitUntil: 'domcontentloaded' });
		try {
			await page.waitForFunction(
				({ expectedSource, expectedTarget }) => {
					const language = document.querySelector('#language-select');
					const target = document.querySelector('#rust-target-triple');
					return (
						language?.value === 'RUST' &&
						target?.value === expectedTarget &&
						window.__wasmIdleDebug?.getEditorValue() === expectedSource
					);
				},
				{ expectedSource: source, expectedTarget: targetTriple },
				{ polling: 250, timeout: runTimeoutMs }
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
				`rust browser probe could not write editor contents: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(summary, null, 2)}`
			);
		}
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
		const editorSource = await page.evaluate(
			() => window.__wasmIdleDebug?.getEditorValue() || ''
		);
		if (editorSource !== source) {
			throw new Error(`Rust editor source changed after ${targetTriple} selection settled`);
		}
		await installLoadingProgressProbe(page);
		await page.locator('button.action-button--run').first().click();
		await page.waitForFunction(
			() => typeof window.__wasmIdleDebug?.writeTerminalInput === 'function'
		);
		await page.evaluate(async (text) => {
			await window.__wasmIdleDebug.writeTerminalInput(text, false);
		}, stdinText);
		if (sendEof) {
			await page.waitForTimeout(500);
			await page.evaluate(async () => {
				await window.__wasmIdleDebug.writeTerminalInput('', true);
			});
		}

		try {
			await page.waitForFunction(
				({ previousTranscript, requiredOutput, previousFinishedCount }) => {
					const text =
						document.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent || '';
					if (text === previousTranscript) {
						return false;
					}
					const finishedCount = (text.match(/Process finished after/g) || []).length;
					return (
						text.includes('Rust compilation failed') ||
						(finishedCount >= previousFinishedCount + 1 &&
							(!requiredOutput || text.includes(requiredOutput)))
					);
				},
				{
					previousTranscript: initialTranscript,
					requiredOutput: expectedOutput,
					previousFinishedCount: initialFinishedCount
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
		const progressReadiness = await markLoadingProgressReady(page, 'Rust execution settled');

		await stopLoadingProgressProbe(page);
		const summary = {
			...(await readProbeSummary(page, activeState, pageErrors, consoleMessages, browserUrl)),
			progressReadiness
		};
		const relevantPageErrors = filterBenignPageErrors(pageErrors);

		if (relevantPageErrors.length > 0) {
			throw new Error(`page errors detected\n${JSON.stringify(summary, null, 2)}`);
		}
		if (summary.bootstrapErrors.length > 0) {
			throw new Error(
				`rust worker bootstrap errors detected\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (summary.rustConsoleErrors.length > 0) {
			throw new Error(
				`unexpected rust console errors detected\n${JSON.stringify(summary, null, 2)}`
			);
		}
		if (findRustCompilerRetries(consoleMessages).length > 0) {
			throw new Error(`rust compiler retries detected\n${JSON.stringify(summary, null, 2)}`);
		}
		assertLoadingProgressTrace(
			summary.progressTrace,
			`Rust (${targetTriple})`,
			progressReadiness
		);
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
		if (/maximum call stack/i.test(summary.transcript) || summary.callStackErrors.length > 0) {
			throw new Error(
				`browser probe still observed maximum call stack errors for ${targetTriple}\n${JSON.stringify(summary, null, 2)}`
			);
		}
		const logicalPathnames = new Set(
			executableGraphContract.map((entry) => entry.logicalPathname)
		);
		const rustLogicalModuleHttpRequests = requestRecords.filter(({ url }) => {
			const parsed = new URL(url);
			return (
				(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
				logicalPathnames.has(parsed.pathname)
			);
		});
		const rustExecutableHttpRequests =
			executableGraphContract.length > 0
				? rustLogicalModuleHttpRequests
				: requestRecords.filter(({ url, resourceType }) => {
						const parsed = new URL(url);
						return (
							(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
							parsed.pathname.includes('/wasm-rust/') &&
							resourceType === 'script'
						);
					});
		const rustExecutableGraphStorageEvidence = executableGraphContract.map((entry) => ({
			encoding: entry.encoding,
			expectedUrl: entry.expectedUrl,
			logicalPathname: entry.logicalPathname,
			modulePath: entry.modulePath,
			requests: requestRecords.filter(({ url }) => url === entry.expectedUrl),
			responses: responseRecords.filter(({ url }) => url === entry.expectedUrl),
			storagePath: entry.storagePath
		}));
		const storagePathContracts = new Map(
			executableGraphContract.map((entry) => [entry.storagePathname, entry])
		);
		const unexpectedRustExecutableStorageRequests = requestRecords.filter(({ url }) => {
			const parsed = new URL(url);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
			const contract = storagePathContracts.get(parsed.pathname);
			return contract !== undefined && url !== contract.expectedUrl;
		});
		const missingRustExecutableStorage = rustExecutableGraphStorageEvidence.filter(
			(entry) => entry.requests.length === 0 || entry.responses.length === 0
		);
		const invalidRustExecutableStorageResponses = rustExecutableGraphStorageEvidence.flatMap(
			(entry) =>
				entry.responses
					.filter(
						(response) =>
							!response.ok ||
							responseMediaType(response.contentType) !==
								'application/octet-stream' ||
							(entry.encoding === 'gzip' && response.contentEncoding !== null)
					)
					.map((response) => ({
						encoding: entry.encoding,
						modulePath: entry.modulePath,
						response
					}))
		);
		const networkEvidence = {
			rustExecutableGraphStorageEvidence,
			rustExecutableHttpRequests,
			rustLogicalModuleHttpRequests,
			unexpectedRustExecutableStorageRequests
		};
		if (rustLogicalModuleHttpRequests.length > 0 || rustExecutableHttpRequests.length > 0) {
			throw new Error(
				`Rust requested logical executable modules over HTTP(S) instead of using its verified Blob graph\n${JSON.stringify({ ...summary, ...networkEvidence }, null, 2)}`
			);
		}
		if (unexpectedRustExecutableStorageRequests.length > 0) {
			throw new Error(
				`Rust executable graph storage was requested without its exact receipt URL\n${JSON.stringify({ ...summary, ...networkEvidence }, null, 2)}`
			);
		}
		if (missingRustExecutableStorage.length > 0) {
			throw new Error(
				`Rust executable graph storage requests or responses were missing\n${JSON.stringify({ ...summary, ...networkEvidence, missingRustExecutableStorage }, null, 2)}`
			);
		}
		if (invalidRustExecutableStorageResponses.length > 0) {
			throw new Error(
				`Rust executable graph storage responses violated the inert delivery contract\n${JSON.stringify({ ...summary, ...networkEvidence, invalidRustExecutableStorageResponses }, null, 2)}`
			);
		}

		return { ...summary, ...networkEvidence };
	} finally {
		await browser.close();
	}
}
