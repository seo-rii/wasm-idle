// @vitest-environment node
import { expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

it(
	'runs extension-free Java hooks through the container with genuine stacks, stepping, I/O and cancellation',
	{
		skip: process.env.WASM_IDLE_RUN_JAVA_HOOKS !== '1',
		timeout: 180_000
	},
	async () => {
		const base = process.env.WASM_IDLE_BROWSER_URL;
		if (!base) throw new Error('Set WASM_IDLE_BROWSER_URL to the local Vite application root.');
		const browser = await chromium.launch({
			executablePath: await resolveChromiumExecutable(),
			headless: true
		});
		try {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, base);
			const page = await context.newPage();
			const probe = new URL('__java_hooks_probe__', base).href;
			await page.route(probe, (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					headers: {
						'Cross-Origin-Opener-Policy': 'same-origin',
						'Cross-Origin-Embedder-Policy': 'require-corp'
					},
					body: '<!doctype html><title>Java hooks integration</title>'
				})
			);
			await page.goto(probe);
			const result = await page.evaluate(async (base) => {
				const { createContainerPlaygroundBinding } = await new Function(
					'url',
					'return import(url)'
				)(new URL('src/lib/playground/container/binding.ts', base).href);
				const binding = createContainerPlaygroundBinding(
					{ rootUrl: base },
					{ applicationRootURL: base, workspaceId: `java-hooks-${crypto.randomUUID()}` }
				);
				const sandbox = await binding.load('JAVA');
				const source =
					'import java.util.Scanner;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner scanner = new Scanner(System.in);\n    int value = scanner.nextInt();\n    int answer = Helper.doubleValue(value);\n    answer += 2;\n    System.out.println(answer);\n  }\n}';
				const helper =
					'public class Helper {\n  static int doubleValue(int value) {\n    int result = value * 2;\n    return result + 1;\n  }\n}';
				const workspace = [
					{ path: 'Main.java', content: source },
					{ path: 'Helper.java', content: helper }
				];
				await binding.syncWorkspace('JAVA', workspace);
				const pauses: any[] = [],
					breakpointEvents: any[] = [];
				let output = '',
					failure = '',
					loop = false,
					normalEvents = 0,
					entry = 0,
					pausedLoop = 0;
				const options = {
					activePath: 'Main.java',
					workspaceFiles: [workspace[1]],
					limits: { compileTimeoutMs: 90_000, runTimeoutMs: 30_000 }
				};
				sandbox.output = (chunk: string) => {
					output += chunk;
					if (loop && output.includes('loop-ready')) {
						loop = false;
						void sandbox.debugPause();
					}
				};
				try {
					await sandbox.load(source, false, [], options);
					// Normal -> Debug -> normal with identical original source must invalidate compiled mode.
					await sandbox.run(source, false, false, undefined, [], {
						...options,
						stdin: '6\n'
					});
					sandbox.ondebug = (event: any) => {
						if (event.type === 'breakpoints') breakpointEvents.push(event);
						if (event.type !== 'pause') return;
						pauses.push(event);
						void (async () => {
							if (pauses.length === 1) await sandbox.debugCommand('stepInto');
							else if (pauses.length === 2) {
								await sandbox.setBreakpoints([4], '/workspace/Helper.java');
								await sandbox.debugCommand('nextLine');
							} else if (pauses.length === 3) await sandbox.debugCommand('nextLine');
							else if (pauses.length === 4) {
								await sandbox.setBreakpoints([], '/workspace/Helper.java');
								await sandbox.debugCommand('stepOut');
							} else if (pauses.length === 5) {
								await sandbox.setBreakpoints([8]);
								await sandbox.debugCommand('nextLine');
							} else await sandbox.debugCommand('continue');
						})().catch((error) => {
							failure = String(error);
							void sandbox.terminate();
						});
					};
					await sandbox.run(source, false, false, undefined, [], {
						...options,
						debugMode: 'trace',
						pauseOnEntry: false,
						breakpoints: [6],
						stdin: '7\n'
					});
					sandbox.ondebug = () => {
						normalEvents++;
					};
					await sandbox.run(source, false, false, undefined, [], {
						...options,
						debugMode: 'none',
						debug: true,
						stdin: '8\n'
					});
					let evaluationError = '';
					try {
						await sandbox.debugEvaluate('1 + 1');
					} catch (error) {
						evaluationError = String(error);
					}
					const loopSource =
						'public class Main {\n  public static void main(String[] args) {\n    System.out.println("loop-ready");\n    while (true) {}\n  }\n}';
					await binding.syncWorkspace('JAVA', [
						{ path: 'Main.java', content: loopSource }
					]);
					loop = true;
					sandbox.ondebug = (event: any) => {
						if (event.type !== 'pause') return;
						if (event.reason === 'entry') {
							entry = event.line;
							void sandbox.debugCommand('continue');
						} else {
							pausedLoop = event.line;
							void sandbox.terminate();
						}
					};
					let stopped = false;
					try {
						await sandbox.run(loopSource, false, false, undefined, [], {
							activePath: 'Main.java',
							debugMode: 'trace',
							pauseOnEntry: true
						});
					} catch {
						stopped = true;
					}
					await binding.syncWorkspace('JAVA', workspace);
					sandbox.ondebug = undefined;
					await sandbox.load(source, false, [], options);
					await sandbox.run(source, false, false, undefined, [], {
						...options,
						stdin: '9\n'
					});
					return {
						output,
						failure,
						pauses,
						breakpointEvents,
						normalEvents,
						evaluationError,
						entry,
						pausedLoop,
						stopped
					};
				} finally {
					await binding.dispose();
				}
			}, base);
			expect(result.failure).toBe('');
			expect(result.pauses.map((pause: any) => [pause.sourcePath, pause.line])).toEqual([
				['/workspace/Main.java', 6],
				['/workspace/Helper.java', 2],
				['/workspace/Helper.java', 3],
				['/workspace/Helper.java', 4],
				['/workspace/Main.java', 7],
				['/workspace/Main.java', 8]
			]);
			expect(result.pauses[1].callStack.map((frame: any) => frame.functionName)).toEqual([
				'Helper.doubleValue',
				'Main.main'
			]);
			expect(
				result.pauses.every(
					(pause: any) => pause.locals.length === 0 && pause.scopes.length === 0
				)
			).toBe(true);
			expect(result.breakpointEvents).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						sourcePath: '/workspace/Helper.java',
						breakpoints: [expect.objectContaining({ line: 4, verified: true })]
					})
				])
			);
			expect(result.normalEvents).toBe(0);
			expect(result.evaluationError).toContain('unavailable');
			expect(result.entry).toBe(2);
			expect(result.pausedLoop).toBe(4);
			expect(result.stopped).toBe(true);
			expect(result.output).toBe('15\n17\n19\nloop-ready\n21\n');
		} finally {
			await browser.close();
		}
	}
);
