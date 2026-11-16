// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_VERILOG === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

async function runVerilogConsumer(page: Page, browserUrl: string) {
	const base = `${browserUrl.replace(/\/$/u, '')}/`;
	const harness = `${base}verilog-runtime-harness`;
	await page.route(harness, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Verilog runtime</title>',
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			}
		})
	);
	await page.goto(harness, { waitUntil: 'domcontentloaded' });
	await page.addScriptTag({
		type: 'module',
		content: `import Verilog from ${JSON.stringify(base + 'src/lib/playground/verilog.ts')}; globalThis.__Verilog = Verilog;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__Verilog));
	return await page.evaluate(async (base) => {
		if (navigator.serviceWorker.controller)
			throw new Error('Expected a cold consumer without a service worker');
		const sandbox = new (globalThis as any).__Verilog();
		const rootUrl = new URL(base).pathname.replace(/\/$/u, '');
		const run = async (
			code: string,
			options: Record<string, unknown> = {},
			input?: string[],
			abort?: AbortController
		) => {
			await sandbox.load({ rootUrl });
			let output = '';
			let inputRequests = 0;
			let scheduled = false;
			sandbox.output = (chunk: string) => (output += chunk);
			try {
				const value = await sandbox.run(
					code,
					false,
					false,
					{
						report(event: { kind?: string; reason?: string }) {
							if (event.kind !== 'ready') return;
							inputRequests += 1;
							if (scheduled) return;
							scheduled = true;
							if (abort) setTimeout(() => abort.abort(), 20);
							if (input) {
								input.forEach((chunk, index) =>
									setTimeout(() => sandbox.write(chunk), 20 * (index + 1))
								);
								setTimeout(() => sandbox.eof(), 20 * (input.length + 1));
							}
						}
					},
					[],
					options
				);
				return { value, output, inputRequests, error: '', code: '' };
			} catch (error) {
				return {
					value: false,
					output,
					inputRequests,
					error: String(error),
					code: String((error as { code?: unknown })?.code || '')
				};
			}
		};
		try {
			const module = (body: string) => `module main; initial begin ${body} end endmodule\n`;
			const lineProgram = `module main; reg [8191:0] line; integer count; initial begin count=$fgets(line,32'h80000000); if(count>0) $write("%0s",line); else $display("EOF"); end endmodule\n`;
			const arithmetic = await run(module('$display("%0d", 1+2);'), { stdin: '' });
			const arrays = await run(
				`module main; integer values[0:4]; integer i,total; initial begin total=0; for(i=0;i<5;i=i+1) begin values[i]=i; total=total+values[i]; end $display("%0d",total); end endmodule`,
				{ stdin: '' }
			);
			const fresh = await run(module('$display("%0d", 6*7);'), { stdin: '' });
			const explicit = await run(lineProgram, { stdin: '한글 🦀\n' });
			const delayed = await run(lineProgram, {}, ['지연 ', '입력 🦀\n']);
			const eof = await run(lineProgram, { stdin: '' });
			const partialEof = await run(lineProgram, { stdin: 'no-newline' });
			const args = await run(
				`module main; integer value; initial begin if($value$plusargs("value=%d",value)) $display("arg=%0d",value); end endmodule`,
				{ stdin: '', activePath: 'src/main.sv', programArgs: ['+value=73'] }
			);
			const file = await run(
				'`include "defs.vh"\nmodule main; initial $display("%0d", `ANSWER); endmodule\n',
				{ stdin: '', workspaceFiles: [{ path: 'defs.vh', content: '`define ANSWER 42\n' }] }
			);
			const multi = await run(
				'module main; wire [7:0] result; helper h(result); initial #1 $display("%0d",result); endmodule',
				{
					stdin: '',
					workspaceFiles: [
						{
							path: 'helper.v',
							content:
								'module helper(output [7:0] result); assign result=91; endmodule'
						}
					]
				}
			);
			const invalid = await run('module main; initial ???; endmodule', { stdin: '' });
			const nonzero = await run(module('$fatal(1,"expected failure");'), { stdin: '' });
			const limited = await run(module('repeat(100) $display("large output");'), {
				stdin: '',
				limits: { maxOutputBytes: 16 }
			});
			const afterLimit = await run(module('$display("after limit");'), { stdin: '' });
			const abort = new AbortController();
			const cancelled = await run(lineProgram, { signal: abort.signal }, undefined, abort);
			const recovered = await run(module('$display("after cancellation");'), { stdin: '' });
			const timeout = await run('module main; initial forever #1; endmodule', {
				stdin: '',
				limits: { runTimeoutMs: 100, compileTimeoutMs: 10000 }
			});
			const afterTimeout = await run(module('$display("after timeout");'), { stdin: '' });
			const memoryLimited = await run(module('$display("should not run");'), {
				stdin: '',
				limits: { maxWasmMemoryBytes: 1_000_000 }
			});
			const fileProgram =
				'module main; integer fd; initial begin fd=$fopen("large.txt","w"); repeat(10000) $fwrite(fd,"x"); $fclose(fd); end endmodule';
			const workspaceAllowed = await run(fileProgram, { stdin: '' });
			const workspaceLimited = await run(fileProgram, {
				stdin: '',
				limits: { maxWorkspaceBytes: 8192 }
			});

			return {
				arithmetic,
				arrays,
				fresh,
				explicit,
				delayed,
				eof,
				partialEof,
				args,
				file,
				multi,
				memoryLimited,
				workspaceLimited,
				workspaceAllowed,
				invalid,
				nonzero,
				limited,
				afterLimit,
				cancelled,
				recovered,
				timeout,
				afterTimeout
			};
		} finally {
			await sandbox.dispose();
		}
	}, base);
}

describe.skipIf(!enabled)('real Icarus Verilog compiler and simulator in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4995',
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
		'compiles and simulates fresh source with original array and module semantics, stdin/EOF, files, arguments, errors and recovery',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext({ serviceWorkers: 'block' });
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			try {
				const result = await runVerilogConsumer(page, server.browserUrl);
				expect(result.arithmetic).toMatchObject({ value: true, output: '3\n' });
				expect(result.arrays).toMatchObject({ value: true, output: '10\n' });
				expect(result.fresh).toMatchObject({ value: true, output: '42\n' });
				expect(result.explicit).toMatchObject({ value: true, output: '한글 🦀\n' });
				expect(result.delayed).toMatchObject({ value: true, output: '지연 입력 🦀\n' });
				expect(result.delayed.inputRequests).toBeGreaterThan(0);
				expect(result.eof).toMatchObject({ value: true, output: 'EOF\n' });
				expect(result.partialEof).toMatchObject({ value: true, output: 'no-newline' });
				expect(result.args.value).toBe(true);
				expect(result.args.output).toBe('arg=73\n');
				expect(result.file).toMatchObject({ value: true, output: '42\n' });
				expect(result.invalid.value).toBe(false);
				expect(result.invalid.output).toMatch(/syntax error|error:/i);
				expect(result.multi).toMatchObject({ value: true, output: '91\n' });
				expect(result.memoryLimited.code).toBe('resource-limit');
				expect(result.workspaceAllowed).toMatchObject({ value: true });
				expect(
					result.workspaceLimited,
					JSON.stringify(result.workspaceLimited)
				).toMatchObject({ code: 'resource-limit' });
				expect(result.nonzero.value).toBe(false);
				expect(result.limited.code).toBe('output-limit');
				expect(result.afterLimit).toMatchObject({ value: true, output: 'after limit\n' });
				expect(result.cancelled.error).not.toBe('');
				expect(result.recovered).toMatchObject({
					value: true,
					output: 'after cancellation\n'
				});
				expect(result.timeout.code).toBe('timeout');
				expect(result.afterTimeout).toMatchObject({
					value: true,
					output: 'after timeout\n'
				});
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the unchanged default example through the actual selector, Run and terminal input',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			await disableBrowserPrewarm(context);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			const requests: string[] = [];
			context.on('request', (request) => {
				if (new URL(request.url()).pathname.includes('/wasm-verilog/'))
					requests.push(request.url());
			});
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.waitForFunction(() => crossOriginIsolated);
				expect(requests).toEqual([]);
				await page.locator('#language-select').selectOption('VERILOG');
				await page.waitForFunction(isStdinEditorReady, 'VERILOG');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.verilog
				);
				const previousId = await page.evaluate(
					() => (window as any).__wasmIdleDebug.getExecutionState().id
				);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && !['idle', 'preparing'].includes(state.status);
				}, previousId);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('42\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && state.endedAt !== null;
				}, previousId);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({
					language: 'VERILOG',
					status: 'completed',
					exitCode: 0
				});
				expect(
					(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					)?.replaceAll('\r', '')
				).toContain('value=42\n');
				expect(requests.length).toBeGreaterThan(0);
			} finally {
				await context.close();
			}
		}
	);
});
