// @vitest-environment node

import { chromium, type CDPSession, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const workerRetireTimeoutMs = 5_000;
const bashStdinSource = `IFS= read -r value
printf 'main=%d\\n' "$(( value + 5 ))"
`;

interface WorkerTarget {
	targetId: string;
	title: string;
	type: string;
	url: string;
}

async function readDedicatedWorkerTargets(cdp: CDPSession): Promise<WorkerTarget[]> {
	const { targetInfos } = await cdp.send('Target.getTargets');
	return targetInfos
		.filter(({ type }) => type === 'worker')
		.map(({ targetId, title, type, url }) => ({ targetId, title, type, url }));
}

function isNestedBashWorker(target: WorkerTarget) {
	return /\/wasm-bash\/sdk\/worker\.mjs(?:[?#]|$)/u.test(target.url);
}

function isBundledBashWorker(target: WorkerTarget) {
	return (
		/\/_app\/immutable\/workers\/bash-[^/?#]+\.js(?:[?#]|$)/u.test(target.url) ||
		/\/src\/lib\/playground\/worker\/bash\.ts(?:[?#]|$)/u.test(target.url) ||
		/\/@fs\/[^?#]*\/src\/lib\/playground\/worker\/bash\.ts(?:[?#]|$)/u.test(target.url)
	);
}

async function waitForBashWorkerGeneration(
	cdp: CDPSession,
	baselineTargetIds: ReadonlySet<string>,
	timeoutMs: number
) {
	const deadline = Date.now() + timeoutMs;
	let latestCandidates: WorkerTarget[] = [];
	while (Date.now() < deadline) {
		latestCandidates = (await readDedicatedWorkerTargets(cdp)).filter(
			({ targetId }) => !baselineTargetIds.has(targetId)
		);
		const nested = latestCandidates.filter(isNestedBashWorker);
		const knownOuter = latestCandidates.filter(isBundledBashWorker);
		const nonNested = latestCandidates.filter((target) => !isNestedBashWorker(target));
		const outer = knownOuter.length > 0 ? knownOuter : nonNested.length === 1 ? nonNested : [];
		if (outer.length > 0 && nested.length > 0) {
			return { nested, outer };
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`Bash outer/nested workers did not become observable within ${timeoutMs}ms\n${JSON.stringify(
			latestCandidates,
			null,
			2
		)}`
	);
}

async function waitForWorkerTargetsToRetire(
	cdp: CDPSession,
	targetIds: ReadonlySet<string>,
	timeoutMs: number
) {
	const deadline = Date.now() + timeoutMs;
	let remaining: WorkerTarget[] = [];
	while (Date.now() < deadline) {
		remaining = (await readDedicatedWorkerTargets(cdp)).filter(({ targetId }) =>
			targetIds.has(targetId)
		);
		if (remaining.length === 0) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`cancelled Bash worker targets survived longer than ${timeoutMs}ms\n${JSON.stringify(
			remaining,
			null,
			2
		)}`
	);
}

async function setEditorSource(page: Page, source: string, timeoutMs: number) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const installed = await page.evaluate(
			async (nextSource) =>
				(await (globalThis as any).__wasmIdleDebug?.setEditorValue?.(nextSource)) === true,
			source
		);
		if (!installed) {
			await page.waitForTimeout(250);
			continue;
		}
		await page.waitForTimeout(250);
		const retained = await page.evaluate(
			(expectedSource) =>
				(globalThis as any).__wasmIdleDebug?.getEditorValue?.() === expectedSource,
			source
		);
		if (retained) return;
	}
	throw new Error(`Bash editor did not retain the requested source within ${timeoutMs}ms`);
}

async function waitForControlledBashPage(page: Page, browserUrl: string, timeoutMs: number) {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1_500 + attempt * 500);
		const ready = await page.evaluate(
			() =>
				crossOriginIsolated &&
				typeof SharedArrayBuffer !== 'undefined' &&
				!!navigator.serviceWorker?.controller
		);
		if (ready) return;
		await page.evaluate(async () => {
			if (!navigator.serviceWorker) return;
			await Promise.race([
				navigator.serviceWorker.ready,
				new Promise((resolve) => setTimeout(resolve, 1_500))
			]);
		});
	}
	throw new Error(
		`Bash cancellation page was not service-worker controlled within ${timeoutMs}ms`
	);
}

async function runBashCancellationProbe(browserUrl: string, runTimeoutMs: number) {
	const browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		)
	});
	const cdp = await browser.newBrowserCDPSession();
	await cdp.send('Target.setDiscoverTargets', { discover: true });
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
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

	try {
		await waitForControlledBashPage(page, browserUrl, runTimeoutMs);
		await page.evaluate(() => localStorage.clear());
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(
			() =>
				crossOriginIsolated &&
				typeof SharedArrayBuffer !== 'undefined' &&
				!!navigator.serviceWorker?.controller &&
				typeof (globalThis as any).__wasmIdleDebug?.setEditorValue === 'function',
			undefined,
			{ timeout: runTimeoutMs }
		);
		const baselineTargetIds = new Set(
			(await readDedicatedWorkerTargets(cdp)).map(({ targetId }) => targetId)
		);

		await page.locator('select').first().selectOption('BASH');
		await page.waitForFunction(
			() =>
				document.querySelector('select')?.value === 'BASH' &&
				typeof (globalThis as any).__wasmIdleDebug?.setEditorValue === 'function',
			undefined,
			{ timeout: runTimeoutMs }
		);
		await page.locator('button.action-button--run').waitFor({ state: 'visible' });

		const retiredTargetIds = new Set<string>();
		for (let cycle = 1; cycle <= 3; cycle += 1) {
			const marker = `bash-cancel-${cycle}-ready`;
			await setEditorSource(
				page,
				`printf '${marker}\\n'\nwhile :; do :; done\n`,
				runTimeoutMs
			);
			const initialTranscript =
				(await page.locator('[data-testid="terminal-debug-output"]').textContent()) || '';
			await page.locator('button.action-button--run').click();
			try {
				await page.waitForFunction(
					({ initial, expectedMarker }) => {
						const transcript =
							document.querySelector('[data-testid="terminal-debug-output"]')
								?.textContent || '';
						const delta = transcript.startsWith(initial)
							? transcript.slice(initial.length)
							: transcript;
						return (
							delta.includes(expectedMarker) &&
							document
								.querySelector('button.action-button--stop')
								?.textContent?.includes('Stop Running') === true
						);
					},
					{ initial: initialTranscript, expectedMarker: marker },
					{ polling: 50, timeout: runTimeoutMs }
				);
			} catch (error) {
				throw new Error(
					`Bash cancellation cycle ${cycle} did not reach its marker: ${String(error)}\n${JSON.stringify(
						{
							pageErrors,
							transcript:
								(await page
									.locator('[data-testid="terminal-debug-output"]')
									.textContent()
									.catch(() => '')) || '',
							workers: await readDedicatedWorkerTargets(cdp)
						},
						null,
						2
					)}`
				);
			}

			const generation = await waitForBashWorkerGeneration(
				cdp,
				baselineTargetIds,
				workerRetireTimeoutMs
			);
			const generationTargetIds = new Set(
				[...generation.outer, ...generation.nested].map(({ targetId }) => targetId)
			);
			for (const targetId of generationTargetIds) {
				expect(retiredTargetIds.has(targetId)).toBe(false);
			}

			await page.locator('button.action-button--stop', { hasText: 'Stop Running' }).click();
			await Promise.all([
				page
					.locator('button.action-button--run')
					.waitFor({ state: 'visible', timeout: workerRetireTimeoutMs }),
				waitForWorkerTargetsToRetire(cdp, generationTargetIds, workerRetireTimeoutMs)
			]);
			for (const targetId of generationTargetIds) retiredTargetIds.add(targetId);
		}

		const retryMarker = 'bash-cancel-retry-ok';
		await setEditorSource(page, `printf '${retryMarker}\\n'\n`, runTimeoutMs);
		const retryInitialTranscript =
			(await page.locator('[data-testid="terminal-debug-output"]').textContent()) || '';
		await page.locator('button.action-button--run').click();
		await page.waitForFunction(
			({ initial, expectedMarker }) => {
				const transcript =
					document.querySelector('[data-testid="terminal-debug-output"]')?.textContent ||
					'';
				const delta = transcript.startsWith(initial)
					? transcript.slice(initial.length)
					: transcript;
				return delta.includes(expectedMarker) && delta.includes('Process finished after');
			},
			{ initial: retryInitialTranscript, expectedMarker: retryMarker },
			{ polling: 50, timeout: runTimeoutMs }
		);
		expect(pageErrors).toEqual([]);
	} finally {
		await page.close().catch(() => {});
		await context.close().catch(() => {});
		await cdp.detach().catch(() => {});
		await browser.close().catch(() => {});
	}
}

describe('wasm-idle Bash browser playwright integration', () => {
	it('runs stdin and repeatedly cancels and retries the real GNU Bash WASIX runtime', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_BASH !== '1') return;

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(
					[
						'sync:wasm-bash',
						'build:static-runtime-modules',
						'compress:static-runtimes',
						'build:preview'
					],
					{ timeoutMs: Number(process.env.WASM_IDLE_BASH_PREP_TIMEOUT_MS || '900000') }
				);
			}
			const previewServer = reuseProvidedBrowserUrl
				? {
						origin: new URL(configuredBrowserUrl).origin,
						browserUrl: configuredBrowserUrl,
						close: async () => {}
					}
				: await startBrowserPreviewServer(
						configuredBrowserUrl
							? {
									origin: new URL(configuredBrowserUrl).origin,
									basePath: new URL(configuredBrowserUrl).pathname,
									serverMode
								}
							: { origin: 'http://127.0.0.1:4682', serverMode }
					);

			try {
				const stdinSummary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'BASH',
					preloadStdin: true,
					runTimeoutMs: Number(process.env.WASM_IDLE_BASH_RUN_TIMEOUT_MS || '180000'),
					source: bashStdinSource,
					stdinText: '68\n'
				});
				expect(stdinSummary.activeState.crossOriginIsolated).toBe(true);
				expect(stdinSummary.activeState.sharedArrayBuffer).toBe(true);
				expect(stdinSummary.pageErrors).toEqual([]);
				expect(stdinSummary.transcript).toContain('main=73');
				expect(stdinSummary.transcript).toContain('Process finished after');

				await runBashCancellationProbe(
					previewServer.browserUrl,
					Number(process.env.WASM_IDLE_BASH_RUN_TIMEOUT_MS || '180000')
				);
			} finally {
				await previewServer.close();
			}
		});
	}, 960_000);
});
