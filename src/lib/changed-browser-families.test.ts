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
			'nim'
		]);
		expect(changedBrowserFamilies(['packages/debug/src/controller.ts'])).toEqual(['debug']);
		expect(changedBrowserFamilies(['README.md'])).toEqual([]);
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
