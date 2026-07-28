import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('LLDB browser integration workflow', () => {
	it('gates pull requests and main pushes with the product LLDB/WAMR Chromium test', async () => {
		const workflow = await readFile('.github/workflows/debug-browser.yml', 'utf8');

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
			'https://raw.githubusercontent.com/seo-rii/wasm-llvm/1186508362a98bdbfc71db14c7375863dff9e30f/artifacts/runtime-source'
		);
		expect(workflow).not.toContain('/wasm-llvm/main/artifacts/runtime-source');
		for (const [asset, sha256] of [
			[
				'runtime-manifest.v2.json',
				'babca384c82800305fdc6772f7ea8963c42fcf7233b5fc2c57cc74749e03a7a5'
			],
			[
				'debug/lldb-web-dap.js',
				'6b0e5f45487e004d27a90fa267da5fd041ca451ff7f513048456b76888515b6c'
			],
			[
				'debug/lldb-web-dap.wasm',
				'0e34b5a62404efd5d8525faf8b4c6a3fb582b13d6e50fc0e99a21c5748437e23'
			],
			[
				'debug/lldb-web-dap.pthread.mjs',
				'd40975277aa0c98c6570f9a35d52ab9be475ded4e7a4796fc6d0f8f314c9652d'
			],
			[
				'debug/wamr-debug.js',
				'084183134678e0ebbe1852fd6481bcb78222eaf06eae6bc5996003e66b050b2a'
			],
			[
				'debug/wamr-debug.wasm',
				'e3c848b676cbc65b9014d19a3b36f480f7989309ce2e2385fcbeafa75240d338'
			],
			[
				'debug/wamr-debug.worker.mjs',
				'9d804f26275dcb13dd0427e4b2406576d950d685738f0d0e1add34394ab5622f'
			]
		]) {
			expect(workflow).toContain(`static/wasm-debug/${asset}`);
			expect(workflow).toContain(sha256);
		}
		expect(workflow).toContain('pnpm run test:browser:debug:lldb');
		expect(workflow).not.toContain('continue-on-error: true');
	});
});
