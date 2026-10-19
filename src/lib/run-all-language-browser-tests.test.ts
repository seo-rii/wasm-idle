// @vitest-environment node

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
	ALL_LANGUAGE_BROWSER_TEST_SHARDS,
	browserTestShardForRow,
	browserTestAssetGroups,
	createAllLanguageBrowserTestPlan,
	createVitestChildInvocation,
	parseAllLanguageBrowserTestArgs,
	runAllLanguageBrowserTests
} from '../../scripts/run-all-language-browser-tests.mjs';
import { supportMatrixRows } from '../../scripts/support-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceFiles = [
	'src/routes/workspace-archive.playwright.test.ts',
	'src/routes/workspace-import.playwright.test.ts',
	'src/routes/workspace-storage.playwright.test.ts',
	'src/routes/workspace-identity.playwright.test.ts',
	'src/routes/workspace-share-paths.playwright.test.ts',
	'src/routes/workspace-banners.playwright.test.ts',
	'src/routes/workspace-whitespace-paths.playwright.test.ts',
	'src/routes/debugger-toolbar-layout.playwright.test.ts',
	'src/routes/container-sidebar.playwright.test.ts'
];

describe('all-language browser test runner', () => {
	it('keeps explicit full-matrix options when selecting the workspace shard', () => {
		const plan = createAllLanguageBrowserTestPlan({
			shard: 'workspace',
			includeCompressedAssets: true,
			includeLspFull: true
		});
		for (const file of workspaceFiles) expect(plan.testFiles).toContain(file);
		expect(plan.testFiles).toContain(
			'src/lib/playground/compressed-runtime-assets.playwright.test.ts'
		);
		expect(plan.testFiles).toContain('src/routes/monaco-lsp.playwright.test.ts');
		expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_COMPRESSED_ASSETS).toBe('1');
		expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_LSP).toBe('1');
	});
	it.each(['--family=workspace', '--shard=workspace'])(
		'enables every workspace browser case and its assets with %s',
		(arg) => {
			const plan = createAllLanguageBrowserTestPlan(parseAllLanguageBrowserTestArgs([arg]));
			expect(plan.testFiles).toEqual(workspaceFiles);
			expect(plan.env).toEqual({
				WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_ARCHIVE: '1',
				WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_REGRESSIONS: '1',
				WASM_IDLE_RUN_CONTAINER_WEBSITE_BROWSER: '1'
			});
			expect(browserTestAssetGroups(plan)).toEqual(['container', 'clang']);
			const child = createVitestChildInvocation(plan, 'http://127.0.0.1:4573/wasm-idle/');
			expect(child.env.WASM_IDLE_REQUIRE_BROWSER_TESTS).toBe('1');
			expect(child.args).toContain('--no-file-parallelism');
			expect(child.args.slice(5)).toEqual(workspaceFiles);
			for (const file of workspaceFiles)
				expect(createAllLanguageBrowserTestPlan().testFiles).toContain(file);
		}
	);
	it.each([
		['PR workspace family', { family: 'workspace' }],
		['scheduled workspace shard', { shard: 'workspace' }],
		['full matrix', {}]
	] as const)('requires real Bash and folder navigation in the %s', (_name, options) => {
		const plan = createAllLanguageBrowserTestPlan(options);
		const child = createVitestChildInvocation(plan, 'http://127.0.0.1:4573/wasm-idle/');
		expect(child.args).toContain('src/routes/container-sidebar.playwright.test.ts');
		expect(child.env.WASM_IDLE_RUN_CONTAINER_WEBSITE_BROWSER).toBe('1');
		expect(child.env.WASM_IDLE_REQUIRE_BROWSER_TESTS).toBe('1');
		expect(browserTestAssetGroups(plan)).toContain('container');
	});
	it.each([
		[
			'go',
			{ WASM_IDLE_RUN_REAL_BROWSER_GO: '1' },
			['src/lib/playground/go.playwright.test.ts']
		],
		[
			'python',
			{
				WASM_IDLE_RUN_REAL_BROWSER_PYTHON: '1',
				WASM_IDLE_RUN_REAL_BROWSER_PYTHON_DEBUG: '1'
			},
			[
				'src/lib/playground/python.playwright.test.ts',
				'src/lib/playground/python-debug.playwright.test.ts'
			]
		]
	] as const)(
		'enables required real %s coverage for changes to its runtime family',
		(family, env, files) => {
			const options = parseAllLanguageBrowserTestArgs([`--family=${family}`]);
			const plan = createAllLanguageBrowserTestPlan(options);
			expect(plan.env).toEqual(env);
			expect(plan.testFiles).toEqual(files);
			const invocation = createVitestChildInvocation(
				plan,
				'http://127.0.0.1:4573/wasm-idle/'
			);
			for (const [key, value] of Object.entries(env)) expect(invocation.env[key]).toBe(value);
			expect(invocation.env.WASM_IDLE_REQUIRE_BROWSER_TESTS).toBe('1');
			expect(invocation.args.slice(5)).toEqual(files);
		}
	);
	it('derives asset preparation from the enabled suites and keeps Objective-C++ in LLVM', () => {
		const specialized = createAllLanguageBrowserTestPlan({ shard: 'specialized' });
		expect(browserTestAssetGroups(specialized)).toEqual([
			'container',
			'ocaml',
			'c3',
			'lfortran',
			'lean4',
			'commonlisp'
		]);
		for (const env of ['C3', 'LFORTRAN', 'LEAN4', 'COMMONLISP', 'OCAML']) {
			expect(specialized.env[`WASM_IDLE_RUN_REAL_BROWSER_${env}`]).toBe('1');
		}
		expect(specialized.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVECXX');
		const objectiveCxx = supportMatrixRows.find((row) => row.ids.includes('OBJECTIVECXX'))!;
		expect(browserTestShardForRow(objectiveCxx)).toBe('llvm');
		const llvm = createAllLanguageBrowserTestPlan({ shard: 'llvm' });
		expect(llvm.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVECXX).toBe('1');
		expect(llvm.testFiles).toContain(objectiveCxx.browserTest!.file);
		expect(browserTestAssetGroups(llvm)).toEqual(['container', 'clang']);
		expect(
			browserTestAssetGroups(createAllLanguageBrowserTestPlan({ shard: 'workers' }))
		).toEqual(['container']);
		expect(
			browserTestAssetGroups(createAllLanguageBrowserTestPlan({ shard: 'stdin' }))
		).toEqual(['container']);
		expect(
			browserTestAssetGroups(createAllLanguageBrowserTestPlan({ shard: 'compressed-assets' }))
		).toEqual(['all']);
	});
	it.each([
		['stdin', ['container']],
		['workers', ['container']],
		['specialized', ['container', 'ocaml', 'c3', 'lfortran', 'lean4', 'commonlisp']]
	] as const)(
		'prepares assets and requires execution for the added %s family',
		(family, groups) => {
			const options = parseAllLanguageBrowserTestArgs([`--family=${family}`]);
			const plan = createAllLanguageBrowserTestPlan(options);
			expect(browserTestAssetGroups(plan)).toEqual(groups);
			const invocation = createVitestChildInvocation(
				plan,
				'http://127.0.0.1:4573/wasm-idle/'
			);
			expect(invocation.env.WASM_IDLE_REQUIRE_BROWSER_TESTS).toBe('1');
			expect(invocation.args.slice(5)).toEqual(plan.testFiles);
			for (const [key, value] of Object.entries(plan.env))
				expect(invocation.env[key]).toBe(value);
		}
	);
	it('includes every browserTest environment declared by the support matrix', () => {
		const plan = createAllLanguageBrowserTestPlan();
		expect(supportMatrixRows.filter((row) => !row.browserTest)).toEqual([]);
		const expectedEnvironments = [
			...new Set(
				supportMatrixRows.flatMap((row) => (row.browserTest ? [row.browserTest.env] : []))
			)
		].sort();

		expect(Object.keys(plan.env).sort()).toEqual(
			[
				...expectedEnvironments,
				'WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS',
				'WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE',
				'WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE',
				'WASM_IDLE_RUN_REAL_BROWSER_DEBUG',
				'WASM_IDLE_REQUIRE_LLDB_DEBUG',
				'WASM_IDLE_DEBUG_BROWSER_LANGUAGES',
				'WASM_IDLE_DEBUG_BROWSER_CASES',
				'WASM_IDLE_RUN_REAL_BROWSER_DOTNET_RECOVERY',
				'WASM_IDLE_RUN_REAL_BROWSER_DOTNET_SWITCH',
				'WASM_IDLE_RUN_REAL_BROWSER_NIM_RECOVERY',
				'WASM_IDLE_RUN_REAL_BROWSER_PYTHON',
				'WASM_IDLE_RUN_REAL_BROWSER_PYTHON_DEBUG',
				'WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_ARCHIVE',
				'WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_REGRESSIONS',
				'WASM_IDLE_RUN_CONTAINER_WEBSITE_BROWSER'
			].sort()
		);
		for (const row of supportMatrixRows) {
			if (!row.browserTest) continue;
			expect(plan.env[row.browserTest.env]).toBe('1');
			expect(plan.testFiles).toContain(row.browserTest.file);
		}
		expect(new Set(plan.testFiles).size).toBe(plan.testFiles.length);
		expect(plan.testFiles).toContain('src/lib/playground/cpp-standards.playwright.test.ts');
		expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS).toBe('1');
		expect(plan.testFiles).toContain('src/lib/playground/long-double.playwright.test.ts');
		expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE).toBe('1');
		expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE).toBe('1');
		expect(plan.testFiles).toContain('src/lib/playground/python-debug.playwright.test.ts');
		expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_PYTHON_DEBUG).toBe('1');
	});

	it('runs the declared Brainfuck suite as required PR-family browser coverage', () => {
		const plan = createAllLanguageBrowserTestPlan({ family: 'esolangs' });
		const interpreterRows = supportMatrixRows.filter(
			(row) => row.browserTest?.file === 'src/lib/playground/esolangs.playwright.test.ts'
		);
		expect(interpreterRows.map((row) => row.ids)).toContainEqual(['BRAINFUCK']);
		expect(plan.testFiles).toEqual(['src/lib/playground/esolangs.playwright.test.ts']);
		expect(plan.env).toEqual(
			Object.fromEntries(interpreterRows.map((row) => [row.browserTest!.env, '1']))
		);
		expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_BRAINFUCK).toBe('1');
		const invocation = createVitestChildInvocation(plan, 'http://127.0.0.1:4573/wasm-idle/');
		expect(invocation.env.WASM_IDLE_REQUIRE_BROWSER_TESTS).toBe('1');
		expect(invocation.env.WASM_IDLE_RUN_REAL_BROWSER_BRAINFUCK).toBe('1');
	});

	it('runs C++ standard and long-double regressions with the Clang family', () => {
		expect(createAllLanguageBrowserTestPlan({ family: 'clang' })).toEqual({
			env: {
				WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN: '1',
				WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS: '1',
				WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE: '1',
				WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE: '1',
				WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC: '1',
				WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVECXX: '1',
				WASM_IDLE_RUN_REAL_BROWSER_FORTRAN: '1',
				WASM_IDLE_RUN_REAL_BROWSER_COBOL: '1',
				WASM_IDLE_RUN_REAL_BROWSER_V: '1'
			},
			testFiles: [
				'src/lib/playground/stdin.playwright.test.ts',
				'src/lib/playground/objectivecxx.playwright.test.ts',
				'src/lib/playground/cpp-standards.playwright.test.ts',
				'src/lib/playground/long-double.playwright.test.ts'
			]
		});
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
			if (shard === 'llvm') {
				expectedFiles.add('src/lib/playground/debug.playwright.test.ts');
				expectedFiles.add('src/lib/playground/cpp-standards.playwright.test.ts');
				expectedFiles.add('src/lib/playground/long-double.playwright.test.ts');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE');
				expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS).toBe('1');
				expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE).toBe('1');
				expect(plan.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE).toBe('1');
				for (const key of [
					'WASM_IDLE_RUN_REAL_BROWSER_DEBUG',
					'WASM_IDLE_REQUIRE_LLDB_DEBUG',
					'WASM_IDLE_DEBUG_BROWSER_LANGUAGES',
					'WASM_IDLE_DEBUG_BROWSER_CASES'
				])
					expectedEnvironments.add(key);
			}
			if (shard === 'stdin') {
				expectedFiles.add('src/lib/playground/runtime-recovery.playwright.test.ts');
				expectedFiles.add('src/lib/playground/dotnet-switch.playwright.test.ts');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_DOTNET_RECOVERY');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_DOTNET_SWITCH');
			}
			if (shard === 'workers') {
				expectedFiles.add('src/lib/playground/runtime-recovery.playwright.test.ts');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_NIM_RECOVERY');
			}
			if (shard === 'specialized') {
				expectedFiles.add('src/lib/playground/python.playwright.test.ts');
				expectedFiles.add('src/lib/playground/python-debug.playwright.test.ts');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_PYTHON');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_PYTHON_DEBUG');
			}
			if (shard === 'workspace') {
				for (const file of workspaceFiles) expectedFiles.add(file);
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_ARCHIVE');
				expectedEnvironments.add('WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_REGRESSIONS');
				expectedEnvironments.add('WASM_IDLE_RUN_CONTAINER_WEBSITE_BROWSER');
			}
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
			WASM_IDLE_REQUIRE_BROWSER_TESTS: '1',
			WASM_IDLE_RUN_REAL_BROWSER_PYTHON_DEBUG: '1',
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
			WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS: '1',
			WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE: '1',
			WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE: '1',
			WASM_IDLE_RUN_REAL_BROWSER_STDIN: '1'
		});

		expect(invocation.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN_SHARED_ONLY).toBe('1');
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN');
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS');
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_LONG_DOUBLE');
		expect(invocation.env).not.toHaveProperty(
			'WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_LONG_DOUBLE'
		);
		expect(invocation.env).not.toHaveProperty('WASM_IDLE_RUN_REAL_BROWSER_STDIN');
	});

	it('prepares and starts once, preserves the Vitest exit code, and closes the server', async () => {
		const prepare = vi.fn().mockResolvedValue(undefined);
		const prepareAssets = vi.fn().mockResolvedValue({});
		const verifyAssets = vi.fn().mockResolvedValue({});
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
				{
					prepare,
					prepareAssets,
					verifyAssets,
					spawnProcess: spawnProcess as never,
					startPreview
				}
			)
		).resolves.toBe(23);
		expect(prepareAssets).toHaveBeenCalledWith({ groups: ['all'] });
		expect(verifyAssets).toHaveBeenCalledWith({
			groups: ['all'],
			staticDir: path.join(repositoryRoot, 'build')
		});
		expect(prepareAssets.mock.invocationCallOrder[0]).toBeLessThan(
			prepare.mock.invocationCallOrder[0]!
		);
		expect(verifyAssets.mock.invocationCallOrder[0]).toBeLessThan(
			startPreview.mock.invocationCallOrder[0]!
		);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(prepare).toHaveBeenCalledWith(
			['prepare:wasm-debug-release', 'build:preview', 'compress:build-runtimes'],
			{
				timeoutMs: 900_000
			}
		);
		expect(startPreview).toHaveBeenCalledTimes(1);
		expect(spawnProcess).toHaveBeenCalledTimes(1);
		expect(spawnProcess.mock.calls[0]?.[2]).toMatchObject({
			cwd: repositoryRoot,
			stdio: 'inherit'
		});
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('checks reused builds and fails before starting a browser when assets are missing', async () => {
		const prepare = vi.fn();
		const prepareAssets = vi.fn();
		const startPreview = vi.fn();
		const verifyAssets = vi
			.fn()
			.mockRejectedValue(new Error('Missing required browser test asset: wasm-c3/c3c.wasm'));
		await expect(
			runAllLanguageBrowserTests(
				{ shard: 'specialized', useBuild: true },
				{ prepare, prepareAssets, verifyAssets, startPreview }
			)
		).rejects.toThrow('wasm-c3/c3c.wasm');
		expect(prepare).not.toHaveBeenCalled();
		expect(prepareAssets).not.toHaveBeenCalled();
		expect(startPreview).not.toHaveBeenCalled();
		expect(verifyAssets).toHaveBeenCalledWith({
			groups: ['container', 'ocaml', 'c3', 'lfortran', 'lean4', 'commonlisp'],
			staticDir: path.join(repositoryRoot, 'build')
		});
	});

	it('parses explicit optional suites and shards and rejects invalid options', () => {
		expect(parseAllLanguageBrowserTestArgs(['--family=esolangs'])).toEqual({
			includeCompressedAssets: false,
			includeLspFull: false,
			shard: undefined,
			family: 'esolangs'
		});
		expect(() =>
			parseAllLanguageBrowserTestArgs(['--family=esolangs', '--shard=workers'])
		).toThrow('--family cannot be combined with shard or full-matrix options');
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
