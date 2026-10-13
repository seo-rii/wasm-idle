import { describe, expect, it } from 'vitest';
import { changedBrowserFamilies } from '../../scripts/changed-browser-families.mjs';
import { createAllLanguageBrowserTestPlan } from '../../scripts/run-all-language-browser-tests.mjs';

describe('runtime browser CI selection', () => {
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
			'python'
		]);
		expect(changedBrowserFamilies(['packages/debug/src/controller.ts'])).toEqual(['debug']);
		expect(changedBrowserFamilies(['src/lib/playground/assetBridge.ts'])).toEqual(['clang']);
		expect(changedBrowserFamilies(['src/lib/playground/assetBridge.test.ts'])).toEqual([
			'clang'
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
	it('requires the corresponding real browser family for the audited missing execution files', () => {
		const cases: [string, string[]][] = [
			['src/lib/playground/cachedClang.ts', ['clang']],
			['src/lib/playground/worker/cachedClangCompile.ts', ['clang']],
			['src/lib/playground/worker/cachedClangExecute.ts', ['clang']],
			['src/lib/playground/worker/pythonExecution.ts', ['esolangs', 'python']],
			['src/lib/playground/worker/pythonStdio.ts', ['esolangs', 'python']],
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
		const all = ['clang', 'debug', 'dotnet', 'esolangs', 'go', 'nim', 'python'];
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
