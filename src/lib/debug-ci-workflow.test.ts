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
		expect(workflow).toContain('pnpm run test:browser:debug:lldb');
		expect(workflow).not.toContain('continue-on-error: true');
	});
});
