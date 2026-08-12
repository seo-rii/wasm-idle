// @vitest-environment node

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
	ALL_LANGUAGE_BROWSER_TEST_SHARDS,
	browserTestShardForRow,
	createAllLanguageBrowserTestPlan,
	createVitestChildInvocation,
	parseAllLanguageBrowserTestArgs,
	runAllLanguageBrowserTests
} from '../../scripts/run-all-language-browser-tests.mjs';
import { supportMatrixRows } from '../../scripts/support-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

	it('partitions every support-matrix language into exactly one scheduled shard', () => {
		const languageShards = ALL_LANGUAGE_BROWSER_TEST_SHARDS.filter(
			(shard) => shard !== 'compressed-assets'
		);
		const assignedLanguages = new Set<string>();
		for (const shard of languageShards) {
			const plan = createAllLanguageBrowserTestPlan({ shard });
			const shardRows = supportMatrixRows.filter(
				(row) => row.browserTest && browserTestShardForRow(row) === shard
			);
			const expectedFiles = new Set(shardRows.map((row) => row.browserTest!.file));
			const expectedEnvironments = new Set(
				shardRows.map((row) =>
					row.browserTest!.env === 'WASM_IDLE_RUN_REAL_BROWSER_STDIN'
						? 'WASM_IDLE_RUN_REAL_BROWSER_STDIN_SHARED_ONLY'
						: row.browserTest!.env
				)
			);
			expect(new Set(plan.testFiles)).toEqual(expectedFiles);
			expect(new Set(Object.keys(plan.env))).toEqual(expectedEnvironments);
			for (const row of supportMatrixRows) {
				if (!row.browserTest || browserTestShardForRow(row) !== shard) continue;
				expect(assignedLanguages.has(row.language), row.language).toBe(false);
				assignedLanguages.add(row.language);
				expect(plan.testFiles).toContain(row.browserTest.file);
				if (row.browserTest.env === 'WASM_IDLE_RUN_REAL_BROWSER_STDIN') {
					expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN_SHARED_ONLY).toBe('1');
					expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN).toBeUndefined();
				} else {
					expect(plan.env[row.browserTest.env]).toBe('1');
				}
			}
		}
		expect(assignedLanguages).toEqual(new Set(supportMatrixRows.map((row) => row.language)));

		const compressedPlan = createAllLanguageBrowserTestPlan({ shard: 'compressed-assets' });
		expect(compressedPlan).toEqual({
			env: { WASM_IDLE_RUN_REAL_BROWSER_COMPRESSED_ASSETS: '1' },
			testFiles: ['src/lib/playground/compressed-runtime-assets.playwright.test.ts']
		});
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

	it('removes ambient browser-suite switches before applying a shard plan', () => {
		const plan = createAllLanguageBrowserTestPlan({ shard: 'stdin' });
		const invocation = createVitestChildInvocation(plan, 'http://127.0.0.1:4573/wasm-idle/', {
			WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN: '1',
			WASM_IDLE_RUN_REAL_BROWSER_STDIN: '1'
		});

		expect(invocation.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN_SHARED_ONLY).toBe('1');
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN');
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_STDIN');
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
			cwd: repositoryRoot,
			stdio: 'inherit'
		});
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('parses explicit optional suites and shards and rejects invalid options', () => {
		expect(
			parseAllLanguageBrowserTestArgs([
				'--include-compressed-assets',
				'--include-lsp-full',
				'--shard',
				'llvm'
			])
		).toEqual({ includeCompressedAssets: true, includeLspFull: true, shard: 'llvm' });
		expect(parseAllLanguageBrowserTestArgs(['--shard=workers'])).toEqual({
			includeCompressedAssets: false,
			includeLspFull: false,
			shard: 'workers'
		});
		expect(() => parseAllLanguageBrowserTestArgs(['--shard'])).toThrow(
			'Missing value for --shard'
		);
		expect(() => parseAllLanguageBrowserTestArgs(['--shard=missing'])).toThrow(
			'Unknown browser test shard: missing'
		);
		expect(() => parseAllLanguageBrowserTestArgs(['--unknown'])).toThrow(
			'Unknown option: --unknown'
		);
	});
});
