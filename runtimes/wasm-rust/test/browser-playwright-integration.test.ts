import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	resolveChromiumExecutable,
	resolveHarnessTargetTriples
} from '../scripts/browser-harness-runtime.mjs';
import { startBrowserHarnessServer } from '../scripts/browser-harness-server.mjs';

const sampleProgram = process.env.WASM_RUST_SAMPLE_PROGRAM || 'fn main() { println!("hi"); }';
const runTimeoutMs = Number(
	process.env.WASM_RUST_BROWSER_HARNESS_RUN_TIMEOUT_MS || String(120000 + 120000)
);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('browser harness direct Playwright integration', () => {
	it(
		'compiles and runs hello world directly through Chromium and the standalone harness',
		async () => {
			if (process.env.WASM_RUST_RUN_REAL_BROWSER_HARNESS !== '1') {
				return;
			}

			const server = await startBrowserHarnessServer();
			const executablePath = await resolveChromiumExecutable();
			const browser = await chromium.launch({
				headless: true,
				executablePath
			});
			const consoleMessages: Array<{ type: string; text: string }> = [];
			const pageErrors: string[] = [];

			try {
				const page = await browser.newPage();
				page.setDefaultTimeout(runTimeoutMs);
				page.on('console', (message) => {
					consoleMessages.push({
						type: message.type(),
						text: message.text()
					});
				});
				page.on('pageerror', (error) => {
					pageErrors.push(String(error.stack || error.message || error));
				});

				await page.goto(`${server.origin}/browser-harness/`, {
					waitUntil: 'domcontentloaded'
				});
				await page.waitForFunction(() => typeof window.runWasmRustHarness === 'function');
				const targetTriples = await resolveHarnessTargetTriples(projectRoot);
				expect(targetTriples.length).toBeGreaterThan(0);
				for (const targetTriple of targetTriples) {
					const result = await page.evaluate(
						async ({ code, targetTriple: selectedTarget }) =>
							window.runWasmRustHarness({ code, log: true, targetTriple: selectedTarget }),
						{
							code: sampleProgram,
							targetTriple
						}
					);

					expect(result.crossOriginIsolated).toBe(true);
					expect(result.compile.success).toBe(true);
					expect(result.compile.hasWasm).toBe(true);
					expect(result.compile.hasWat).toBe(false);
					expect(result.compile.targetTriple).toBe(targetTriple);
					expect(result.runtime?.exitCode).toBe(0);
					expect(result.runtime?.stdout).toBe('hi\n');
					const progressState = await page.evaluate(() => ({
						pill: document.querySelector('#progress-pill')?.textContent || '',
						last:
							window.__wasmRustBrowserHarnessState.progressEvents[
								window.__wasmRustBrowserHarnessState.progressEvents.length - 1
							] || null
					}));
					expect(progressState.pill).toContain('100%');
					expect(progressState.last?.stage).toBe('done');
					expect(progressState.last?.percent).toBe(100);
					if (targetTriple === 'wasm32-wasip2') {
						expect(result.compile.format).toBe('component');
					}
					if (targetTriple === 'wasm32-wasip1') {
						expect(result.compile.format).toBe('core-wasm');
					}
				}
				expect(pageErrors).toEqual([]);
				expect(
					consoleMessages.some(
						(message) =>
							message.type === 'log' &&
							(
								message.text.includes('mirrored bitcode settled; linking through llvm-wasm') ||
								message.text.includes('compile succeeded; executing WASI module in browser')
							)
					)
				).toBe(true);
			} finally {
				await browser.close();
				await server.close();
			}
		},
		780_000
	);
});
