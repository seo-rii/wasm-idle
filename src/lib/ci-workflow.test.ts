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

	it('prepares pinned clangd assets before the package LSP suite', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);
		const prepareAssets = packagesJob.indexOf('- run: node scripts/prepare-clangd-assets.mjs');
		const lspTests = packagesJob.indexOf('- run: pnpm --dir packages/lsp test');

		expect(packagesJobStart).toBeGreaterThanOrEqual(0);
		expect(nextJobStart).toBeGreaterThan(packagesJobStart);
		expect(prepareAssets).toBeGreaterThanOrEqual(0);
		expect(lspTests).toBeGreaterThan(prepareAssets);
	});

	it('prepares grouped assets before the browser LSP suites', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const smokeJobStart = workflow.indexOf('    lsp-browser-smoke:');
		const fullJobStart = workflow.indexOf('    lsp-browser-full:');
		const smokeJob = workflow.slice(smokeJobStart, fullJobStart);
		const fullJob = workflow.slice(fullJobStart);

		expect(smokeJob.indexOf('- run: pnpm run prepare:test-assets -- clangd')).toBeLessThan(
			smokeJob.indexOf('- run: pnpm run test:lsp:browser:smoke')
		);
		expect(fullJob.indexOf('- run: pnpm run prepare:test-assets -- clangd ocaml')).toBeLessThan(
			fullJob.indexOf('- run: pnpm run test:lsp:browser:full')
		);
	});
});
