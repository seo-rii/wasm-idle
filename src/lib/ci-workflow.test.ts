import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('required CI workflow gates', () => {
	it('runs the root unit suite in the packages job', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);

		expect(packagesJobStart).toBeGreaterThanOrEqual(0);
		expect(nextJobStart).toBeGreaterThan(packagesJobStart);
		expect(packagesJob).toContain('- run: pnpm test');
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
	it('enforces static asset budgets in the packages job', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);

		expect(packagesJob).toContain('- run: pnpm run check:asset-sizes');
	});
	it('runs the complete browser matrix as scheduled isolated shards', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const jobStart = workflow.indexOf('    runtime-browser-full:');
		const job = workflow.slice(jobStart);

		expect(jobStart).toBeGreaterThanOrEqual(0);
		expect(job).toContain(
			"if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"
		);
		for (const [shard, assetGroup] of [
			['stdin', 'none'],
			['llvm', 'clang'],
			['workers', 'none'],
			['specialized', 'ocaml'],
			['compressed-assets', 'all']
		]) {
			expect(job).toContain(
				`- shard: ${shard}\n                      asset-group: ${assetGroup}`
			);
		}
		expect(job).toContain(
			'node scripts/run-all-language-browser-tests.mjs --shard ${{ matrix.shard }}'
		);
	});
	it('builds and verifies the independent PHP producer in the packages job', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);
		const install = packagesJob.indexOf(
			'- run: pnpm --dir producers/wasm-php install --frozen-lockfile'
		);
		const build = packagesJob.indexOf('- run: pnpm --dir producers/wasm-php build');
		const producerVerify = packagesJob.indexOf('- run: pnpm --dir producers/wasm-php verify');
		const consumerVerify = packagesJob.indexOf('- run: pnpm run verify:wasm-php');

		expect(packagesJob).toContain('producers/wasm-php/pnpm-lock.yaml');
		expect(install).toBeGreaterThanOrEqual(0);
		expect(build).toBeGreaterThan(install);
		expect(producerVerify).toBeGreaterThan(build);
		expect(consumerVerify).toBeGreaterThan(producerVerify);
	});
	it('regenerates layered assets and runs their runtime-specific tests', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);
		const layer = packagesJob.indexOf('- run: pnpm run layer:static-runtimes');
		const clean = packagesJob.indexOf('- run: git diff --exit-code -- static');

		expect(layer).toBeGreaterThanOrEqual(0);
		expect(clean).toBeGreaterThan(layer);
		expect(packagesJob).toContain('- run: pnpm --dir runtimes/wasm-go test');
		expect(packagesJob).toContain(
			'- run: pnpm --dir runtimes/wasm-rust exec vitest run test/runtime-pack.test.ts test/runtime-manifest-edge.test.ts'
		);
	});
});
