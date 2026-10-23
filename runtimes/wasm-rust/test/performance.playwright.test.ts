import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { resolveChromiumExecutable } from '../scripts/browser-harness-runtime.mjs';
import { startBrowserHarnessServer } from '../scripts/browser-harness-server.mjs';

// Opt in after preparing dist with the receipt-backed compiler/runtime, never a compiler mock.
describe.skipIf(process.env.WASM_RUST_RUN_REAL_BROWSER_HARNESS !== '1')(
	'Rust performance contracts in Chromium',
	() => {
		it('checks without artifacts, preserves Run errors, and reuses immutable execution work', async () => {
			const server = await startBrowserHarnessServer();
			const browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable()
			});
			try {
				const page = await browser.newPage();
				await page.goto(`${server.origin}/browser-harness/`);
				const report = await page.evaluate(async () => {
					const api = await import(/* @vite-ignore */ '/dist/index.js');
					const compiler = await api.createRustCompiler();
					const source = `use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let mut words = input.split_whitespace();
    let mode = words.next().unwrap();
    let n: u8 = words.next().unwrap().parse().unwrap();
    if mode == "assert" { debug_assert!(n != 255, "profile debug assertion"); }
    println!("{}:{}", n + 1, cfg!(debug_assertions));
}`;
					const checks = [];
					for (const targetTriple of [
						'wasm32-wasip1',
						'wasm32-wasip2',
						'wasm32-wasip3'
					]) {
						const started = performance.now();
						const result = await compiler.check({ code: source, targetTriple });
						checks.push({ targetTriple, ms: performance.now() - started, ...result });
					}
					const invalid = await compiler.check({
						code: 'fn main() { let n: u32 = "wrong"; }'
					});
					const linkOnlySource =
						'unsafe extern "C" { fn absent_external_symbol(); } fn main() { unsafe { absent_external_symbol(); } }';
					const linkCheck = await compiler.check({ code: linkOnlySource });
					const linkRun = await compiler.compile({ code: linkOnlySource });
					const runs = [];
					for (const [targetTriple, optimizationProfile] of [
						['wasm32-wasip1', 'interactive'],
						['wasm32-wasip1', 'speed'],
						['wasm32-wasip1', 'size'],
						['wasm32-wasip2', 'interactive'],
						['wasm32-wasip3', 'interactive']
					]) {
						const started = performance.now();
						const result = await compiler.compile({
							code: source,
							targetTriple,
							optimizationProfile
						});
						const compileMs = performance.now() - started;
						if (!result.success || !result.artifact)
							throw new Error(JSON.stringify(result));
						const artifact = result.artifact;
						api.clearBrowserRustExecutionCache();
						let engineCompiles = 0;
						const compile = WebAssembly.compile;
						WebAssembly.compile = (...args) => {
							engineCompiles++;
							return compile(...args);
						};
						const execute = async (text: string) => {
							let input: string | null = text;
							let stderr = '';
							const start = performance.now();
							try {
								const output = await api.executeBrowserRustArtifact(artifact, {
									stdin: () => {
										const next = input;
										input = null;
										return next;
									},
									stderr: (chunk: string) => {
										stderr += chunk;
									}
								});
								return { ...output, ms: performance.now() - start, error: null };
							} catch (error) {
								return {
									stderr,
									ms: performance.now() - start,
									error: String(error)
								};
							}
						};
						try {
							const first = await execute('normal 254');
							const firstCompiles = engineCompiles;
							const second = await execute('normal 41');
							const repeatCompiles = engineCompiles - firstCompiles;
							const overflow = await execute('overflow 255');
							const assertion = await execute('assert 255');
							runs.push({
								targetTriple,
								optimizationProfile,
								compileMs,
								wasmBytes: artifact.wasm.byteLength,
								first,
								second,
								firstCompiles,
								repeatCompiles,
								overflow,
								assertion
							});
						} finally {
							WebAssembly.compile = compile;
						}
					}
					const sourceSha256 = Array.from(
						new Uint8Array(
							await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
						),
						(byte) => byte.toString(16).padStart(2, '0')
					).join('');
					return { sourceSha256, checks, invalid, linkCheck, linkRun, runs };
				});
				console.info('rust-performance-report', JSON.stringify(report));
				for (const check of report.checks) {
					expect(check.success).toBe(true);
					expect(check).not.toHaveProperty('artifact');
				}
				expect(report.invalid.success).toBe(false);
				expect(report.invalid.diagnostics).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							severity: 'error',
							lineNumber: 1,
							message: 'mismatched types'
						})
					])
				);
				expect(report.linkCheck.success).toBe(true);
				expect(report.linkRun.success).toBe(false);
				expect(report.linkRun).not.toHaveProperty('artifact');
				for (const run of report.runs) {
					expect(run.first).toMatchObject({
						stdout: '255:true\n',
						exitCode: 0,
						error: null
					});
					expect(run.second).toMatchObject({
						stdout: '42:true\n',
						exitCode: 0,
						error: null
					});
					expect(run.firstCompiles).toBeGreaterThan(0);
					expect(run.repeatCompiles).toBe(0);
					expect(run.overflow.stderr).toContain('overflow');
					expect(run.assertion.stderr).toContain('profile debug assertion');
				}
			} finally {
				await browser.close();
				await server.close();
			}
		}, 780_000);
	}
);
