// @vitest-environment node

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DebugSessionEvent } from '@wasm-idle/core';
import type { DebugSessionController } from '../../../packages/debug/src/controller';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';
import { createCoreSourceAliases } from '../../../scripts/core-source-aliases.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import type { SandboxExecutionOptions } from './options';
import type Python from './python';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_PYTHON_DEBUG === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };
const browserTestOptions = { meta: browserMeta, timeout: 60_000 };
const root = fileURLToPath(new URL('../../../', import.meta.url));

type PythonDebugFixture = {
	python: Python;
	session: DebugSessionController;
	events: DebugSessionEvent[];
	output: string;
	completed: boolean;
	failure: string | null;
	worker: Worker;
	gate?: Int32Array;
	start: (
		code: string,
		breakpoints: number[],
		pauseOnEntry?: boolean,
		options?: SandboxExecutionOptions
	) => void;
};

declare global {
	var __pythonDebugFixture: PythonDebugFixture;
}

describe.skipIf(!enabled)('real Python live breakpoints in Chromium', () => {
	let server: ViteDevServer;
	let browser: Browser;
	let page: Page;
	const pageErrors: string[] = [];

	beforeAll(async () => {
		// Mount the actual scope markup, isolated from unrelated playground runtimes.
		const pageSource = readFileSync(`${root}src/routes/+page.svelte`, 'utf8');
		const scopeStart = pageSource.indexOf('<div class="debug-scopes">');
		const scopeEnd = pageSource.indexOf('{:else if debug.locals.length}', scopeStart);
		expect(scopeStart).toBeGreaterThan(0);
		expect(scopeEnd).toBeGreaterThan(scopeStart);
		const scopeView = compile(
			`<script>let { debug } = $props(); let debugScopeOpen = $state({});</script>
{#snippet debugNodeRows(nodes)}{#each nodes as node (node.path)}<li>{node.variable.name}: {node.variable.value}</li>{/each}{/snippet}
${pageSource.slice(scopeStart, scopeEnd)}`,
			{ generate: 'client', filename: 'PythonDebugScopes.svelte' }
		).js.code;
		// Exercise the actual adapter and Pyodide worker without building unrelated runtimes.
		server = await createServer({
			configFile: false,
			root,
			publicDir: process.env.WASM_IDLE_PYTHON_DEBUG_STATIC_DIR || 'static',
			cacheDir: `${root}.cache/python-debug-browser-vite`,
			optimizeDeps: { noDiscovery: true },
			resolve: {
				alias: [
					{ find: '$lib', replacement: `${root}src/lib` },
					{
						find: '@wasm-idle/llvm-core/core',
						replacement: `${root}packages/llvm-core/runtime/core/src`
					},
					{
						find: /^@wasm-idle\/llvm-core$/,
						replacement: `${root}packages/llvm-core/runtime/core/src/index.ts`
					},
					...createCoreSourceAliases(root)
				]
			},
			plugins: [
				{
					name: 'python-debug-scope-fixture',
					resolveId(id) {
						if (id === 'virtual:python-scope') return '\0python-scope';
					},
					load(id) {
						if (id === '\0python-scope')
							return scopeView + `\nexport { mount } from 'svelte';`;
					}
				},
				{
					name: 'python-debug-test-page',
					configureServer(vite) {
						vite.middlewares.use((request, response, next) => {
							if (request.url !== '/') return next();
							response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
							response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
							response.setHeader('Content-Type', 'text/html');
							response.end(
								'<!doctype html><title>Python live breakpoint regression</title>'
							);
						});
					}
				}
			],
			server: {
				watch: null,
				host: '127.0.0.1',
				port: 0,
				headers: {
					'Cross-Origin-Opener-Policy': 'same-origin',
					'Cross-Origin-Embedder-Policy': 'require-corp'
				}
			}
		});
		await server.listen();
		const address = server.httpServer?.address();
		if (!address || typeof address === 'string') throw new Error('Missing test server port');
		const browserUrl = `http://127.0.0.1:${address.port}/`;
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		const context = await browser.newContext();
		await addBrowserTestCookies(context, browserUrl);
		page = await context.newPage();
		page.setDefaultTimeout(30_000);
		page.on('pageerror', (error) => pageErrors.push(error.message));
		page.on('requestfailed', (request) =>
			pageErrors.push(`${request.url()}: ${request.failure()?.errorText}`)
		);
		await page.goto(browserUrl);
		await installBrowserRuntimeDelivery(page, browserUrl);
		await page.addScriptTag({
			type: 'module',
			content: `
import Python from '/src/lib/playground/python.ts';
import { createDebugSessionController } from '/packages/debug/src/controller.ts';
import ScopeView, { mount } from '/@id/virtual:python-scope';
const python = new Python();
const session = createDebugSessionController({
    sourcePath: 'main.py',
    terminal: {
        setBreakpoints: async (lines) => python.setBreakpoints(lines),
        debugCommand: async (command) => python.debugCommand(command),
        debugVariables: (reference, start, count) => python.debugVariables(reference, start, count)
    }
});
mount(ScopeView, { target: document.body, props: { debug: session } });
const fixture = globalThis.__pythonDebugFixture = {
    python, session, events: [], output: '', completed: false, failure: null,
    start(code, breakpoints, pauseOnEntry = false, options = {}) {
        fixture.events = [];
        fixture.output = '';
        fixture.completed = false;
        fixture.failure = null;
        fixture.gate = undefined;
        session.reset();
        session.setSourcePath(options.debugPath || options.activePath || 'main.py');
        session.setBreakpoints(breakpoints);
        session.begin();
        python.run(code, false, false, undefined, [], {
            debug: true, breakpoints, pauseOnEntry, activePath: 'main.py', ...options
        }).then(() => { fixture.completed = true; }, (error) => {
            fixture.failure = String(error);
            fixture.completed = true;
        });
    }
};
python.ondebug = (event) => {
    fixture.events.push(event);
    session.handleEvent(event);
};
python.output = (text) => { fixture.output += text; };
try {
    await python.load({ python: { baseUrl: new URL('pyodide/', location.href).href } });
    fixture.worker = python.worker;
    python.worker.addEventListener('message', ({ data }) => {
        if (data?.pythonDebugTestGate) fixture.gate = new Int32Array(data.pythonDebugTestGate);
    });
    fixture.ready = true;
} catch (error) { fixture.failure = String(error); }
`
		});
		await page
			.waitForFunction(
				() =>
					(globalThis.__pythonDebugFixture as any)?.ready ||
					globalThis.__pythonDebugFixture?.failure,
				undefined,
				{ timeout: 90_000 }
			)
			.catch((error) => {
				throw new Error(`${String(error)}; page errors: ${pageErrors.join('; ')}`);
			});
		expect(await page.evaluate(() => globalThis.__pythonDebugFixture.failure)).toBeNull();
		expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
	}, 120_000);

	afterAll(async () => {
		if (page && !page.isClosed()) {
			await page.evaluate(() => globalThis.__pythonDebugFixture?.python.dispose());
		}
		await browser?.close();
		await server?.close();
	});

	async function waitForPause(line: number) {
		await page.waitForFunction(() => {
			const fixture = globalThis.__pythonDebugFixture;
			return fixture.session.paused || fixture.completed;
		});
		const state = await page.evaluate(() => {
			const fixture = globalThis.__pythonDebugFixture;
			return {
				paused: fixture.session.paused,
				line: fixture.session.pausedLine,
				failure: fixture.failure,
				events: fixture.events,
				sameWorker: fixture.worker === fixture.python.worker
			};
		});
		expect(state, JSON.stringify(state)).toMatchObject({
			paused: true,
			line,
			failure: null,
			sameWorker: true
		});
	}

	async function waitForCompletion(output: string, pauseLines: number[]) {
		await page.waitForFunction(() => globalThis.__pythonDebugFixture.completed);
		const state = await page.evaluate(() => {
			const fixture = globalThis.__pythonDebugFixture;
			return {
				failure: fixture.failure,
				output: fixture.output,
				pauseLines: fixture.events
					.filter((event) => event.type === 'pause')
					.map((event) => event.line),
				sameWorker: fixture.worker === fixture.python.worker
			};
		});
		expect(state.failure).toBeNull();
		expect(state.output.trim()).toBe(output);
		expect(state.pauseLines).toEqual(pauseLines);
		expect(state.sameWorker).toBe(true);
		expect(pageErrors).toEqual([]);
	}

	it(
		'adds and removes breakpoints while paused and continues the same execution',
		browserTestOptions,
		async () => {
			await page.evaluate(() => {
				globalThis.__pythonDebugFixture.start(
					'value = 70\nvalue += 1\nvalue += 2\nvalue += 3\nprint("paused=" + str(value))',
					[2, 3]
				);
			});
			await waitForPause(2);
			await page.evaluate(async () => {
				const { session } = globalThis.__pythonDebugFixture;
				session.setBreakpoints([4]);
				await session.sendCommand('continue');
			});
			await waitForPause(4);
			await page.evaluate(async () => {
				const { session } = globalThis.__pythonDebugFixture;
				session.setBreakpoints([]);
				await session.sendCommand('continue');
			});
			await waitForCompletion('paused=76', [2, 4]);
		}
	);

	it('adds and removes breakpoints while Python is running', browserTestOptions, async () => {
		await page.evaluate(() => {
			globalThis.__pythonDebugFixture.start(
				`import js
from pyodide.ffi import to_js
gate = js.Int32Array.new(js.SharedArrayBuffer.new(4))
js.postMessage(to_js({"pythonDebugTestGate": gate.buffer}, dict_converter=js.Object.fromEntries))
while js.Atomics.load(gate, 0) == 0:
    pass
value = 70
value += 3
print("running=" + str(value))`,
				[7]
			);
		});
		// The real worker signals that user code is executing, then spins until the
		// main thread changes the breakpoint list. No debugger pause or timing race.
		await page.waitForFunction(() => !!globalThis.__pythonDebugFixture.gate);
		expect(await page.evaluate(() => globalThis.__pythonDebugFixture.session.paused)).toBe(
			false
		);
		await page.evaluate(() => {
			const fixture = globalThis.__pythonDebugFixture;
			fixture.session.setBreakpoints([8]);
			Atomics.store(fixture.gate!, 0, 1);
		});
		await waitForPause(8);
		await page.evaluate(async () => {
			const { session } = globalThis.__pythonDebugFixture;
			session.setBreakpoints([]);
			await session.sendCommand('continue');
		});
		await waitForCompletion('running=73', [8]);
	});

	it('runs to the cursor once and restores regular breakpoints', browserTestOptions, async () => {
		await page.evaluate(() => {
			globalThis.__pythonDebugFixture.start(
				'value = 0\nfor index in range(2):\n    value += 1\nprint("cursor=" + str(value))',
				[4],
				true
			);
		});
		await waitForPause(1);
		expect(
			await page.evaluate(() => globalThis.__pythonDebugFixture.session.runToCursor(3))
		).toBe(true);
		await waitForPause(3);
		expect(
			await page.evaluate(() => globalThis.__pythonDebugFixture.session.effectiveBreakpoints)
		).toEqual([4]);
		await page.evaluate(() => globalThis.__pythonDebugFixture.session.sendCommand('continue'));
		await waitForPause(4);
		await page.evaluate(() => globalThis.__pythonDebugFixture.session.sendCommand('continue'));
		await waitForCompletion('cursor=2', [1, 3, 4]);
	});

	it(
		'updates live breakpoints in a debug file imported by a separate entry',
		browserTestOptions,
		async () => {
			await page.evaluate(() => {
				globalThis.__pythonDebugFixture.start(
					'from submissions.student import main\nmain()',
					[3, 4],
					true,
					{
						activePath: 'runner.py',
						debugPath: 'submissions/student.py',
						workspaceFiles: [
							{
								path: 'submissions/student.py',
								content:
									'def main():\n    value = 1\n    value += 2\n    value += 4\n    value += 8\n    print(f"imported={value}")'
							}
						]
					}
				);
			});
			await waitForPause(1);
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.session.sendCommand('continue')
			);
			await waitForPause(3);
			await page.evaluate(async () => {
				const { session } = globalThis.__pythonDebugFixture;
				session.setBreakpoints([5]);
				await session.sendCommand('continue');
			});
			await waitForPause(5);
			expect(
				await page.evaluate(() => globalThis.__pythonDebugFixture.session.locals)
			).toContainEqual({ name: 'value', value: '7' });
			expect(
				await page.evaluate(() => globalThis.__pythonDebugFixture.session.callStack)
			).toEqual([{ functionName: 'main', line: 5 }]);
			await page.evaluate(async () => {
				const { session } = globalThis.__pythonDebugFixture;
				session.setBreakpoints([]);
				await session.sendCommand('continue');
			});
			await waitForCompletion('imported=15', [1, 3, 5]);
		}
	);

	it(
		'pages locals lazily and serializes watch inspection without leaking stale references',
		browserTestOptions,
		async () => {
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.start(
					'def main():\n' +
						Array.from(
							{ length: 120 },
							(_, index) => `    local_${index} = ${index}\n`
						).join('') +
						'    print("locals done")\nmain()',
					[122]
				)
			);
			await waitForPause(122);
			await page.waitForFunction(
				() => document.querySelectorAll('.debug-scopes li').length === 50
			);
			await page.getByRole('button', { name: 'Load more locals' }).click();
			await page.waitForFunction(
				() => document.querySelectorAll('.debug-scopes li').length === 100
			);
			expect(await page.locator('.debug-scopes li').last().textContent()).toBe(
				'local_99: 99'
			);
			const inspected = await page.evaluate(async () => {
				const fixture = globalThis.__pythonDebugFixture;
				const pause = fixture.events.filter((event) => event.type === 'pause').at(-1)!;
				const reference = pause.scopes![0].variablesReference;
				const [second, watch, third] = await Promise.all([
					fixture.python.debugVariables(reference, 50, 50),
					fixture.python.debugEvaluate('local_119'),
					fixture.python.debugVariables(reference, 100, 50)
				]);
				await fixture.session.sendCommand('continue');
				return {
					first: pause.locals,
					second,
					third,
					watch,
					stale: await fixture.python.debugVariables(reference, 50, 50)
				};
			});
			expect(inspected.first).toHaveLength(50);
			expect(inspected.second).toHaveLength(50);
			expect(inspected.second[0]).toEqual({ name: 'local_50', value: '50' });
			expect(inspected.third).toHaveLength(20);
			expect(inspected.third.at(-1)).toEqual({ name: 'local_119', value: '119' });
			expect(inspected.watch).toBe('119');
			expect(inspected.stale).toEqual([]);
			await waitForCompletion('locals done', [122]);
		}
	);

	it(
		'steps into, over and out of a function with current locals',
		browserTestOptions,
		async () => {
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.start(
					'def add(value):\n    value += 1\n    return value\nvalue = 10\nresult = add(value)\nprint(f"stepped={result}")',
					[4]
				)
			);
			await waitForPause(4);
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.session.sendCommand('nextLine')
			);
			await waitForPause(5);
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.session.sendCommand('stepInto')
			);
			await waitForPause(2);
			expect(
				await page.evaluate(() =>
					globalThis.__pythonDebugFixture.python.debugEvaluate('value')
				)
			).toBe('10');
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.session.sendCommand('nextLine')
			);
			await waitForPause(3);
			expect(
				await page.evaluate(() =>
					globalThis.__pythonDebugFixture.python.debugEvaluate('value')
				)
			).toBe('11');
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.session.sendCommand('stepOut')
			);
			await waitForPause(6);
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.session.sendCommand('continue')
			);
			await waitForCompletion('stepped=11', [4, 5, 2, 3, 6]);
		}
	);

	it(
		'keeps repeated-line stepping on the same worker across debug runs',
		browserTestOptions,
		async () => {
			for (const command of ['stepInto', 'nextLine'] as const) {
				await page.evaluate(() =>
					globalThis.__pythonDebugFixture.start(
						'value = 0\nwhile value < 3: value += 1\nprint(value)',
						[],
						true
					)
				);
				await waitForPause(1);
				// Pinned CPython 3.14 also reports the final, false while condition.
				for (const value of [0, 1, 2, 3]) {
					await page.evaluate(
						(next) => globalThis.__pythonDebugFixture.session.sendCommand(next),
						command
					);
					await waitForPause(2);
					expect(
						await page.evaluate(() =>
							globalThis.__pythonDebugFixture.python.debugEvaluate('value')
						)
					).toBe(String(value));
				}
				await page.evaluate(
					(next) => globalThis.__pythonDebugFixture.session.sendCommand(next),
					command
				);
				await waitForPause(3);
				await page.evaluate(() =>
					globalThis.__pythonDebugFixture.session.sendCommand('continue')
				);
				await waitForCompletion('3', [1, 2, 2, 2, 2, 3]);
			}
		}
	);

	it('steps out of recursion to the selected caller', browserTestOptions, async () => {
		await page.evaluate(() =>
			globalThis.__pythonDebugFixture.start(
				'def recur(n):\n    if n == 0:\n        return 0\n    value = recur(n - 1)\n    return value + 1\nvalue = recur(2)\nprint(value)',
				[6]
			)
		);
		await waitForPause(6);
		for (const [command, line, n] of [
			['stepInto', 2, '2'],
			['nextLine', 4, '2'],
			['stepInto', 2, '1'],
			['stepOut', 5, '2']
		] as const) {
			await page.evaluate(
				(next) => globalThis.__pythonDebugFixture.session.sendCommand(next),
				command
			);
			await waitForPause(line);
			expect(
				await page.evaluate(() => globalThis.__pythonDebugFixture.python.debugEvaluate('n'))
			).toBe(n);
		}
		await page.evaluate(() => globalThis.__pythonDebugFixture.session.sendCommand('continue'));
		await waitForCompletion('2', [6, 2, 4, 2, 5]);
	});

	it(
		'keeps interactive input and output across a cached debug helper',
		browserTestOptions,
		async () => {
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.start(
					'value = input("value: ")\nvalue = int(value) + 1\nprint(value)',
					[2]
				)
			);
			await page.waitForFunction(() =>
				globalThis.__pythonDebugFixture.output.includes('value: ')
			);
			await page.evaluate(() => globalThis.__pythonDebugFixture.python.write('41\n'));
			await waitForPause(2);
			expect(
				await page.evaluate(() =>
					globalThis.__pythonDebugFixture.python.debugEvaluate('value')
				)
			).toBe("'41'");
			await page.evaluate(() =>
				globalThis.__pythonDebugFixture.session.sendCommand('continue')
			);
			await waitForCompletion('value: 42', [2]);
		}
	);

	it('cancels a paused program after inspecting its locals', browserTestOptions, async () => {
		await page.evaluate(() =>
			globalThis.__pythonDebugFixture.start(
				'def main():\n    value = 1\n    while True:\n        value += 1\nmain()',
				[3]
			)
		);
		await waitForPause(3);
		await page.waitForFunction(
			() => document.querySelectorAll('.debug-scopes li').length === 1
		);
		expect(await page.locator('.debug-scopes li').textContent()).toBe('value: 1');
		await page.evaluate(async () => {
			const fixture = globalThis.__pythonDebugFixture;
			await fixture.python.debugEvaluate('value');
			fixture.python.terminate('cancel debug test');
		});
		await page.waitForFunction(() => globalThis.__pythonDebugFixture.completed);
		expect(await page.evaluate(() => globalThis.__pythonDebugFixture.failure)).toContain(
			'cancel debug test'
		);
	});
});
