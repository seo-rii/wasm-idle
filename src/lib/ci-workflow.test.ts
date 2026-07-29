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
});
