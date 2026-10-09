// @vitest-environment node

import { chromium, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';
import type { SandboxExecutionOptions } from './options';
import type { Sandbox } from './sandbox';

type InterpreterCase = {
	name: string;
	source: string;
	stdin: string;
	output?: string;
	fails?: boolean;
	configurationError?: boolean;
	options?: Pick<SandboxExecutionOptions, 'activePath' | 'workspaceFiles'>;
};

type InterpreterBrowserProfile = {
	language: string;
	enabled: boolean;
	defaultSource: () => string;
	echoSource: string;
	infiniteSource: string;
	runtimePath: string;
	cases: InterpreterCase[];
};

type InterpreterResult = {
	name: string;
	output: string;
	result?: boolean | string;
	inputRequests: number;
	elapsedMs: number;
	error?: {
		message: string;
		code?: string;
		phase?: string;
		actual?: number;
		limit?: number;
	};
};

const profiles: InterpreterBrowserProfile[] = [
	{
		language: 'BRAINFUCK',
		enabled: process.env.WASM_IDLE_RUN_REAL_BROWSER_BRAINFUCK === '1',
		defaultSource: () => editorDefaults.brainfuck,
		echoSource: ',[.,]',
		infiniteSource: '+[]',
		runtimePath: 'wasm-brainfuck/brainfuck.wasm',
		cases: [
			{
				name: 'utf8-explicit-eof',
				source: ',[.,]',
				stdin: '첫째 줄 🦀\nsecond line\n',
				output: '첫째 줄 🦀\nsecond line\n'
			},
			{
				name: 'leading-utf8-bom',
				source: ',[.,]',
				stdin: '\ufeffBOM 한글 🦀\n',
				output: '\ufeffBOM 한글 🦀\n'
			},
			{
				name: 'leading-utf8-bom-without-newline',
				source: ',[.,]',
				stdin: '\ufeffx',
				output: '\ufeffx'
			},
			{
				name: 'nested-unicode-source-path',
				source: ',[.,]',
				stdin: '경로 🦀\n',
				output: '경로 🦀\n',
				options: { activePath: 'examples/한글🦀.bf' }
			},
			{
				name: 'ascii-source-path-byte-boundary',
				source: '+'.repeat(65) + '.',
				stdin: '',
				output: 'A',
				options: { activePath: 'a'.repeat(59) + '.bf' }
			},
			{
				name: 'unicode-source-path-byte-boundary',
				source: '+'.repeat(65) + '.',
				stdin: '',
				output: 'A',
				options: { activePath: '한'.repeat(19) + 'ab.bf' }
			},
			{
				name: 'ascii-source-path-byte-overflow',
				source: '+'.repeat(65) + '.',
				stdin: '',
				configurationError: true,
				options: { activePath: 'a'.repeat(60) + '.bf' }
			},
			{
				name: 'unicode-source-path-byte-overflow',
				source: '+'.repeat(65) + '.',
				stdin: '',
				configurationError: true,
				options: { activePath: '한'.repeat(20) + '.bf' }
			},
			{
				name: 'truncated-source-path-collision',
				source: '+'.repeat(65) + '.',
				stdin: '',
				configurationError: true,
				options: {
					activePath: 'a'.repeat(62) + '.bf',
					workspaceFiles: [{ path: 'a'.repeat(62), content: '+'.repeat(66) + '.' }]
				}
			},
			{
				name: 'after-source-path-rejection',
				source: ',[.,]',
				stdin: 'path-recovered\n',
				output: 'path-recovered\n'
			},
			{ name: 'empty-explicit-eof', source: ',[.,]', stdin: '', output: '' },
			{ name: 'partial-explicit-stdin', source: ',.', stdin: 'AB', output: 'A' },
			{
				name: 'fresh-stdin',
				source: ',[.,]',
				stdin: 'C',
				output: 'C'
			},
			{
				name: 'nested-loops',
				source: '++[>+++[>++++++++++<-]<-]>>+++++.',
				stdin: '',
				output: 'A'
			},
			{
				name: '8bit-cell-wrap',
				// A nonwrapping cell enters the branch and prints B instead of A.
				source: '+'.repeat(256) + '[[-]>+<]>' + '+'.repeat(65) + '.',
				stdin: '',
				output: 'A'
			},
			{ name: 'seed-tape', source: '+++++>+++++', stdin: '', output: '' },
			{ name: 'fresh-tape', source: '.>.', stdin: '', output: '\0\0' },
			{ name: 'unclosed-loop', source: '[+', stdin: '', fails: true },
			{ name: 'unexpected-loop-end', source: ']', stdin: '', fails: true },
			{
				name: 'after-parse-failure',
				source: ',[.,]',
				stdin: 'parse-recovered\n',
				output: 'parse-recovered\n'
			}
		]
	}
];

async function withBrowserPreview(action: (browserUrl: string) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		const configuredUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const configured = configuredUrl ? new URL(configuredUrl) : undefined;
		const previewMode = process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'preview';
		const previousReuse = process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
		let server: { browserUrl: string; close: () => Promise<void> };
		try {
			// The direct-consumer test imports a source module that built previews do not serve.
			if (previewMode) process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = '0';
			server =
				!previewMode && shouldReuseProvidedBrowserUrl(configuredUrl)
					? { browserUrl: configuredUrl, close: async () => {} }
					: await startBrowserPreviewServer({
							origin: configured?.origin ?? 'http://127.0.0.1:4980',
							...(configured ? { basePath: configured.pathname } : {}),
							serverMode: 'dev'
						});
		} finally {
			if (previewMode) {
				if (previousReuse === undefined) delete process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
				else process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = previousReuse;
			}
		}
		try {
			await action(server.browserUrl);
		} finally {
			await server.close();
		}
	});
}

async function prepareConsumerPage(page: Page, browserUrl: string) {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		try {
			await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
			await page.evaluate(async () => {
				if (!navigator.serviceWorker) return;
				await Promise.race([
					navigator.serviceWorker.ready,
					new Promise((resolve) => setTimeout(resolve, 1_500))
				]);
			});
			if (
				await page.evaluate(
					() =>
						crossOriginIsolated &&
						typeof SharedArrayBuffer !== 'undefined' &&
						Boolean(navigator.serviceWorker?.controller)
				)
			)
				break;
		} catch (error) {
			// The isolation service worker reloads the first uncontrolled document.
			if (
				!String(error).includes('Execution context was destroyed') &&
				!String(error).includes('net::ERR_ABORTED')
			)
				throw error;
			await page.waitForTimeout(250);
		}
	}
	await page.waitForFunction(
		() =>
			crossOriginIsolated &&
			typeof SharedArrayBuffer !== 'undefined' &&
			Boolean(navigator.serviceWorker?.controller)
	);
	const base = new URL('./', browserUrl);
	const moduleUrl = new URL('src/lib/playground/index.ts', base).href;
	await page.addScriptTag({
		type: 'module',
		content: `import playground from ${JSON.stringify(moduleUrl)}; globalThis.__esolangPlayground = playground;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__esolangPlayground));
	return base.pathname;
}

async function runInterpreterBrowserCases(
	page: Page,
	profile: InterpreterBrowserProfile,
	rootUrl: string
) {
	return await page.evaluate(
		async ({ language, cases, echoSource, infiniteSource, rootUrl }) => {
			const playground = (globalThis as any).__esolangPlayground as (
				language: string
			) => Promise<Sandbox>;
			const sandbox = await playground(language);
			const results: InterpreterResult[] = [];
			let output = '';
			sandbox.output = (text) => {
				output += text;
			};
			async function run(
				name: string,
				source: string,
				options: SandboxExecutionOptions = {},
				interact?: (inputReady: Promise<void>) => Promise<void>
			) {
				// Reload also creates a new worker after a timeout, output limit, or Stop.
				await sandbox.load({ rootUrl });
				output = '';
				const started = performance.now();
				let inputRequests = 0;
				let markInputReady!: () => void;
				const inputReady = new Promise<void>((resolve) => {
					markInputReady = resolve;
				});
				try {
					const pending = sandbox.run(
						source,
						false,
						false,
						{
							report(event) {
								if (event.kind === 'ready' && event.reason === 'stdin-request') {
									inputRequests += 1;
									markInputReady();
								}
							}
						},
						[],
						options
					);
					// Cancellation may settle before the interaction callback returns.
					void pending.catch(() => {});
					if (interact) {
						let timeout: ReturnType<typeof setTimeout> | undefined;
						try {
							await Promise.race([
								interact(inputReady),
								new Promise<never>((_, reject) => {
									timeout = setTimeout(
										() =>
											reject(new Error('Interpreter did not request stdin')),
										10_000
									);
								})
							]);
						} finally {
							clearTimeout(timeout);
						}
					}
					const result = await pending;
					results.push({
						name,
						result,
						output,
						inputRequests,
						elapsedMs: performance.now() - started
					});
				} catch (error) {
					const details = error as InterpreterResult['error'];
					results.push({
						name,
						output,
						inputRequests,
						elapsedMs: performance.now() - started,
						error: {
							message: details?.message ?? String(error),
							code: details?.code,
							phase: details?.phase,
							actual: details?.actual,
							limit: details?.limit
						}
					});
					// Retire a still-running worker if the test's stdin deadline failed.
					if (details?.message === 'Interpreter did not request stdin')
						await sandbox.terminate();
				}
			}
			try {
				for (const testCase of cases)
					await run(testCase.name, testCase.source, {
						...testCase.options,
						stdin: testCase.stdin
					});

				await run('streaming-eof', echoSource, {}, async (inputReady) => {
					await inputReady;
					await new Promise((resolve) => setTimeout(resolve, 75));
					sandbox.write?.('stream 한글 🦀\n');
					sandbox.write?.('second chunk\n');
					sandbox.eof();
				});

				await run('output-limit', echoSource, {
					stdin: '가'.repeat(512),
					limits: { maxOutputBytes: 1024 }
				});
				await run('after-output-limit', echoSource, { stdin: 'output-recovered\n' });

				await run('infinite-loop-timeout', infiniteSource, {
					stdin: '',
					limits: { compileTimeoutMs: 1, runTimeoutMs: 500 }
				});
				await run('after-timeout', echoSource, { stdin: 'timeout-recovered\n' });

				const controller = new AbortController();
				await run(
					'abort-stdin-wait',
					echoSource,
					{ signal: controller.signal },
					async (inputReady) => {
						await inputReady;
						controller.abort(new Error('browser interpreter abort'));
					}
				);
				await run('after-abort', echoSource, { stdin: 'abort-recovered\n' });

				await run('stop-stdin-wait', echoSource, {}, async (inputReady) => {
					await inputReady;
					await sandbox.terminate();
				});
				await run('after-stop', echoSource, { stdin: 'stop-recovered\n' });

				await sandbox.terminate();
				await run('after-explicit-reload', echoSource, { stdin: 'reload-recovered\n' });
			} finally {
				await sandbox.dispose?.();
			}
			return { crossOriginIsolated, results };
		},
		{
			language: profile.language,
			cases: profile.cases,
			echoSource: profile.echoSource,
			infiniteSource: profile.infiniteSource,
			rootUrl
		}
	);
}

for (const profile of profiles) {
	const browserMeta = { browser: true, requiredBrowser: profile.enabled };
	describe.skipIf(!profile.enabled)(`real ${profile.language} browser interpreter`, () => {
		it(
			'runs the default editor sample with UTF-8 terminal input and EOF',
			{ timeout: 180_000, meta: browserMeta },
			async () => {
				await withBrowserPreview(async (browserUrl) => {
					const summary = await runStdinBrowserProbe({
						browserUrl,
						language: profile.language,
						source: profile.defaultSource(),
						stdinText: 'default 한글 🦀\n',
						expectedOutput: 'default 한글 🦀',
						sendEof: true,
						checkLoadingProgress: false
					});
					expect(summary.transcript).toContain('default 한글 🦀');
					expect(summary.pageErrors).toEqual([]);
					expect(
						summary.runtimeRequests.some((request: string) =>
							new URL(request).pathname.endsWith(profile.runtimePath)
						)
					).toBe(true);
				});
			}
		);

		it(
			'uses the real WASI interpreter for byte I/O, language semantics, failures and recovery',
			{ timeout: 180_000, meta: browserMeta },
			async () => {
				await withBrowserPreview(async (browserUrl) => {
					const browser = await chromium.launch({
						headless: true,
						executablePath: await resolveChromiumExecutable(
							process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
						)
					});
					const pageErrors: string[] = [];
					try {
						const context = await browser.newContext();
						await addBrowserTestCookies(context, browserUrl);
						await disableBrowserPrewarm(context);
						const page = await context.newPage();
						page.setDefaultTimeout(60_000);
						page.on('pageerror', (error) => pageErrors.push(error.message));
						const rootUrl = await prepareConsumerPage(page, browserUrl);
						const report = await runInterpreterBrowserCases(page, profile, rootUrl);
						expect(report.crossOriginIsolated).toBe(true);
						const byName = Object.fromEntries(
							report.results.map((result) => [result.name, result])
						);
						for (const testCase of profile.cases) {
							const result = byName[testCase.name];
							if (testCase.configurationError) {
								expect(result.error, JSON.stringify(result)).toMatchObject({
									code: 'runtime-configuration',
									phase: 'configuration'
								});
								expect(result.error?.message).toMatch(/source path.+62/iu);
								expect(result.output).toBe('');
								expect(result.inputRequests).toBe(0);
							} else if (testCase.fails) {
								expect(result.error, JSON.stringify(result)).toBeDefined();
								expect(result.error?.message).toMatch(/exited|bracket|syntax/iu);
							} else {
								expect(result.error, JSON.stringify(result)).toBeUndefined();
								expect(result.result).toBe(true);
								expect(result.output).toBe(testCase.output);
							}
						}
						expect(byName['streaming-eof'].error).toBeUndefined();
						expect(byName['streaming-eof'].inputRequests).toBeGreaterThan(0);
						expect(byName['streaming-eof'].output).toBe(
							'stream 한글 🦀\nsecond chunk\n'
						);
						expect(byName['output-limit'].error).toMatchObject({
							code: 'output-limit',
							phase: 'execute',
							limit: 1024
						});
						expect(byName['output-limit'].error?.actual).toBeGreaterThan(1024);
						expect(
							new TextEncoder().encode(byName['output-limit'].output).length
						).toBeLessThanOrEqual(1024);
						expect(byName['infinite-loop-timeout'].error).toMatchObject({
							code: 'timeout',
							phase: 'execute'
						});
						expect(byName['infinite-loop-timeout'].elapsedMs).toBeLessThan(10_000);
						expect(byName['abort-stdin-wait'].inputRequests).toBeGreaterThan(0);
						expect(byName['abort-stdin-wait'].error?.message).toBe(
							'browser interpreter abort'
						);
						expect(byName['stop-stdin-wait'].inputRequests).toBeGreaterThan(0);
						expect(byName['stop-stdin-wait'].error?.message).toBe('Process terminated');
						for (const [name, output] of [
							['after-output-limit', 'output-recovered\n'],
							['after-timeout', 'timeout-recovered\n'],
							['after-abort', 'abort-recovered\n'],
							['after-stop', 'stop-recovered\n'],
							['after-explicit-reload', 'reload-recovered\n']
						]) {
							expect(
								byName[name].error,
								JSON.stringify(byName[name])
							).toBeUndefined();
							expect(byName[name].result).toBe(true);
							expect(byName[name].output).toBe(output);
						}
						expect(pageErrors).toEqual([]);
					} finally {
						await browser.close();
					}
				});
			}
		);
	});
}
