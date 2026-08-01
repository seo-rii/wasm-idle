import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('required CI workflow gates', () => {
	it('prepares pinned compiler assets before the root unit suite in the packages job', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);
		const prepareAssets = packagesJob.indexOf(
			'- run: node scripts/prepare-clang-compiler-assets.mjs'
		);
		const unitTests = packagesJob.indexOf('- run: pnpm test');

		expect(packagesJobStart).toBeGreaterThanOrEqual(0);
		expect(nextJobStart).toBeGreaterThan(packagesJobStart);
		expect(prepareAssets).toBeGreaterThanOrEqual(0);
		expect(unitTests).toBeGreaterThan(prepareAssets);
	});

	it('prepares pinned OCaml assets before the full browser LSP matrix', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const fullJobStart = workflow.indexOf('    lsp-browser-full:');
		const fullJob = workflow.slice(fullJobStart);
		const prepareAssets = fullJob.indexOf('- run: node scripts/prepare-ocaml-lsp-assets.mjs');
		const browserTests = fullJob.indexOf('- run: pnpm run test:lsp:browser:full');

		expect(fullJobStart).toBeGreaterThanOrEqual(0);
		expect(prepareAssets).toBeGreaterThanOrEqual(0);
		expect(browserTests).toBeGreaterThan(prepareAssets);
	});
});
