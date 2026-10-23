// @vitest-environment node

import { expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_RUST_LLDB_ENTRY === '1';
const source = `fn main() {
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).unwrap();
    let mut value: i32 = input.trim().parse().unwrap();
    value += 5; // breakpoint
    println!("rust-lldb-entry={value}");
}`;

it(
	'first pauses inside Rust main, then reaches a source breakpoint and steps with stdin/stdout',
	{ skip: !enabled, timeout: 600_000, meta: { browser: true, requiredBrowser: enabled } },
	async () => {
		const browserUrl = process.env.WASM_IDLE_BROWSER_URL;
		if (!browserUrl) throw new Error('Set WASM_IDLE_BROWSER_URL to the running dev server.');
		const browser = await chromium.launch({
			executablePath: await resolveChromiumExecutable(),
			headless: true
		});
		const context = await browser.newContext();
		await addBrowserTestCookies(context, browserUrl);
		const page = await context.newPage();
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		const probeUrl = new URL('__rust_lldb_entry_probe__', browserUrl).href;
		await page.route(probeUrl, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'text/html',
				headers: {
					'Cross-Origin-Opener-Policy': 'same-origin',
					'Cross-Origin-Embedder-Policy': 'require-corp'
				},
				body: '<!doctype html><title>Rust LLDB entry regression</title>'
			})
		);
		try {
			await page.goto(probeUrl);
			const result = await page.evaluate(
				async ({ browserUrl, source }) => {
					const moduleUrl = new URL('src/lib/playground/rust.ts', browserUrl).href;
					const { default: Rust } = await new Function('url', 'return import(url)')(
						moduleUrl
					);
					const { createApplicationRuntimeAssets } = await new Function(
						'url',
						'return import(url)'
					)(new URL('src/lib/playground/applicationAssets.ts', browserUrl).href);
					const sandbox = new Rust();
					let output = '';
					let callbackError = '';
					const pauses: any[] = [];
					const breakpointLine =
						source.split('\n').findIndex((line) => line.includes('// breakpoint')) + 1;
					sandbox.output = (chunk: string) => {
						output += chunk;
					};
					sandbox.ondebug = (event: any) => {
						if (event.type !== 'pause') return;
						const pause = { ...event, variables: [] as any[] };
						pauses.push(pause);
						void (async () => {
							if (pauses.length === 2) {
								for (const scope of event.scopes || []) {
									if (!scope.expensive)
										pause.variables.push(
											...(await sandbox.debugVariables(
												scope.variablesReference
											))
										);
								}
								await sandbox.debugCommand('nextLine');
							} else {
								await sandbox.debugCommand('continue');
							}
						})().catch(async (error) => {
							callbackError = String(error);
							await sandbox.terminate();
						});
					};
					try {
						await sandbox.load(createApplicationRuntimeAssets(browserUrl), '', false);
						const completed = await sandbox.run(source, false, false, undefined, [], {
							debugMode: 'lldb',
							pauseOnEntry: true,
							activePath: 'solution.rs',
							breakpoints: [breakpointLine],
							stdin: '68\n',
							limits: { compileTimeoutMs: 300_000, runTimeoutMs: 120_000 }
						});
						return {
							completed,
							output,
							pauses,
							callbackError,
							breakpointLine,
							error: ''
						};
					} catch (error) {
						return {
							completed: false,
							output,
							pauses,
							callbackError,
							breakpointLine,
							error: String(error)
						};
					} finally {
						await sandbox.terminate();
						await sandbox.dispose?.();
					}
				},
				{ browserUrl, source }
			);
			console.info(
				'[rust-lldb-entry]',
				JSON.stringify({
					completed: result.completed,
					error: result.error,
					callbackError: result.callbackError,
					output: result.output.slice(-2000),
					pauses: result.pauses.map(
						({ reason, stoppedReason, line, sourcePath, callStack }) => ({
							reason,
							stoppedReason,
							line,
							sourcePath,
							frame: callStack[0]
						})
					)
				})
			);
			expect(result.error, result.output.slice(-2000)).toBe('');
			expect(result.callbackError).toBe('');
			expect(result.completed).toBe(true);
			expect(result.output).toContain('rust-lldb-entry=73');
			expect(result.pauses.length).toBeGreaterThanOrEqual(3);
			expect(result.pauses[0]).toMatchObject({
				reason: 'entry',
				stoppedReason: 'entry',
				sourcePath: '/workspace/solution.rs'
			});
			expect(result.pauses[0].callStack[0]).toMatchObject({
				functionName: 'main::main',
				sourcePath: '/workspace/solution.rs'
			});
			expect(result.pauses[0].line).toBeGreaterThan(0);
			expect(result.pauses[0].line).toBeLessThan(result.breakpointLine);
			expect(result.pauses[1]).toMatchObject({
				reason: 'breakpoint',
				line: result.breakpointLine,
				sourcePath: '/workspace/solution.rs'
			});
			expect(result.pauses[1].variables).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: 'value', value: '68' })])
			);
			expect(result.pauses[2].sourcePath).toBe('/workspace/solution.rs');
			expect(result.pauses[2].line).toBeGreaterThan(result.breakpointLine);
			expect(pageErrors).toEqual([]);
		} finally {
			await context.close();
			await browser.close();
		}
	}
);
