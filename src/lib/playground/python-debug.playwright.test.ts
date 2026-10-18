// @vitest-environment node

import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DebugSessionEvent } from '@wasm-idle/core';
import type { DebugSessionController } from '../../../packages/debug/src/controller';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';
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
		// Exercise the actual adapter and Pyodide worker without building unrelated runtimes.
		server = await createServer({
			configFile: false,
			root,
			publicDir: 'static',
			cacheDir: `${root}.cache/python-debug-browser-vite`,
			optimizeDeps: { noDiscovery: true },
			resolve: {
				alias: {
					$lib: `${root}src/lib`,
					'@wasm-idle/core': `${root}packages/core/src/index.ts`
				}
			},
			plugins: [
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
		await page.goto(browserUrl);
		await installBrowserRuntimeDelivery(page, browserUrl);
		await page.addScriptTag({
			type: 'module',
			content: `
import Python from '/src/lib/playground/python.ts';
import { createDebugSessionController } from '/packages/debug/src/controller.ts';
const python = new Python();
const session = createDebugSessionController({
    sourcePath: 'main.py',
    terminal: {
        setBreakpoints: async (lines) => python.setBreakpoints(lines),
        debugCommand: async (command) => python.debugCommand(command)
    }
});
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
await python.load({ python: { baseUrl: new URL('pyodide/', location.href).href } });
fixture.worker = python.worker;
python.worker.addEventListener('message', ({ data }) => {
    if (data?.pythonDebugTestGate) fixture.gate = new Int32Array(data.pythonDebugTestGate);
});
fixture.ready = true;
`
		});
		await page.waitForFunction(() => (globalThis.__pythonDebugFixture as any)?.ready);
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
});
