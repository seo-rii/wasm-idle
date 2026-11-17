// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_GRAPHQL === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };
const query = 'type Query { greeting: String! } query { greeting }';

describe.skipIf(!enabled)('real GraphQL reference implementation in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4993',
			serverMode: 'dev'
		});
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 120_000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it(
		'runs fresh schemas and queries with delayed JSON stdin, EOF, diagnostics, cancellation and recovery',
		{ timeout: 120_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			try {
				const harness = `${server.browserUrl.replace(/\/$/u, '')}/graphql-runtime-harness`;
				await context.route(harness, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>GraphQL runtime</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(harness, { waitUntil: 'domcontentloaded' });
				const base = `${server.browserUrl.replace(/\/$/u, '')}/`;
				await page.addScriptTag({
					type: 'module',
					content: `import Graphql from ${JSON.stringify(base + 'src/lib/playground/graphql.ts')}; globalThis.__Graphql = Graphql;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Graphql));
				const results = await page.evaluate(
					async ({ base, query }) => {
						const sandbox = new (globalThis as any).__Graphql();
						await sandbox.load({ rootUrl: new URL(base).pathname.replace(/\/$/u, '') });
						const run = async (
							code: string,
							options: Record<string, unknown> = {},
							progress?: unknown
						) => {
							let output = '';
							const diagnostics: unknown[] = [];
							sandbox.output = (text: string) => (output += text);
							sandbox.oncompilerdiagnostic = (diagnostic: unknown) =>
								diagnostics.push(diagnostic);
							try {
								const value = await sandbox.run(
									code,
									false,
									false,
									progress,
									[],
									options
								);
								return { value, output, diagnostics, error: '' };
							} catch (error) {
								return {
									output,
									diagnostics,
									error: (error as { code?: string }).code || String(error)
								};
							}
						};
						try {
							let sent = false;
							const delayed = await run(
								query,
								{},
								{
									report(event: { kind?: string; reason?: string }) {
										if (
											sent ||
											event.kind !== 'ready' ||
											event.reason !== 'stdin-request'
										)
											return;
										sent = true;
										setTimeout(() => {
											sandbox.write('{"rootValue":');
										}, 20);
										setTimeout(() => {
											sandbox.write('{"greeting":"안녕 GraphQL"}}');
											sandbox.eof();
										}, 40);
									}
								}
							);
							const empty = await run('type Query { x: Int } { __typename }', {
								stdin: ''
							});
							const invalid = await run('type Query { x: Int }\n{ missing }', {
								stdin: ''
							});
							const malformed = await run(query, { stdin: '{bad' });
							const schemaFile = await run('{ count }', {
								stdin: '{"rootValue":{"count":17}}',
								workspaceFiles: [
									{
										path: 'schema.graphql',
										content: 'type Query { count: Int! }'
									}
								]
							});
							const abort = new AbortController();
							let aborted = false;
							const cancelled = await run(
								query,
								{ signal: abort.signal },
								{
									report(event: { kind?: string; reason?: string }) {
										if (
											aborted ||
											event.kind !== 'ready' ||
											event.reason !== 'stdin-request'
										)
											return;
										aborted = true;
										setTimeout(() => abort.abort(), 20);
									}
								}
							);
							const recovered = await run(query, {
								stdin: '{"rootValue":{"greeting":"after cancellation"}}'
							});
							const limited = await run(query, {
								stdin: '{"rootValue":{"greeting":"too much output"}}',
								limits: { maxOutputBytes: 8 }
							});
							const afterLimit = await run(query, {
								stdin: '{"rootValue":{"greeting":"after limit"}}'
							});
							return {
								sent,
								aborted,
								delayed,
								empty,
								invalid,
								malformed,
								schemaFile,
								cancelled,
								recovered,
								limited,
								afterLimit
							};
						} finally {
							await sandbox.dispose();
						}
					},
					{ base, query }
				);
				expect(results.sent).toBe(true);
				expect(results.delayed).toMatchObject({
					value: true,
					output: '{"data":{"greeting":"안녕 GraphQL"}}\n',
					diagnostics: []
				});
				expect(results.empty).toMatchObject({
					value: true,
					output: '{"data":{"__typename":"Query"}}\n'
				});
				expect(results.invalid.value).toBe(false);
				expect(results.invalid.diagnostics).toMatchObject([
					{ lineNumber: 2, columnNumber: 3 }
				]);
				expect(results.malformed.value).toBe(false);
				expect(results.schemaFile.output).toBe('{"data":{"count":17}}\n');
				expect(results.cancelled.error).toBe('cancelled');
				expect(results.recovered.output).toContain('after cancellation');
				expect(results.limited.error).toBe('output-limit');
				expect(results.afterLimit.output).toContain('after limit');
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the default GRAPHQL editor sample through the language selector and preloaded stdin',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			try {
				await page.goto(`${server.browserUrl}?lang=graphql`, {
					waitUntil: 'domcontentloaded'
				});
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.locator('#language-select').selectOption('GRAPHQL');
				await page.waitForFunction(() =>
					Boolean((window as any).__wasmIdleDebug?.getEditorValue?.())
				);
				await page
					.getByLabel('Preloaded stdin')
					.fill(
						'{"rootValue":{"greeting":"Hello GraphQL!","numbers":[1,2,3]},"variables":{"showNumbers":true}}'
					);
				await page.evaluate(
					(source) => (window as any).__wasmIdleDebug.setEditorValue(source),
					editorDefaults.graphql
				);
				const previous = await page.evaluate(
					() => (window as any).__wasmIdleDebug.getExecutionState().id
				);
				await page.getByRole('button', { name: 'Run', exact: true }).click();
				await page.waitForFunction(
					(previous) => {
						const state = (window as any).__wasmIdleDebug.getExecutionState();
						return state.id > previous && state.endedAt !== null;
					},
					previous,
					{ timeout: 120_000 }
				);
				const snapshot = await page.evaluate(() => ({
					state: (window as any).__wasmIdleDebug.getExecutionState(),
					transcript:
						document.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent || ''
				}));
				expect(snapshot.state).toMatchObject({
					language: 'GRAPHQL',
					status: 'completed',
					exitCode: 0
				});
				expect(snapshot.transcript).toContain('"__typename":"Query"');
				expect(snapshot.transcript).toContain(
					'"greeting":"Hello GraphQL!","numbers":[1,2,3]'
				);
			} finally {
				await context.close();
			}
		}
	);
});
