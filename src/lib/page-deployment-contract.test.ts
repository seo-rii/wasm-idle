import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('GitHub Pages debugger release deployment', () => {
	it('awaits debugger release verification before publishing the built page', async () => {
		const deployment = await readFile('gh-pages.js', 'utf8');
		const buildDirIndex = deployment.indexOf("const buildDir = path.join(repoRoot, 'build');");
		const verificationIndex = deployment.indexOf(
			'await verifyPageWasmDebugRelease({ buildDir });'
		);
		const publishIndex = deployment.indexOf('publish(');

		expect(deployment).toContain(
			"import { verifyPageWasmDebugRelease } from './scripts/verify-page-wasm-debug.mjs';"
		);
		expect(buildDirIndex).toBeGreaterThan(-1);
		expect(verificationIndex).toBeGreaterThan(buildDirIndex);
		expect(publishIndex).toBeGreaterThan(verificationIndex);
	});
});
