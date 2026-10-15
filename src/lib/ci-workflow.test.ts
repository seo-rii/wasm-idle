import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('required CI workflow gates', () => {
	it('runs affected real runtime families on PR and main push', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		expect(workflow).toContain('    runtime-browser-required:');
		expect(workflow).toContain('needs: changed-runtimes');
		expect(workflow).toContain(
			'node scripts/run-all-language-browser-tests.mjs --family=${{ matrix.family }}'
		);
		expect(workflow).toContain("WASM_IDLE_REQUIRE_BROWSER_TESTS: '1'");
	});
	it('limits the token, cancels superseded pull request runs, and bounds every job', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
		const jobBlocks = jobs.split(/^(?= {4}[a-z-]+:$)/m).slice(1);

		expect(workflow).toContain('\npermissions:\n    contents: read\n');
		// Push runs must never share a group: a pending push run replaced by a newer one would
		// drop the runtimes it changed from changed-runtimes, which diffs against `before`.
		expect(workflow).toContain(
			"    group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}"
		);
		expect(workflow).toContain(
			"    cancel-in-progress: ${{ github.event_name == 'pull_request' }}"
		);
		expect(jobBlocks.length).toBeGreaterThan(5);
		for (const job of jobBlocks) {
			expect(job, job.split('\n')[0]).toMatch(/^ {8}timeout-minutes: \d+$/m);
		}
	});
	it('runs script, SDK wrapper, runtime package, and Go unit suites', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const jobStart = workflow.indexOf('    workspace-unit:');
		const job = workflow.slice(jobStart, workflow.indexOf('    changed-runtimes:', jobStart));
		const sync = job.indexOf('- run: pnpm exec svelte-kit sync');

		expect(jobStart).toBeGreaterThanOrEqual(0);
		expect(job).toContain('- run: node --test scripts/*.test.mjs');
		for (const sdk of ['node', 'svelte', 'vue']) {
			expect(
				job.indexOf(`- run: pnpm exec vitest run --root packages/${sdk}`)
			).toBeGreaterThan(sync);
		}
		for (const runtime of ['d', 'dotnet', 'lisp', 'lua', 'typescript', 'wat']) {
			expect(job).toContain(`- run: pnpm --dir runtimes/wasm-${runtime} test`);
		}
		expect(job).toContain('pnpm --dir runtimes/wasm-rust exec vitest run');
		expect(job).toContain('uses: actions/setup-go@');
		for (const goModule of ['wasm-awk', 'wasm-tinygo']) {
			expect(job).toContain(
				`- run: go test ./...\n              working-directory: runtimes/${goModule}`
			);
		}
	});
	it('uses the required-browser reporter for the selected workspace family', async () => {
		const config = await readFile('vitest.config.ts', 'utf8');
		expect(config).toContain("process.env.WASM_IDLE_REQUIRE_BROWSER_TESTS === '1'");
		expect(config).toContain('new RequiredBrowserReporter()');
	});
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
		const nextJobStart = workflow.indexOf('    runtime-browser-full:', fullJobStart);
		const smokeJob = workflow.slice(smokeJobStart, fullJobStart);
		const fullJob = workflow.slice(
			fullJobStart,
			nextJobStart >= 0 ? nextJobStart : workflow.length
		);

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

	it('verifies the code-only LLVM package boundary before install budgets', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);
		const boundary = packagesJob.indexOf(
			'- run: pnpm --dir packages/llvm-core run verify:package-boundary'
		);
		const installBudgets = packagesJob.indexOf('- run: pnpm run verify:package');

		expect(boundary).toBeGreaterThanOrEqual(0);
		expect(installBudgets).toBeGreaterThan(boundary);
	});

	it('runs the complete browser matrix as scheduled isolated shards', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const jobStart = workflow.indexOf('    runtime-browser-full:');
		const job = workflow.slice(jobStart);

		expect(jobStart).toBeGreaterThanOrEqual(0);
		expect(job).toContain(
			"if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"
		);
		const shardMatrix = job.match(/^\s*shard:\s*\[([^\]]+)\]$/m)?.[1];
		expect(shardMatrix?.split(',').map((shard) => shard.trim())).toEqual([
			'stdin',
			'llvm',
			'workers',
			'specialized',
			'compressed-assets',
			'workspace'
		]);
		expect(job).not.toContain('asset-group');
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

	it('tests layered asset generation without requiring deployment-only layer files', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const packagesJobStart = workflow.indexOf('    packages:');
		const nextJobStart = workflow.indexOf('    lsp-browser-smoke:', packagesJobStart);
		const packagesJob = workflow.slice(packagesJobStart, nextJobStart);

		expect(packagesJob).not.toContain('- run: pnpm run layer:static-runtimes');
		expect(packagesJob).not.toContain('- run: git diff --exit-code -- static');
		expect(packagesJob).toContain('- run: pnpm run verify:page-runtime-freshness');
		expect(packagesJob).toContain('src/lib/build-layered-runtime-assets.test.ts');
		expect(packagesJob).toContain('- run: pnpm --dir runtimes/wasm-go test');
		expect(packagesJob).toContain(
			'- run: pnpm --dir runtimes/wasm-rust exec vitest run test/runtime-pack.test.ts test/runtime-manifest-edge.test.ts'
		);
	});
});
