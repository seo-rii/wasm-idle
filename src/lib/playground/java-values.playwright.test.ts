// @vitest-environment node

import { expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_JAVA_VALUES === '1';
const source = String.raw`import java.util.Scanner;
public class Main {
    static int visits = 0;
    static int calculate(int input) {
        int number = input;
        long wide = 9007199254740993L;
        String text = "hello";
        String missing = null;
        char unit = 'A';
        int[] values = {number, number + 1, number + 2};
        int[][] matrix = {{number, number + 1}, {number + 2}};
        double negativeZero = Double.longBitsToDouble(Long.MIN_VALUE);
        Opaque opaque = new Opaque();
        Opaque alias = opaque;
        Object[] references = {opaque, alias, null};
        Object anonymous = new Opaque() { int hidden = 17; };
        Object library = new StringBuilder("opaque library state");
        visits++;
        number += ++opaque.value - 7; // inspect here
        return number + 4;
    }
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int input = scanner.nextInt();
        int result = calculate(input);
        System.out.println("java-values=" + result + ";visits=" + visits + ";toString=" + Opaque.calls + ";getters=" + Opaque.getters);
    }
}
class Parent { private int value = 99; }
class Opaque extends Parent {
    static int calls = 0;
    static int getters = 0;
    int value = 7;
    private final String secret = "hidden";
    private Opaque next = this;
    private final int[] data = {5, 8};
    private Object missing = null;
    public int getValue() { getters++; throw new IllegalStateException("unexpected getter call"); }
    public String toString() { calls++; throw new IllegalStateException("unexpected user method call"); }
}`;

it(
	'inspects real Java locals, object fields and arrays, evaluates snapshots, and resumes the same container program',
	{
		skip: !enabled,
		timeout: 300_000,
		meta: { browser: true, requiredBrowser: enabled }
	},
	async () => {
		const base = process.env.WASM_IDLE_BROWSER_URL;
		if (!base) throw new Error('Set WASM_IDLE_BROWSER_URL to the running application root.');
		const browser = await chromium.launch({
			executablePath: await resolveChromiumExecutable(),
			headless: true
		});
		try {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, base);
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));
			const probe = new URL('__java_values_probe__', base).href;
			await page.route(probe, (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					headers: {
						'Cross-Origin-Opener-Policy': 'same-origin',
						'Cross-Origin-Embedder-Policy': 'require-corp'
					},
					body: '<!doctype html><title>Java values integration</title>'
				})
			);
			await page.goto(probe);
			const result = await page.evaluate(
				async ({ base, source }) => {
					const { createContainerPlaygroundBinding } = await new Function(
						'url',
						'return import(url)'
					)(new URL('src/lib/playground/container/binding.ts', base).href);
					const binding = createContainerPlaygroundBinding(
						{ rootUrl: base },
						{
							applicationRootURL: base,
							workspaceId: `java-values-${crypto.randomUUID()}`
						}
					);
					const sandbox = await binding.load('JAVA');
					const line =
						source.split('\n').findIndex((text) => text.includes('// inspect here')) +
						1;
					const pauses: any[] = [];
					const evaluations: Record<string, string> = {};
					const rejected: Record<string, string> = {};
					let firstVariables: any[] = [],
						nextVariables: any[] = [],
						arrayPage: any[] = [],
						matrixPage: any[] = [];
					let rowPage: any[] = [],
						callerScopes: any[] = [],
						oldReference = 0;
					let objectFields: any[] = [],
						objectPage: any[] = [],
						objectArray: any[] = [],
						referenceArray: any[] = [],
						nextObjectFields: any[] = [],
						beyondFields: any[] = [];
					let oldObjectReference = 0,
						staleObjectError = '';
					let output = '',
						failure = '',
						staleError = '',
						callerError = '';
					sandbox.output = (chunk: string) => {
						output += chunk;
					};
					const options = {
						activePath: 'Main.java',
						limits: { compileTimeoutMs: 90_000, runTimeoutMs: 30_000 }
					};
					try {
						await binding.syncWorkspace('JAVA', [
							{ path: 'Main.java', content: source }
						]);
						await sandbox.load(source, false, [], options);
						sandbox.ondebug = (event: any) => {
							if (event.type !== 'pause') return;
							pauses.push(event);
							void (async () => {
								const scopes = await sandbox.debugScopes(event.frameId);
								const variables = await sandbox.debugVariables(
									scopes[0].variablesReference,
									0,
									100
								);
								if (pauses.length === 1) {
									firstVariables = variables;
									oldObjectReference = variables.find(
										(item: any) => item.name === 'opaque'
									).variablesReference;
									objectFields = await sandbox.debugVariables(
										oldObjectReference,
										0,
										50
									);
									objectPage = await sandbox.debugVariables(
										oldObjectReference,
										1,
										2
									);
									beyondFields = await sandbox.debugVariables(
										oldObjectReference,
										100,
										50
									);
									objectArray = await sandbox.debugVariables(
										objectFields.find((item: any) => item.name === 'data')
											.variablesReference,
										0,
										50
									);
									referenceArray = await sandbox.debugVariables(
										variables.find((item: any) => item.name === 'references')
											.variablesReference,
										0,
										50
									);
									oldReference = variables.find(
										(item: any) => item.name === 'values'
									).variablesReference;
									arrayPage = await sandbox.debugVariables(oldReference, 1, 2);
									matrixPage = await sandbox.debugVariables(
										variables.find((item: any) => item.name === 'matrix')
											.variablesReference,
										0,
										2
									);
									rowPage = await sandbox.debugVariables(
										matrixPage[0].variablesReference,
										0,
										2
									);
									for (const expression of [
										'number + 5',
										'wide + 1L',
										'text.substring(1)',
										'missing == null',
										'unit + 1',
										'1.0 / negativeZero'
									])
										evaluations[expression] =
											await sandbox.debugEvaluate(expression);
									for (const expression of [
										'values[0]',
										'opaque.toString()',
										'number++'
									]) {
										try {
											await sandbox.debugEvaluate(expression);
										} catch (error) {
											rejected[expression] = String(error);
										}
									}
									const caller = event.callStack[1];
									callerScopes = await sandbox.debugScopes(caller.id);
									try {
										await sandbox.debugEvaluate('input');
									} catch (error) {
										callerError = String(error);
									}
									await sandbox.debugScopes(event.frameId);
									evaluations['number unchanged'] =
										await sandbox.debugEvaluate('number');
									await sandbox.debugCommand('nextLine');
								} else {
									nextVariables = variables;
									nextObjectFields = await sandbox.debugVariables(
										variables.find((item: any) => item.name === 'opaque')
											.variablesReference,
										0,
										50
									);
									try {
										await sandbox.debugVariables(oldObjectReference, 0, 1);
									} catch (error) {
										staleObjectError = String(error);
									}
									evaluations['number + 5 after step'] =
										await sandbox.debugEvaluate('number + 5');
									try {
										await sandbox.debugVariables(oldReference, 0, 1);
									} catch (error) {
										staleError = String(error);
									}
									await sandbox.debugCommand('continue');
								}
							})().catch((error) => {
								failure = String(error);
								void sandbox.terminate();
							});
						};
						const completed = await sandbox.run(source, false, false, undefined, [], {
							...options,
							debugMode: 'trace',
							pauseOnEntry: false,
							breakpoints: [line],
							stdin: '68\n'
						});
						return {
							completed,
							output,
							failure,
							line,
							pauses,
							firstVariables,
							nextVariables,
							arrayPage,
							matrixPage,
							rowPage,
							objectFields,
							objectPage,
							objectArray,
							referenceArray,
							nextObjectFields,
							beyondFields,
							staleObjectError,
							evaluations,
							rejected,
							callerScopes,
							callerError,
							staleError
						};
					} finally {
						await binding.dispose();
					}
				},
				{ base, source }
			);
			console.info(
				'[java-values]',
				JSON.stringify({
					completed: result.completed,
					output: result.output.slice(-1000),
					failure: result.failure,
					pauses: result.pauses.map((pause: any) => ({
						reason: pause.reason,
						line: pause.line,
						frame: pause.callStack[0]
					})),
					evaluations: result.evaluations,
					rejected: result.rejected,
					callerError: result.callerError,
					staleError: result.staleError
				})
			);
			expect(result.failure).toBe('');
			expect(result.completed).toBe(true);
			expect(result.output).toBe('java-values=73;visits=1;toString=0;getters=0\n');
			expect(result.pauses).toHaveLength(2);
			expect(result.pauses[0]).toMatchObject({
				line: result.line,
				sourcePath: '/workspace/Main.java'
			});
			expect(result.firstVariables).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'number', type: 'int', value: '68' }),
					expect.objectContaining({
						name: 'wide',
						type: 'long',
						value: '9007199254740993'
					}),
					expect.objectContaining({ name: 'text', value: '"hello"' }),
					expect.objectContaining({ name: 'missing', value: 'null' }),
					expect.objectContaining({ name: 'negativeZero', value: '-0.0' }),
					expect.objectContaining({ name: 'values', indexedVariables: 3 })
				])
			);
			expect(result.arrayPage).toEqual([
				expect.objectContaining({ name: '[1]', value: '69' }),
				expect.objectContaining({ name: '[2]', value: '70' })
			]);
			expect(result.matrixPage).toEqual([
				expect.objectContaining({ name: '[0]', indexedVariables: 2 }),
				expect.objectContaining({ name: '[1]', indexedVariables: 1 })
			]);
			expect(result.rowPage.map((item: any) => item.value)).toEqual(['68', '69']);
			const object = result.firstVariables.find((item: any) => item.name === 'opaque');
			expect(object).toMatchObject({
				namedVariables: 5,
				variablesReference: expect.any(Number)
			});
			expect(object.variablesReference).toBeGreaterThan(0);
			expect(
				result.firstVariables.find((item: any) => item.name === 'alias').variablesReference
			).toBe(object.variablesReference);
			expect(result.objectFields).toEqual([
				expect.objectContaining({
					name: 'value',
					type: 'int',
					value: '7',
					variablesReference: 0
				}),
				expect.objectContaining({
					name: 'secret',
					type: 'String',
					value: '"hidden"',
					variablesReference: 0
				}),
				expect.objectContaining({
					name: 'next',
					type: 'Opaque',
					variablesReference: object.variablesReference,
					namedVariables: 5
				}),
				expect.objectContaining({ name: 'data', type: 'int[]', indexedVariables: 2 }),
				expect.objectContaining({
					name: 'missing',
					type: 'Object',
					value: 'null',
					variablesReference: 0
				})
			]);
			expect(result.objectPage).toEqual(result.objectFields.slice(1, 3));
			expect(result.beyondFields).toEqual([]);
			expect(result.objectArray.map((item: any) => item.value)).toEqual(['5', '8']);
			expect(result.referenceArray.map((item: any) => item.variablesReference)).toEqual([
				object.variablesReference,
				object.variablesReference,
				0
			]);
			for (const name of ['anonymous', 'library'])
				expect(result.firstVariables.find((item: any) => item.name === name)).toMatchObject(
					{ variablesReference: 0 }
				);
			expect(result.nextObjectFields.find((item: any) => item.name === 'value').value).toBe(
				'8'
			);
			expect(result.staleObjectError).toMatch(/stale|unknown/i);
			expect(result.evaluations).toEqual({
				'number + 5': '73',
				'wide + 1L': '9007199254740994',
				'text.substring(1)': '"ello"',
				'missing == null': 'true',
				'unit + 1': '66',
				'1.0 / negativeZero': '-Infinity',
				'number unchanged': '68',
				'number + 5 after step': '74'
			});
			expect(Object.keys(result.rejected)).toEqual([
				'values[0]',
				'opaque.toString()',
				'number++'
			]);
			expect(result.callerScopes).toEqual([]);
			expect(result.callerError).toContain('currently stopped frame');
			expect(result.nextVariables).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: 'number', value: '69' })])
			);
			expect(result.staleError).toMatch(/stale|unknown/i);
			expect(pageErrors).toEqual([]);
		} finally {
			await browser.close();
		}
	}
);
