// @vitest-environment node
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../scripts/browser-test-prewarm.mjs';
import {
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { prepareContainerRuntimePage } from '../../scripts/container-runtime-browser-observer.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_COMPILER_OPTIONS === '1';

describe('compiler options in the playground', () => {
	it(
		'compiles C and C++ with selected flags, separate argv, and restored settings',
		{
			skip: !enabled,
			timeout: 300_000,
			meta: { browser: true, requiredBrowser: enabled }
		},
		async () => {
			const providedUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const server = shouldReuseProvidedBrowserUrl(providedUrl)
				? { browserUrl: providedUrl, close: async () => {} }
				: await startBrowserPreviewServer({
						origin: 'http://127.0.0.1:4813',
						serverMode: 'dev'
					});
			const browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable(
					process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
				)
			});
			const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
			await addBrowserTestCookies(context, server.browserUrl);
			await disableBrowserPrewarm(context);
			await context.addInitScript(() => {
				if (!localStorage.getItem('wasm-idle:example-workspace:v3')) {
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'C',
							activePath: 'main.c',
							lspEnabled: false,
							files: [{ path: 'main.c', content: 'int main(void) { return 0; }' }]
						})
					);
				}
			});
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			async function runSource(source: string) {
				expect(
					await page.evaluate(
						(code) => (window as any).__wasmIdleDebug.setEditorValue(code),
						source
					)
				).toBe(true);
				const previousRun = await page.evaluate(
					() => (window as any).__wasmIdleDebug.getExecutionState()?.id ?? 0
				);
				const previousTranscript =
					(await page.getByTestId('terminal-debug-output').textContent()) || '';
				await page.getByRole('button', { name: 'Run', exact: true }).click();
				await page.waitForFunction(
					(id) => {
						const state = (window as any).__wasmIdleDebug.getExecutionState();
						return (
							state?.id > id &&
							['completed', 'failed', 'cancelled', 'timed-out'].includes(state.status)
						);
					},
					previousRun,
					{ timeout: 120_000 }
				);
				const state = await page.evaluate(() =>
					(window as any).__wasmIdleDebug.getExecutionState()
				);
				const transcript =
					(await page.getByTestId('terminal-debug-output').textContent()) || '';
				return {
					state,
					transcript: transcript.startsWith(previousTranscript)
						? transcript.slice(previousTranscript.length)
						: transcript
				};
			}
			try {
				await prepareContainerRuntimePage(page, server.browserUrl);
				for (const language of ['C', 'CPP'] as const) {
					await page.locator('#language-select').selectOption(language);
					const panel = page.locator('details.compiler-options');
					if ((await panel.getAttribute('open')) === null) {
						await panel.locator('summary').click();
					}
					if (language === 'C')
						await page.getByLabel('C standard', { exact: true }).selectOption('C23');
					else await page.locator('#cpp-version').selectOption('CPP17');
					await page.getByLabel('Optimization', { exact: true }).selectOption('2');
					await page.getByLabel('Warnings', { exact: true }).selectOption('extra');
					await page.getByLabel('Warnings as errors', { exact: false }).check();
					await page.getByLabel('GNU extensions', { exact: true }).uncheck();
					await page
						.getByLabel('Compiler arguments', { exact: true })
						.fill('-DANSWER=42');
					await page
						.getByLabel('Program arguments', { exact: true })
						.fill('"hello world" ""');
					const standardCheck =
						language === 'C'
							? '#if __STDC_VERSION__ != 202311L\n#error Wrong C standard\n#endif'
							: '#if __cplusplus != 201703L\n#error Wrong C++ standard\n#endif';
					const code = `#include <stdio.h>
${standardCheck}
#ifndef __OPTIMIZE__
#error Optimization missing
#endif
#ifndef __STRICT_ANSI__
#error ISO dialect missing
#endif
int main(int argc, char **argv) {
    printf("flags=%d arg=%s empty=%d\\n", ANSWER, argc > 1 ? argv[1] : "missing", argc > 2 && argv[2][0] == 0);
    return 0;
}`;
					const { state, transcript } = await runSource(code);
					expect(state, transcript || '').toMatchObject({
						status: 'completed',
						exitCode: 0,
						language
					});
					expect(transcript).toContain('flags=42 arg=hello world empty=1');
					await page
						.getByLabel('Compiler arguments', { exact: true })
						.fill(language === 'C' ? '-nostdinc' : '-nostdinc++');
					const policy =
						await runSource(`${language === 'CPP' ? 'extern "C" ' : ''}int printf(const char *, ...);
#if __has_include(<${language === 'C' ? 'stdio.h' : 'vector'}>)
#error Standard include suppression was ignored
#endif
int main(void) { printf("include-policy-ok"); return 0; }`);
					expect(policy.state, policy.transcript).toMatchObject({
						status: 'completed',
						exitCode: 0,
						language
					});
					expect(policy.transcript).toContain('include-policy-ok');

					await page
						.getByLabel('Compiler arguments', { exact: true })
						.fill('-DANSWER="unfinished');
					expect(await panel.getByRole('alert').textContent()).toContain(
						'Close the " quote'
					);
					await page.getByRole('button', { name: 'Run', exact: true }).click();
					expect(
						await page.evaluate(
							() => (window as any).__wasmIdleDebug.getExecutionState().id
						)
					).toBe(policy.state.id);
					await page
						.getByLabel('Compiler arguments', { exact: true })
						.fill('-DANSWER=42');
				}

				await page.waitForFunction(() => {
					const saved = JSON.parse(
						localStorage.getItem('wasm-idle:example-workspace:v3') || '{}'
					);
					return (
						saved.compilerOptions?.C?.cVersion === 'C23' &&
						saved.compilerOptions?.CPP?.arguments === '-DANSWER=42'
					);
				});
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.locator('details.compiler-options summary').click();
				expect(
					await page.getByLabel('Compiler arguments', { exact: true }).inputValue()
				).toBe('-DANSWER=42');
				expect(await page.getByLabel('Optimization', { exact: true }).inputValue()).toBe(
					'2'
				);
				expect(await page.getByLabel('GNU extensions', { exact: true }).isChecked()).toBe(
					false
				);
				await page.locator('#language-select').selectOption('C');
				expect(await page.getByLabel('C standard', { exact: true }).inputValue()).toBe(
					'C23'
				);
				expect(
					await page.evaluate(() =>
						(window as any).__wasmIdleDebug.setWorkspaceFiles([], 'main.cpp')
					)
				).toBe(true);
				await page.locator('#cpp-version').selectOption('CPP17');
				expect(await page.locator('#language-select').inputValue()).toBe('C');
				const cppInC = await runSource(`#include <stdio.h>
#if __cplusplus != 201703L
#error Wrong C++ standard in the C workspace
#endif
#ifndef __STRICT_ANSI__
#error ISO dialect missing in the C workspace
#endif
int main(void) { printf("c-editor-cpp-flags=%d", ANSWER); return 0; }`);
				expect(cppInC.state, cppInC.transcript).toMatchObject({
					status: 'completed',
					exitCode: 0,
					language: 'C'
				});
				expect(cppInC.transcript).toContain('c-editor-cpp-flags=42');
				expect(errors).toEqual([]);
			} finally {
				await context.close();
				await browser.close();
				await server.close();
			}
		}
	);
});
