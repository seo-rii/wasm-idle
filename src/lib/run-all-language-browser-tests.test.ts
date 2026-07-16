// @vitest-environment node

import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
	createAllLanguageBrowserTestPlan,
	createVitestChildInvocation,
	parseAllLanguageBrowserTestArgs,
	runAllLanguageBrowserTests
} from '../../scripts/run-all-language-browser-tests.mjs';
import { supportMatrixRows } from '../../scripts/support-matrix.mjs';

describe('all-language browser test runner', () => {
	it('includes every browserTest environment declared by the support matrix', () => {
		const plan = createAllLanguageBrowserTestPlan();
		expect(supportMatrixRows.filter((row) => !row.browserTest)).toEqual([]);
		const expectedEnvironments = [
			...new Set(
				supportMatrixRows.flatMap((row) => (row.browserTest ? [row.browserTest.env] : []))
			)
		].sort();

		expect(Object.keys(plan.env).sort()).toEqual(expectedEnvironments);
		for (const row of supportMatrixRows) {
			if (!row.browserTest) continue;
			expect(plan.env[row.browserTest.env]).toBe('1');
			expect(plan.testFiles).toContain(row.browserTest.file);
		}
		expect(new Set(plan.testFiles).size).toBe(plan.testFiles.length);
	});

	it('adds compressed assets and the full LSP matrix only when requested', () => {
		const defaultPlan = createAllLanguageBrowserTestPlan();
		expect(defaultPlan.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_COMPRESSED_ASSETS');
		expect(defaultPlan.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_LSP');

		const fullPlan = createAllLanguageBrowserTestPlan({
			includeCompressedAssets: true,
			includeLspFull: true
		});
		expect(fullPlan.testFiles).toContain(
			'src/lib/playground/compressed-runtime-assets.playwright.test.ts'
		);
		expect(fullPlan.testFiles).toContain('src/routes/monaco-lsp.playwright.test.ts');
		expect(fullPlan.env.WASM_IDLE_RUN_REAL_BROWSER_COMPRESSED_ASSETS).toBe('1');
		expect(fullPlan.env.WASM_IDLE_RUN_REAL_BROWSER_LSP).toBe('1');
	});

	it('configures one serial Vitest child to reuse the local preview', () => {
		const plan = createAllLanguageBrowserTestPlan({ includeLspFull: true });
		const invocation = createVitestChildInvocation(plan, 'http://127.0.0.1:4573/wasm-idle/', {
			NODE_ENV: 'test',
			PATH: '/test/bin',
			VITEST_POOL_ID: 'parent',
			WASM_IDLE_LSP_BROWSER_GROUPS: 'document',
			WASM_IDLE_LSP_BROWSER_LANGUAGES: 'CPP'
		});

		expect(invocation.command).toBe('pnpm');
		expect(invocation.args.slice(0, 5)).toEqual([
			'exec',
			'vitest',
			'run',
			'--no-file-parallelism',
			'--maxWorkers=1'
		]);
		expect(invocation.args.slice(5)).toEqual(plan.testFiles);
		expect(invocation.env).toMatchObject({
			PATH: '/test/bin',
			WASM_IDLE_BROWSER_SERVER_MODE: 'preview',
			WASM_IDLE_BROWSER_URL: 'http://127.0.0.1:4573/wasm-idle/',
			WASM_IDLE_REUSE_LOCAL_PREVIEW: '1'
		});
		expect(invocation.env).not.toHaveProperty('NODE_ENV');
		expect(invocation.env).not.toHaveProperty('VITEST_POOL_ID');
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_LSP_BROWSER_GROUPS');
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_LSP_BROWSER_LANGUAGES');
	});

	it('prepares and starts once, preserves the Vitest exit code, and closes the server', async () => {
		const prepare = vi.fn().mockResolvedValue(undefined);
		const close = vi.fn().mockResolvedValue(undefined);
		const startPreview = vi.fn().mockResolvedValue({
			browserUrl: 'http://127.0.0.1:4573/wasm-idle/',
			close
		});
		const spawnProcess = vi.fn(
			(_command: string, _args: readonly string[], _options: unknown) => {
				const child = new EventEmitter();
				queueMicrotask(() => child.emit('exit', 23, null));
				return child;
			}
		);

		await expect(
			runAllLanguageBrowserTests(
				{ includeCompressedAssets: true },
				{ prepare, spawnProcess: spawnProcess as never, startPreview }
			)
		).resolves.toBe(23);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(prepare).toHaveBeenCalledWith(['build:preview', 'compress:build-runtimes'], {
			timeoutMs: 900_000
		});
		expect(startPreview).toHaveBeenCalledTimes(1);
		expect(spawnProcess).toHaveBeenCalledTimes(1);
		expect(spawnProcess.mock.calls[0]?.[2]).toMatchObject({
			cwd: expect.stringMatching(/\/wasm-idle$/),
			stdio: 'inherit'
		});
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('parses explicit optional suites and rejects unknown options', () => {
		expect(
			parseAllLanguageBrowserTestArgs(['--include-compressed-assets', '--include-lsp-full'])
		).toEqual({ includeCompressedAssets: true, includeLspFull: true });
		expect(() => parseAllLanguageBrowserTestArgs(['--unknown'])).toThrow(
			'Unknown option: --unknown'
		);
	});
});
