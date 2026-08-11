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
			'https://raw.githubusercontent.com/seo-rii/wasm-llvm/c5c5385c2c15d95b6bc15429ccfa888c5981a501/artifacts/runtime-source'
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
				'3a0d0dff4380947102f473fc845524500f40b11b4847d5f5dcb0f6949d8e2623'
			],
			[
				'debug/lldb-web-dap.js',
				'c6ecfaf08d60af11b003df60435c77a5ed24fc46887d2aa43e19436d5a5eb59d'
			],
			[
				'debug/lldb-web-dap.wasm',
				'b12f1fa80b00db4f5d8ed472697cc141f1025988dce704401eb25d90089d7665'
			],
			[
				'debug/lldb-web-dap.pthread.mjs',
				'd40975277aa0c98c6570f9a35d52ab9be475ded4e7a4796fc6d0f8f314c9652d'
			],
			[
				'debug/wamr-debug.js',
				'27ae46467c33d7794878f956aadf70f7fb1ac92f3625466d5d066a772ccdf081'
			],
			[
				'debug/wamr-debug.wasm',
				'ffdea1b0273c05203cc3fe78138120f9bfd76935374f40d7a0a2778a5439b92b'
			],
			[
				'debug/wamr-debug.worker.mjs',
				'22998261a62469360bb373812566c364a9b97af01622f8479794c1624464beb3'
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

	it('gates the reduced LLDB and WAMR initial-memory profile', async () => {
		const browserTest = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');
		const llvmReadme = await readFile('packages/llvm-core/README.md', 'utf8');

		expect(browserTest).toContain('String(320 * 1024 * 1024)');
		expect(browserTest).toContain('String(80 * 1024 * 1024)');
		expect(llvmReadme).toContain('320 MiB for LLDB and 80 MiB for WAMR');
		expect(llvmReadme).toContain('256 MiB and 64 MiB');
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
