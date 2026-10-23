// @vitest-environment node
import { expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

it(
	'controls real Ruby TracePoint through the container owner, including I/O, stepping, stop and restart',
	{
		skip: process.env.WASM_IDLE_RUN_RUBY_DEBUG !== '1',
		timeout: 120_000
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
			const probe = new URL('__ruby_debug_probe__', base).href;
			await page.route(probe, (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					headers: {
						'Cross-Origin-Opener-Policy': 'same-origin',
						'Cross-Origin-Embedder-Policy': 'require-corp'
					},
					body: '<!doctype html><title>Ruby TracePoint integration</title>'
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
					{ applicationRootURL: base, workspaceId: `ruby-debug-${crypto.randomUUID()}` }
				);
				const sandbox = await binding.load('RUBY');
				const source =
					'def double(value)\n  result = value * 2\n  result + 1\nend\nvalue = STDIN.gets.to_i\nanswer = double(value)\nanswer += 2\nputs answer';
				await binding.syncWorkspace('RUBY', [{ path: 'nested/main.rb', content: source }]);
				const pauses: any[] = [];
				let output = '',
					evaluation = '',
					failure = '',
					entry = 0,
					streamInput = false;
				sandbox.output = (chunk: string) => {
					output += chunk;
					if (streamInput && output.includes('ruby-value?')) {
						streamInput = false;
						sandbox.write('35\n');
					}
				};
				sandbox.ondebug = (event: any) => {
					if (event.type !== 'pause') return;
					pauses.push(event);
					void (async () => {
						if (pauses.length === 1) {
							evaluation = await sandbox.debugEvaluate('value + 4');
							await sandbox.debugCommand('stepInto');
						} else if (pauses.length === 2) {
							await sandbox.setBreakpoints([8], '/workspace/nested/main.rb');
							await sandbox.debugCommand('stepOut');
						} else await sandbox.debugCommand('continue');
					})().catch((error) => {
						failure = String(error);
						void sandbox.terminate();
					});
				};
				try {
					await sandbox.load(source, false, [], { activePath: 'nested/main.rb' });
					await sandbox.run(source, false, false, undefined, [], {
						debugMode: 'tracepoint',
						pauseOnEntry: false,
						breakpoints: [6],
						activePath: 'nested/main.rb',
						stdin: '7\n'
					});
					const stoppedSource = 'value = 1\nvalue += 1\nputs value';
					await binding.syncWorkspace('RUBY', [
						{ path: 'main.rb', content: stoppedSource }
					]);
					sandbox.ondebug = (event: any) => {
						if (event.type === 'pause') {
							entry = event.line;
							void sandbox.terminate();
						}
					};
					let stopped = false;
					try {
						await sandbox.run(stoppedSource, false, false, undefined, [], {
							debugMode: 'tracepoint',
							pauseOnEntry: true,
							activePath: 'main.rb'
						});
					} catch {
						stopped = true;
					}
					await binding.syncWorkspace('RUBY', [
						{ path: 'main.rb', content: 'puts "restart-ok"' }
					]);
					await sandbox.load('puts "restart-ok"', false, [], { activePath: 'main.rb' });
					await sandbox.run('puts "restart-ok"', false, false, undefined, [], {
						activePath: 'main.rb'
					});
					// Exercise the existing ordinary Ruby browser I/O program after debugger cancellation.
					const plainSource =
						'$stdout.sync = true\nprint "ruby-value?"\nvalue = STDIN.gets\nputs "ruby-result=#{value.to_i + 7}"';
					await binding.syncWorkspace('RUBY', [
						{ path: 'main.rb', content: plainSource }
					]);
					streamInput = true;
					await sandbox.run(plainSource, false, false, undefined, [], {
						activePath: 'main.rb'
					});
					return { output, evaluation, failure, pauses, entry, stopped };
				} finally {
					await binding.dispose();
				}
			}, base);
			expect(result.failure).toBe('');
			expect(result.evaluation).toBe('11');
			expect(result.pauses.map((pause: any) => pause.line)).toEqual([6, 2, 7, 8]);
			expect(result.pauses.map((pause: any) => pause.sourcePath)).toEqual([
				'/workspace/nested/main.rb',
				'/workspace/nested/main.rb',
				'/workspace/nested/main.rb',
				'/workspace/nested/main.rb'
			]);
			expect(result.pauses[3].reason).toBe('breakpoint');
			expect(result.pauses[1].callStack.map((frame: any) => frame.functionName)).toEqual([
				'double',
				'<main>'
			]);
			expect(result.pauses[1].locals).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: 'value', value: '7' })])
			);
			expect(result.pauses[2].locals).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: 'answer', value: '15' })])
			);
			expect(result.pauses[3].locals).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: 'answer', value: '17' })])
			);
			expect(result.entry).toBe(1);
			expect(result.stopped).toBe(true);
			expect(result.output).toBe('17\nrestart-ok\nruby-value?ruby-result=42\n');
		} finally {
			await browser.close();
		}
	}
);
