import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('LLDB browser integration workflow', () => {
	it('gates pull requests and main pushes with the product LLDB/WAMR Chromium test', async () => {
		const workflow = await readFile('.github/workflows/debug-browser.yml', 'utf8');
		const debugReadme = await readFile('packages/llvm-core/README.md', 'utf8');

		expect(workflow).toContain('pull_request:');
		expect(workflow).toContain('branches: [main]');
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
		expect(workflow).toContain(
			'https://raw.githubusercontent.com/seo-rii/wasm-llvm/4e5a696be2b44aec3fe9f364956c19c6dda098db/artifacts/runtime-source'
		);
		const pinnedRuntimeRevision = workflow.match(
			/wasm-llvm\/([0-9a-f]{40})\/artifacts\/runtime-source/
		)?.[1];
		expect(pinnedRuntimeRevision).toBeDefined();
		expect(debugReadme).toContain(`wasm-llvm\` commit \`${pinnedRuntimeRevision}\``);
		expect(workflow).not.toContain('/wasm-llvm/main/artifacts/runtime-source');
		for (const [asset, sha256] of [
			[
				'runtime-manifest.v2.json',
				'ca8986926b1789ba09231167aa20854ffd67fe05782b1781a0244b4eb427f7b3'
			],
			[
				'debug/lldb-web-dap.js',
				'e459d2588fad29e1d24b992a5acee2d4b3f84d414cf8b517bddeac61c6b92c60'
			],
			[
				'debug/lldb-web-dap.wasm',
				'4d355af4301df8955b91e5cd0d78f9845c6d81e6508982e7e9beae4a3f778711'
			],
			[
				'debug/lldb-web-dap.pthread.mjs',
				'd40975277aa0c98c6570f9a35d52ab9be475ded4e7a4796fc6d0f8f314c9652d'
			],
			[
				'debug/wamr-debug.js',
				'9948dc4dc7fe7cf575a6480abac6de3b451ad10e3a7b851d4e43f435df0ddcec'
			],
			[
				'debug/wamr-debug.wasm',
				'e3c848b676cbc65b9014d19a3b36f480f7989309ce2e2385fcbeafa75240d338'
			],
			[
				'debug/wamr-debug.worker.mjs',
				'd42f216c4aac3aff61741537d0507ab86aefbe4525661f8d75e49c274b639f79'
			]
		]) {
			expect(workflow).toContain(`static/wasm-debug/${asset}`);
			expect(workflow).toContain(sha256);
		}
		expect(workflow).toContain('pnpm run test:browser:debug:lldb');
		expect(workflow).not.toContain('continue-on-error: true');
	});

	it('keeps a product-binary WAMR trap fixture in the required browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain('__builtin_trap();');
		expect(browserTest).toContain("expectedStoppedReason: 'exception'");
		expect(browserTest).toContain('WASM_IDLE_DEBUG_BROWSER_CASES');
	});

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
		const vitestConfig = await readFile('vitest.config.ts', 'utf8');

		expect(browserTest).toContain("testId: 'c-relaunch'");
		expect(browserTest).toContain("afterContinue: 'relaunch'");
		expect(browserTest).toContain('repeatCount: 3');
		expect(browserTest).toContain('WASM_IDLE_DEBUG_RELAUNCH_COUNT');
		expect(vitestConfig).toContain('WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS');
		expect(browserTest).toContain('__wasmIdleWorkerMetrics');
		expect(browserTest).toContain('WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES');
		expect(debugReadme).toContain('WASM_IDLE_DEBUG_RELAUNCH_COUNT=100');
		expect(debugReadme).toContain('WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS=7200000');
	});

	it('keeps a missing-asset trace fallback fixture in the browser gate', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

		expect(browserTest).toContain("testId: 'c-asset-fallback'");
		expect(browserTest).toContain("missingDebugAsset: 'debug/lldb-web-dap.wasm'");
		expect(browserTest).toContain("expectedOutput: 'trace-asset-fallback=73'");
		expect(browserTest).toContain(
			"expectedFallbackWarning: 'LLDB WebAssembly debug asset (404)'"
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
});
