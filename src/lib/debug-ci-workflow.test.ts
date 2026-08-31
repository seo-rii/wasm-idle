import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('LLDB browser integration workflow', () => {
	it('keeps the complete synced debugger runtime within its aggregate asset budget', async () => {
		const assetBudgets = JSON.parse(
			await readFile('scripts/static-asset-budgets.v1.json', 'utf8')
		) as {
			directories: Record<string, { maxBytes: number; maxFiles: number; optional?: boolean }>;
		};

		expect(assetBudgets.directories['wasm-debug']).toEqual({
			maxBytes: 55_000_000,
			maxFiles: 10,
			optional: true
		});
	});

	it('prepares the shared debugger release and checks its budget before launching Chromium', async () => {
		const workflow = await readFile('.github/workflows/debug-browser.yml', 'utf8');
		const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
			scripts?: Record<string, string>;
		};
		const clangDownloadIndex = workflow.indexOf('Download pinned Clang browser assets');
		const clangHashVerificationIndex = workflow.lastIndexOf('sha256sum --check');
		const debuggerPrepareIndex = workflow.indexOf('pnpm run prepare:wasm-debug-release');
		const consumerBuildIndex = workflow.indexOf('pnpm run build:publish-deps');
		const manifestReceiptTestIndex = workflow.indexOf(
			'pnpm vitest run src/lib/playground/lldbManifestReceipt.test.ts'
		);
		const assetBudgetIndex = workflow.indexOf('pnpm run check:asset-sizes');
		const browserTestIndex = workflow.indexOf('pnpm run test:browser:debug:lldb');

		expect(clangDownloadIndex).toBeGreaterThan(-1);
		expect(clangHashVerificationIndex).toBeGreaterThan(clangDownloadIndex);
		expect(debuggerPrepareIndex).toBeGreaterThan(clangHashVerificationIndex);
		expect(consumerBuildIndex).toBeGreaterThan(debuggerPrepareIndex);
		expect(manifestReceiptTestIndex).toBeGreaterThan(consumerBuildIndex);
		expect(assetBudgetIndex).toBeGreaterThan(manifestReceiptTestIndex);
		expect(browserTestIndex).toBeGreaterThan(assetBudgetIndex);
		expect(pkg.scripts?.['prepare:wasm-debug-release']).toBe(
			'node scripts/prepare-wasm-debug-release.mjs'
		);
		expect(workflow).not.toContain('Download pinned LLDB and WAMR browser assets');
		expect(workflow).not.toContain('WASM_LLVM_DEBUG_RELEASE_URL');
		expect(workflow).not.toContain('static/wasm-debug/');
	});

	it('does not let a nightly soak cancel the main-push browser gate', async () => {
		const workflow = await readFile('.github/workflows/debug-browser.yml', 'utf8');

		expect(workflow).toContain(
			'group: lldb-browser-${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}'
		);
	});

	it('runs every package unit-test suite in general CI', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

		for (const packageName of ['debug', 'llvm-core', 'lsp', 'terminal']) {
			expect(workflow).toContain(`pnpm --dir packages/${packageName} test`);
		}
	});

	it('gates pull requests and main pushes with the product LLDB/WAMR Chromium test', async () => {
		const workflow = await readFile('.github/workflows/debug-browser.yml', 'utf8');
		const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
			scripts?: Record<string, string>;
		};
		const productJobIndex = workflow.indexOf('    product-lldb-wamr:');
		const strictCspIndex = workflow.indexOf(
			"        env:\n            WASM_IDLE_STRICT_CSP: '1'",
			productJobIndex
		);
		const productStepsIndex = workflow.indexOf('        steps:', productJobIndex);

		expect(workflow).toContain('pull_request:');
		expect(workflow).toContain('branches: [main]');
		expect(productJobIndex).toBeGreaterThan(-1);
		expect(strictCspIndex).toBeGreaterThan(productJobIndex);
		expect(strictCspIndex).toBeLessThan(productStepsIndex);
		expect(workflow).toContain('playwright-core install --with-deps chromium');
		expect(workflow).not.toContain('prepare:test-assets');
		expect(workflow).not.toContain('sync:wasm-clang');
		for (const [asset, sha256] of [
			['clang.wasm.gz', 'b1174438d9a67b7ff11e623541b9a0572c024a9e798084b9b021dd9da2da0874'],
			['lld.wasm.gz', 'f842a9b5df3c6d326f0260bfd313c11c2e22bc8b8ae0387deede9a4af55779cd'],
			['memfs.wasm.gz', 'd86f141eacd58a93511fbfb7c4e81d498eb7106a8a57df1bea7d33df3ce1f403'],
			['sysroot.tar.gz', '68437624a81c465b93895615e7afd3f235ff256de17dc1927b124e783614e3e4']
		]) {
			expect(workflow).toContain(`static/clang/bin/${asset}`);
			expect(workflow).toContain(sha256);
		}
		expect(pkg.scripts?.['prepare:wasm-debug-release']).toBe(
			'node scripts/prepare-wasm-debug-release.mjs'
		);
		expect(workflow).toContain('pnpm run prepare:wasm-debug-release');
		expect(workflow).not.toContain('WASM_LLVM_DEBUG_RELEASE_URL');
		expect(workflow).not.toContain('static/wasm-debug/');
		expect(workflow).toContain('pnpm run test:browser:debug:lldb');
		expect(workflow).not.toContain('continue-on-error: true');
	});

	it('keeps a product-binary WAMR trap fixture in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain('__builtin_trap();');
		expect(browserTest).toContain("expectedStoppedReason: 'exception'");
		expect(browserTest).toContain('WASM_IDLE_DEBUG_BROWSER_CASES');
	});

	it('rejects unknown browser fixture selections instead of passing an empty run', () => {
		const result = spawnSync(
			process.execPath,
			[
				'node_modules/vitest/vitest.mjs',
				'run',
				'src/lib/playground/debug.playwright.test.ts'
			],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
				env: {
					...process.env,
					WASM_IDLE_DEBUG_BROWSER_CASES: 'not-a-real-debug-fixture',
					WASM_IDLE_DEBUG_BROWSER_LANGUAGES: '',
					WASM_IDLE_RUN_REAL_BROWSER_DEBUG: '0'
				},
				timeout: 30_000
			}
		);

		expect(result.status).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).toContain(
			'Unknown WASM_IDLE_DEBUG_BROWSER_CASES selection: not-a-real-debug-fixture'
		);
	}, 30_000);

	it('keeps a running-target WAMR interrupt fixture in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain("testId: 'c-interrupt'");
		expect(browserTest).toContain("afterContinue: 'pause'");
		expect(browserTest).toContain("expectedStoppedReason: 'pause'");
	});

	it('keeps a running-target LLDB disconnect fixture in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain("testId: 'c-disconnect'");
		expect(browserTest).toContain("afterContinue: 'disconnect'");
		expect(browserTest).toContain('WASM_IDLE_DEBUG_DISCONNECT_TIMEOUT_MS');
	});

	it('measures repeated LLDB/WAMR session cleanup in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');
		const debugReadme = await readFile('packages/debug/README.md', 'utf8');
		const llvmCoreReadme = await readFile('packages/llvm-core/README.md', 'utf8');
		const workflow = await readFile('.github/workflows/debug-browser.yml', 'utf8');
		const vitestConfig = await readFile('vitest.config.ts', 'utf8');

		expect(browserTest).toContain("testId: 'c-relaunch'");
		expect(browserTest).toContain("afterContinue: 'relaunch'");
		expect(browserTest).toContain('repeatCount: 3');
		expect(browserTest).toContain('WASM_IDLE_DEBUG_RELAUNCH_COUNT');
		expect(vitestConfig).toContain('WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS');
		expect(browserTest).toContain('__wasmIdleWorkerMetrics');
		expect(browserTest).toContain("getByRole('button', { name: 'Restart Debug' })");
		expect(browserTest).toContain('peakActive');
		expect(browserTest).toContain('WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES');
		expect(debugReadme).toContain('The required browser gate uses **Restart Debug**');
		expect(debugReadme).toContain('more than one LLDB/target Worker pair is live');
		expect(debugReadme).toContain('WASM_IDLE_DEBUG_RELAUNCH_COUNT=100');
		expect(debugReadme).toContain('WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS=7200000');
		expect(workflow).toContain("cron: '29 19 * * *'");
		expect(workflow).toContain('WASM_IDLE_DEBUG_BROWSER_CASES: c-relaunch');
		expect(workflow).toContain('WASM_IDLE_DEBUG_RELAUNCH_COUNT: 100');
		expect(workflow).toContain('WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS: 7200000');
		expect(workflow).toContain(
			"if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"
		);
		expect(llvmCoreReadme).toContain(
			'manual release-candidate dispatch run the relaunch fixture 100 times'
		);
	});

	it('gates the reduced LLDB and WAMR initial-memory profile', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');
		const llvmReadme = await readFile('packages/llvm-core/README.md', 'utf8');

		expect(browserTest).toContain('String(320 * 1024 * 1024)');
		expect(browserTest).toContain('String(80 * 1024 * 1024)');
		expect(llvmReadme).toContain('320 MiB for LLDB and 80 MiB for WAMR');
		expect(llvmReadme).toContain('256 MiB and 64 MiB');
	});

	it('keeps a real target-memory write fixture in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		for (const testId of ['c-memory-write', 'cpp-memory-write', 'rust-memory-write']) {
			expect(browserTest).toContain(`testId: '${testId}'`);
		}
		expect(browserTest).toContain("getByLabel('Memory write bytes')");
		expect(browserTest).toContain("getByLabel('Write memory')");
		expect(browserTest).toContain("expectedOutput: 'lldb-memory-write=103'");
	});

	it('keeps read, write, and read/write data breakpoints in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		for (const [testId, accessType] of [
			['c-data-breakpoint', 'write'],
			['c-data-breakpoint-indexed-overlap', 'write'],
			['cpp-data-breakpoint', 'readWrite'],
			['rust-data-breakpoint', 'read']
		]) {
			expect(browserTest).toContain(`testId: '${testId}'`);
			expect(browserTest).toMatch(
				new RegExp(`accessType: '${accessType}'[\\s\\S]{0,1200}testId: '${testId}'`)
			);
		}
		expect(browserTest).toContain("getByLabel('Set data breakpoint')");
		expect(browserTest).toContain("getByLabel('Clear data breakpoint')");
		expect(browserTest).toContain("expectedStoppedReason: 'data breakpoint'");
		expect(browserTest).toMatch(
			/expectedDataBreakpoint:\s*\{[\s\S]*?bytes: 1,[\s\S]*?initialData: \[255, 0, 0, 0\],[\s\S]*?offset: 5,[\s\S]*?readOffset: 4,[\s\S]*?testId: 'c-data-breakpoint-indexed-overlap'/
		);
		expect(browserTest).toMatch(
			/expectedStoppedLine: 9,[\s\S]*?source: `[^`]*items\[1\] = ready;[^`]*items\[1\] \+= 1;[^`]*`,[\s\S]{0,100}testId: 'c-data-breakpoint-indexed-overlap'/
		);
	});

	it('keeps late binary-asset failures inside the LLDB session boundary', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');
		const llvmReadme = await readFile('packages/llvm-core/README.md', 'utf8');

		expect(browserTest).toContain("testId: 'c-asset-session-failure'");
		expect(browserTest).toContain("backend: 'lldb'");
		expect(browserTest).toContain("missingDebugResource: 'debug/lldb-web-dap.wasm'");
		expect(browserTest).toContain(
			"expectedSessionFailure: 'Unable to load LLDB WebAssembly debug asset (404)'"
		);
		expect(browserTest).toContain('expectedNoDebugWorkers: true');
		expect(browserTest).not.toContain('trace-asset-fallback=73');
		expect(llvmReadme).toContain(
			'Only authenticated manifest preflight failures may offer a new trace run before compilation.'
		);
		expect(llvmReadme).toContain(
			'A binary asset failure after DWARF compilation fails that LLDB session explicitly'
		);
	});

	it('keeps authenticated manifest preflight fallback before debugger startup', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');
		const llvmReadme = await readFile('packages/llvm-core/README.md', 'utf8');

		expect(browserTest).toContain("testId: 'c-manifest-fallback'");
		expect(browserTest).toMatch(
			/activePath: 'manifest-fallback\.c',[\s\S]{0,500}backend: 'trace',[\s\S]{0,500}expectedFallbackWarning: 'Unable to load the LLDB runtime manifest \(404\)\.',[\s\S]{0,500}expectedNoDebugWorkers: true,[\s\S]{0,500}expectedOutput: 'trace-manifest-fallback=73',[\s\S]{0,500}missingDebugResource: 'runtime-manifest\.v2\.json'/
		);
		expect(browserTest).toContain("message.includes('using trace debugging for this run')");
		expect(browserTest).toContain('workerMetricsAfterFallback.createdDebug');
		expect(llvmReadme).toMatch(
			/The\s+manifest fallback fixture proves that no debugger Worker starts/
		);
	});

	it('keeps distinct recursive frame locals in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain("testId: 'c-recursive-frames'");
		expect(browserTest).toContain('expectedFrameLocals:');
		expect(browserTest).toContain('selectDebugFrame');
	});

	it('covers Rust composite values, recursive frames, and panic termination with LLDB', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain("testId: 'rust-composite-types'");
		expect(browserTest).toContain("testId: 'rust-recursive-frames'");
		expect(browserTest).toContain("testId: 'rust-panic'");
		expect(browserTest).toContain("expectedFrameFunction: 'recurse'");
		expect(browserTest).toMatch(
			/expectedOutput: 'lldb-rust-panic=73',[\s\S]{0,160}expectedStoppedReason: 'exception'/
		);
		expect(browserTest).toMatch(/expectScopesAtStop: false,[\s\S]{0,200}testId: 'rust-panic'/);
		expect(browserTest).toMatch(/expectedStoppedLine: null,[\s\S]{0,240}testId: 'rust-panic'/);
	});

	it('keeps a nested variable-path watch in the C++ browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');
		const page = await readFile('src/routes/+page.svelte', 'utf8');

		expect(browserTest).toContain("expectedWatch: { expression: 'pair.first', value: '35' }");
		expect(browserTest).toContain(".locator('.debug-entry--watch')");
		expect(page).toContain('placeholder="pair.first or items[2]"');
	});

	it('keeps the bounded memory inspector in the C browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain("expectedMemoryInspector: { count: 4, variable: 'value' }");
		expect(browserTest).toContain("document.querySelectorAll('.debug-memory-byte')");
		expect(browserTest).toContain("button.textContent?.trim() === 'Next'");
		expect(browserTest).toContain("button.textContent?.trim() === 'Previous'");
	});
});
