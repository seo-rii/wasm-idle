// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { supportedLanguageIds } from '../../packages/core/src/languages';
import {
	ALL_BROWSER_FAMILIES,
	browserFamilyForLanguage,
	runtimeBrowserRegistry
} from '../../scripts/runtime-browser-registry.mjs';
import { supportMatrixRows } from '../../scripts/support-matrix.mjs';
import { changedBrowserFamilies } from '../../scripts/changed-browser-families.mjs';
import { createAllLanguageBrowserTestPlan } from '../../scripts/run-all-language-browser-tests.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('runtime browser CI selection', () => {
	it('assigns every registered language exactly once to required real browser coverage', () => {
		expect(runtimeBrowserRegistry.flatMap(({ languages }) => languages).sort()).toEqual(
			[...supportedLanguageIds].sort()
		);
		for (const row of supportMatrixRows) {
			for (const language of row.ids) {
				const owner = runtimeBrowserRegistry.find(({ languages }) =>
					languages.includes(language)
				)!;
				const family = browserFamilyForLanguage(language);
				const plan = createAllLanguageBrowserTestPlan({ family });
				for (const name of owner.sourceNames) {
					for (const file of [
						`src/lib/playground/${name}.ts`,
						`src/lib/playground/worker/${name}.ts`,
						`runtimes/wasm-${name}/src/index.ts`,
						`static/wasm-${name}/runtime.wasm`,
						`scripts/sync-wasm-${name}.mjs`
					])
						expect(changedBrowserFamilies([file]), `${language}: ${file}`).toContain(
							family
						);
				}
				const required =
					family === 'python'
						? {
								file: 'src/lib/playground/python.playwright.test.ts',
								env: 'WASM_IDLE_RUN_REAL_BROWSER_PYTHON'
							}
						: family === 'dotnet'
							? {
									file: row.browserTest!.file,
									env: 'WASM_IDLE_RUN_REAL_BROWSER_DOTNET'
								}
							: {
									...row.browserTest!,
									env:
										row.browserTest!.env === 'WASM_IDLE_RUN_REAL_BROWSER_STDIN'
											? 'WASM_IDLE_RUN_REAL_BROWSER_STDIN_SHARED_ONLY'
											: row.browserTest!.env
								};
				expect(plan.testFiles, language).toContain(required.file);
				expect(plan.env[required.env], language).toBe('1');
				expect(
					readFileSync(path.join(repositoryRoot, required.file), 'utf8'),
					language
				).toContain(required.env);
			}
		}
	});

	it('refuses a registered runtime with no support-matrix browser test', () => {
		runtimeBrowserRegistry.push({
			id: 'new-runtime',
			languages: ['NEW_RUNTIME'],
			sourceNames: ['new-runtime'],
			dependencies: [],
			family: 'workers'
		});
		try {
			expect(() => createAllLanguageBrowserTestPlan({ family: 'workers' })).toThrow(
				'Missing required browser test for NEW_RUNTIME'
			);
		} finally {
			runtimeBrowserRegistry.pop();
		}
	});

	it('never leaves a runtime directory or an unknown execution source without coverage', () => {
		for (const entry of readdirSync(path.join(repositoryRoot, 'runtimes'), {
			withFileTypes: true
		})) {
			if (!entry.isDirectory()) continue;
			expect(
				changedBrowserFamilies([`runtimes/${entry.name}/src/index.ts`]),
				entry.name
			).not.toEqual([]);
		}
		for (const file of [
			'runtimes/new-runtime/src/index.ts',
			'static/new-runtime/runtime.wasm',
			'static/wasm-new-runtime/runtime.wasm',
			'producers/wasm-new-runtime/src/index.ts',
			'src/lib/playground/newRuntime.ts',
			'src/lib/playground/worker/newRuntime.ts',
			'scripts/new-runtime-pack.mjs',
			'scripts/wasm-new-runtime-pack.mjs',
			'scripts/sync-new-runtime.mjs',
			'scripts/sync-wasm-new-runtime.mjs',
			'scripts/probe-new-runtime-stdin.mjs',
			'scripts/runtime-workers/new-runtime-runner-worker.js',
			'scripts/runtime-workers/wasm-new-runtime-runner-worker.js',
			'scripts/runtime-build/wasm-new-runtime-build.mjs',
			'scripts/runtime-modules/new-runtime.mjs',
			'scripts/llvm-contracts/new-runtime.mjs',
			'scripts/llvm-contracts/new-runtime/contract.mjs'
		])
			expect(changedBrowserFamilies(['src/lib/playground/go.ts', file]), file).toEqual(
				ALL_BROWSER_FAMILIES
			);
	});
	it.each([
		['awk', ['workers']],
		['clojurescript', ['workers']],
		['rescript', ['specialized']],
		['j', ['workers']],
		['java', ['stdin']],
		['r', ['stdin']],
		['rust', ['specialized']]
	] as const)('selects only the owners of hyphenated %s worker modules', (runtime, families) => {
		for (const directory of ['', 'worker/']) {
			expect(
				changedBrowserFamilies([
					`src/lib/playground/${directory}wasm-${runtime}-runner-worker.test.ts`
				])
			).toEqual(families);
		}
	});

	it('runs the change selector before dependencies have been installed', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'wasm-idle-browser-selection-'));
		try {
			for (const name of ['changed-browser-families.mjs', 'runtime-browser-registry.mjs']) {
				copyFileSync(
					path.join(repositoryRoot, 'scripts', name),
					path.join(directory, name)
				);
			}
			const output = execFileSync(
				process.execPath,
				[path.join(directory, 'changed-browser-families.mjs')],
				{ cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } }
			);
			expect(JSON.parse(output)).toEqual(ALL_BROWSER_FAMILIES);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('selects Rust execution and every shared LLVM consumer, including Fortran, COBOL and V', () => {
		expect(changedBrowserFamilies(['runtimes/wasm-rust/src/browser-stdin.ts'])).toEqual([
			'specialized'
		]);
		expect(
			createAllLanguageBrowserTestPlan({ family: 'specialized' }).env
				.WASM_IDLE_RUN_REAL_BROWSER_RUST
		).toBe('1');
		for (const file of [
			'packages/llvm-core/src/index.ts',
			'src/lib/playground/fortran.ts',
			'src/lib/playground/worker/cobol.ts',
			'scripts/sync-wasm-v.mjs'
		]) {
			expect(changedBrowserFamilies([file]), file).toContain('clang');
		}
		for (const language of [
			'CLANG_STDIN',
			'OBJECTIVEC',
			'OBJECTIVECXX',
			'FORTRAN',
			'COBOL',
			'V'
		]) {
			expect(
				createAllLanguageBrowserTestPlan({ family: 'clang' }).env[
					`WASM_IDLE_RUN_REAL_BROWSER_${language}`
				]
			).toBe('1');
		}
	});

	it('follows shared interpreter and static-worker consumers', () => {
		expect(changedBrowserFamilies(['runtimes/pyodide/src/index.ts'])).toEqual([
			'esolangs',
			'python',
			'specialized',
			'workspace'
		]);
		expect(changedBrowserFamilies(['runtimes/ruby/src/index.ts'])).toEqual([
			'esolangs',
			'specialized'
		]);
		expect(changedBrowserFamilies(['runtimes/wasm-elixir/src/index.ts'])).toEqual([
			'specialized',
			'stdin'
		]);
		expect(changedBrowserFamilies(['src/lib/playground/staticWorkerRuntime.ts'])).toEqual([
			'nim',
			'specialized',
			'workers'
		]);
	});
	it('selects the changed family and all affected families for shared execution changes', () => {
		expect(changedBrowserFamilies(['runtimes/wasm-dotnet/native/Program.cs'])).toEqual([
			'dotnet'
		]);
		expect(
			changedBrowserFamilies(['scripts/runtime-workers/wasm-nim-runner-worker.js'])
		).toEqual(['nim']);
		expect(changedBrowserFamilies(['src/routes/execute.ts'])).toEqual([
			'clang',
			'debug',
			'dotnet',
			'esolangs',
			'go',
			'nim',
			'python',
			'specialized',
			'stdin',
			'workers',
			'workspace'
		]);
		expect(changedBrowserFamilies(['packages/debug/src/controller.ts'])).toEqual(['debug']);
		expect(changedBrowserFamilies(['src/lib/playground/assetBridge.ts'])).toEqual([
			'clang',
			'workspace'
		]);
		expect(changedBrowserFamilies(['src/lib/playground/assetBridge.test.ts'])).toEqual([
			'clang',
			'workspace'
		]);
		expect(changedBrowserFamilies(['README.md'])).toEqual([]);
	});
	it('requires interpreter browser coverage for interpreter assets and execution changes', () => {
		for (const file of [
			'runtimes/esolangs/brainfuck/vendor/bfc.c',
			'static/wasm-brainfuck/brainfuck.wasm',
			'static/wasm-befunge93/befunge93.wasm',
			'static/wasm-whitespace/whitespace.wasm',
			'static/wasm-malbolge/malbolge.wasm',
			'static/wasm-aheui/aheui-1.2.5-py3-none-any.whl',
			'static/wasm-uhmlang/uhmlang.wasm',
			'static/wasm-lolcode/lolcode.wasm',
			'static/wasm-apecode/apecode-0.1.0-py3-none-any.whl',
			'scripts/sync-wasm-apecode.mjs',
			'src/lib/playground/apecode.ts',
			'src/lib/playground/worker/apecode.runtime.test.ts',
			'src/lib/playground/wasmApecodeVersion.ts',
			'static/wasm-golfscript/golfscript.rb',
			'static/wasm-ruby/runtime.mjs',
			'runtimes/ruby/src/index.ts',
			'scripts/sync-wasm-golfscript.mjs',
			'src/lib/playground/golfscript.ts',
			'src/lib/playground/worker/golfscript.runtime.test.ts',
			'src/lib/playground/worker/golfscriptMount.ts',
			'src/lib/playground/ruby.ts',
			'src/lib/playground/worker/ruby.ts',
			'src/lib/playground/rubyAssets.ts',
			'src/lib/playground/wasmGolfscriptVersion.ts',
			'scripts/sync-wasm-aheui.mjs',
			'src/lib/playground/aheui.ts',
			'src/lib/playground/assets.ts',
			'src/lib/playground/worker/aheui.runtime.test.ts',
			'src/lib/playground/python.ts',
			'src/lib/playground/worker/python.ts',
			'src/lib/playground/wasmAheuiVersion.ts',
			'scripts/build-esolang-runtimes.mjs',
			'scripts/support-matrix.mjs',
			'src/lib/playground/index.ts',
			'src/lib/playground/wasiInterpreters.ts',
			'src/lib/playground/wasm.ts',
			'src/lib/playground/worker/wasm.ts',
			'src/lib/playground/worker/wasiInterpreters.test.ts',
			'src/lib/playground/esolangs.playwright.test.ts'
		]) {
			expect(changedBrowserFamilies([file]), file).toContain('esolangs');
		}
		expect(changedBrowserFamilies(['scripts/stdin-browser-probe-lib.mjs'])).toContain(
			'esolangs'
		);
	});
	it.each([
		[
			'src/lib/playground/worker/pythonWorkspaceFiles.ts',
			['esolangs', 'python', 'specialized', 'workspace']
		],
		[
			'src/lib/playground/worker/pythonWorkspaceImports.ts',
			['esolangs', 'python', 'specialized', 'workspace']
		],
		['src/lib/playground/staticWorkerRuntime.ts', ['nim', 'specialized', 'workers']],
		['src/lib/playground/staticStdinRing.ts', ['nim', 'specialized', 'workers']]
	] as const)('requires browser coverage for the execution dependency %s', (file, families) => {
		for (const extension of ['.ts', '.test.ts', '.integration.test.ts']) {
			expect(changedBrowserFamilies([file.replace(/\.ts$/, extension)])).toEqual(families);
		}
	});

	it.each([
		['scripts/wasm-nim-assets.lock.json', ['nim']],
		['scripts/clang-cpp-headers.lock.json', ['clang', 'workspace']],
		['scripts/clang-resource-headers.lock.json', ['clang', 'workspace']],
		['scripts/wasm-debug-release.v2.json', ['debug']]
	] as const)('requires browser coverage for the runtime metadata %s', (file, families) => {
		expect(changedBrowserFamilies([file])).toEqual(families);
	});

	it('requires the corresponding real browser family for the audited missing execution files', () => {
		const cases: [string, string[]][] = [
			['src/lib/playground/cachedClang.ts', ['clang', 'workspace']],
			['src/lib/playground/worker/cachedClangCompile.ts', ['clang', 'workspace']],
			['src/lib/playground/worker/cachedClangExecute.ts', ['clang', 'workspace']],
			[
				'src/lib/playground/worker/pythonExecution.ts',
				['esolangs', 'python', 'specialized', 'workspace']
			],
			[
				'src/lib/playground/worker/pythonStdio.ts',
				['esolangs', 'python', 'specialized', 'workspace']
			],
			['src/lib/playground/go.ts', ['go']],
			['src/lib/playground/worker/go.ts', ['go']]
		];
		for (const [file, families] of cases) {
			expect(changedBrowserFamilies([file]), file).toEqual(families);
			expect(
				changedBrowserFamilies([file.replace(/\.ts$/, '.integration.test.ts')]),
				file
			).toEqual(families);
			for (const family of families) {
				const plan = createAllLanguageBrowserTestPlan({
					family: family as 'clang' | 'esolangs' | 'python' | 'go'
				});
				expect(plan.testFiles.length).toBeGreaterThan(0);
				expect(
					Object.keys(plan.env).some((env) =>
						env.startsWith('WASM_IDLE_RUN_REAL_BROWSER_')
					)
				).toBe(true);
			}
		}
		expect(createAllLanguageBrowserTestPlan({ family: 'go' }).testFiles).toEqual([
			'src/lib/playground/go.playwright.test.ts'
		]);
		expect(createAllLanguageBrowserTestPlan({ family: 'python' }).testFiles).toEqual([
			'src/lib/playground/python.playwright.test.ts'
		]);
	});

	it('covers all required families for shared execution layers and keeps docs out of the selection', () => {
		const all = ALL_BROWSER_FAMILIES;
		for (const file of [
			'src/lib/playground/runtimeSession.ts',
			'src/lib/playground/sandbox.ts',
			'src/lib/playground/sharedBuffer.ts',
			'src/lib/playground/workerSession.ts',
			'src/lib/playground/runtimeAssetCache.ts',
			'src/lib/playground/worker/assets.ts',
			'packages/core/src/sandbox.ts',
			'src/routes/+page.svelte',
			'scripts/browser-test-cookies.mjs',
			'scripts/run-all-language-browser-tests.mjs',
			'.github/workflows/ci.yml'
		]) {
			expect(changedBrowserFamilies([file]), file).toEqual(all);
		}
		for (const family of changedBrowserFamilies(['package.json'])) {
			expect(() =>
				createAllLanguageBrowserTestPlan({ family: family as 'go' | 'python' })
			).not.toThrow();
		}
		expect(
			changedBrowserFamilies(['docs/clang-cache.md', 'docs/go-browser.md', 'docs/python.md'])
		).toEqual([]);
		expect(
			changedBrowserFamilies([
				'src/lib/playground/go.ts',
				'runtimes/wasm-go/src/browser-execution.ts'
			])
		).toEqual(['go']);
	});
	it.each([
		'src/routes/workspace-archive.playwright.test.ts',
		'src/routes/workspace-import.playwright.test.ts',
		'src/routes/workspace-storage.playwright.test.ts',
		'src/routes/workspace-identity.playwright.test.ts',
		'src/routes/workspace-share-paths.playwright.test.ts',
		'src/routes/workspace-banners.playwright.test.ts',
		'src/routes/workspace-whitespace-paths.playwright.test.ts',
		'src/routes/debugger-toolbar-layout.playwright.test.ts',
		'src/routes/workspaceStorage.ts',
		'src/routes/workspaceArchive.worker.ts'
	])('selects one required workspace family for %s', (file) => {
		expect(changedBrowserFamilies([file])).toEqual(['workspace']);
		expect(createAllLanguageBrowserTestPlan({ family: 'workspace' }).testFiles).toHaveLength(8);
	});
	it('selects recovery tests alongside normal .NET and Nim execution', () => {
		const dotnet = createAllLanguageBrowserTestPlan({ family: 'dotnet' });
		expect(dotnet.env.WASM_IDLE_RUN_REAL_BROWSER_DOTNET).toBe('1');
		expect(dotnet.env.WASM_IDLE_RUN_REAL_BROWSER_DOTNET_RECOVERY).toBe('1');
		expect(dotnet.testFiles).toContain(
			'src/lib/playground/runtime-recovery.playwright.test.ts'
		);
		const debug = createAllLanguageBrowserTestPlan({ family: 'debug' });
		expect(debug.env.WASM_IDLE_REQUIRE_LLDB_DEBUG).toBe('1');
		expect(debug.env.WASM_IDLE_DEBUG_BROWSER_CASES).toBe(
			'c-deep-stack,c-array-pagination,c-recursive-frames'
		);
		const nim = createAllLanguageBrowserTestPlan({ family: 'nim' });
		expect(nim.env.WASM_IDLE_RUN_REAL_BROWSER_NIM_RECOVERY).toBe('1');
	});
});
