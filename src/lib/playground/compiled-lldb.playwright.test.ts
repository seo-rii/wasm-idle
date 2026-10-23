// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const objcSource = (cpp: boolean) => `#include <stdio.h>
#include <objc/runtime.h>
${cpp ? '#include <string>' : ''}
__attribute__((objc_root_class))
@interface Counter { Class isa; }
- (int)add:(int)value;
@end
@implementation Counter
- (int)add:(int)value { return value + ${cpp ? '(int)std::string("12345").size()' : '5'}; }
@end
int main(void) {
    int value = 0;
    scanf("%d", &value);
    Counter *counter = (Counter *)class_createInstance(objc_getClass("Counter"), 0);
    value = [counter add:value]; // breakpoint
    printf("lldb-objc=%d\\n", value);
    object_dispose(counter);
    return 0;
}`;

const cases = [
	{
		language: 'OBJC',
		module: 'objectivec',
		path: 'main.m',
		entrySymbol: 'main',
		source: objcSource(false),
		expected: 'lldb-objc=73'
	},
	{
		language: 'OBJECTIVECXX',
		module: 'objectivec',
		path: 'main.mm',
		entrySymbol: 'main',
		source: objcSource(true),
		expected: 'lldb-objc=73'
	},
	{
		language: 'V',
		module: 'v',
		path: 'main.v',
		entrySymbol: 'main__main',
		source: `import os
fn main() {
    mut value := os.get_line().int()
    value += 5 // breakpoint
    println('lldb-v=\${value}')
}`,
		expected: 'lldb-v=73'
	},
	{
		language: 'D',
		module: 'd',
		path: 'main.d',
		source: `import std.stdio;
import std.conv : to;
import std.string : strip;
void main() {
    int value = to!int(readln().strip());
    value += 5; // breakpoint
    writeln("lldb-d=", value);
}`,
		expected: 'lldb-d=73',
		expectedError:
			'Unsupported WAMR debug module: exception-handling tag sections are not supported'
	}
];

const enabled = process.env.WASM_IDLE_RUN_COMPILED_LLDB === '1';
const selected = new Set(
	(process.env.WASM_IDLE_COMPILED_LLDB_LANGUAGES || 'OBJC,OBJECTIVECXX,V,D').split(',')
);

describe('compiled language LLDB in Chromium', () => {
	for (const testCase of cases) {
		it(
			`${testCase.language} ${'expectedError' in testCase ? 'rejects the unsupported full-runtime WAMR target' : 'pauses at user entry before source breakpoints, locals, stepping, and stdin/stdout'}`,
			{
				skip: !enabled || !selected.has(testCase.language),
				timeout: 600_000
			},
			async () => {
				const browserUrl = process.env.WASM_IDLE_BROWSER_URL;
				if (!browserUrl)
					throw new Error('Set WASM_IDLE_BROWSER_URL to the running Vite dev server.');
				const browser = await chromium.launch({
					executablePath: await resolveChromiumExecutable(),
					headless: true
				});
				const context = await browser.newContext();
				await addBrowserTestCookies(context, browserUrl);
				const page = await context.newPage();
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				const probeUrl = new URL('__compiled_lldb_probe__', browserUrl).href;
				await page.route(probeUrl, (route) =>
					route.fulfill({
						status: 200,
						contentType: 'text/html',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						},
						body: '<!doctype html><title>Compiled LLDB integration probe</title>'
					})
				);
				try {
					await page.goto(probeUrl);
					const result = await page.evaluate(
						async ({ testCase, browserUrl }) => {
							const moduleUrl = new URL(
								`src/lib/playground/${testCase.module}.ts`,
								browserUrl
							).href;
							const { default: Sandbox } = await new Function(
								'url',
								'return import(url)'
							)(moduleUrl);
							const sandbox =
								testCase.module === 'objectivec'
									? new Sandbox(testCase.language)
									: new Sandbox();
							let output = '';
							const pauses: any[] = [];
							const breakpointEvents: any[] = [];
							let callbackError = '';
							const breakpointLine =
								testCase.source
									.split('\n')
									.findIndex((line: string) => line.includes('// breakpoint')) +
								1;
							sandbox.output = (chunk: string) => {
								output += chunk;
							};
							sandbox.ondebug = (event: any) => {
								if (event.type === 'breakpoints') breakpointEvents.push(event);
								if (event.type !== 'pause') return;
								void (async () => {
									const variables = [];
									const scopes = await sandbox.debugScopes(event.frameId);
									for (const scope of scopes) {
										if (!scope.expensive)
											variables.push(
												...(await sandbox.debugVariables(
													scope.variablesReference
												))
											);
									}
									pauses.push({ ...event, variables });
									await sandbox.debugCommand(
										pauses.length === 2 ? 'nextLine' : 'continue'
									);
								})().catch(async (error) => {
									callbackError = String(error);
									await sandbox.terminate();
								});
							};
							try {
								await sandbox.load(browserUrl, '', false);
								const completed = await sandbox.run(
									testCase.source,
									false,
									false,
									undefined,
									[],
									{
										debugMode: 'lldb',
										pauseOnEntry: !!testCase.entrySymbol,
										activePath: testCase.path,
										breakpoints: [breakpointLine],
										stdin: '68\n'
									}
								);
								return {
									completed,
									output,
									pauses,
									breakpointEvents,
									callbackError,
									breakpointLine
								};
							} catch (error) {
								return {
									error: String(error),
									output,
									pauses,
									breakpointEvents,
									callbackError,
									breakpointLine
								};
							} finally {
								await sandbox.terminate();
								await sandbox.dispose?.();
							}
						},
						{ testCase, browserUrl }
					);
					if (testCase.expectedError) {
						expect(result).toMatchObject({
							error: expect.stringContaining(testCase.expectedError),
							pauses: []
						});
						expect(result.output).not.toContain(testCase.expected);
						expect(errors).toEqual([]);
						return;
					}
					if ('error' in result)
						throw new Error(
							`${result.error}\nProgram output:\n${result.output.slice(-6000)}`
						);
					expect(result.callbackError).toBe('');
					expect(result.completed).toBe(true);
					expect(result.output).toContain(testCase.expected);
					expect(result.pauses.length).toBeGreaterThanOrEqual(3);
					expect(result.pauses[0]).toMatchObject({
						reason: 'entry',
						stoppedReason: 'entry',
						sourcePath: `/workspace/${testCase.path}`
					});
					expect(result.pauses[0].callStack[0]).toMatchObject({
						functionName: testCase.entrySymbol,
						sourcePath: `/workspace/${testCase.path}`
					});
					expect(result.pauses[0].line).toBeGreaterThan(0);
					expect(result.pauses[0].line).toBeLessThan(result.breakpointLine);
					expect(result.pauses[1]).toMatchObject({
						reason: 'breakpoint',
						line: result.breakpointLine,
						sourcePath: `/workspace/${testCase.path}`
					});
					expect(result.pauses[1].variables).toEqual(
						expect.arrayContaining([
							expect.objectContaining({ name: 'value', value: '68' })
						])
					);
					expect(result.pauses[2].line).not.toBe(result.pauses[1].line);
					expect(errors).toEqual([]);
				} finally {
					await context.close();
					await browser.close();
				}
			}
		);
	}
});
