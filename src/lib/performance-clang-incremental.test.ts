// @vitest-environment node
// Keep the actual-source regression harness in the normal root CI collection.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('../../', import.meta.url));

it('runs the clang-incremental host regressions without replacing their assertions', () => {
	const result = spawnSync(
		process.execPath,
		['--test', '--test-reporter=tap', 'scripts/test-clang-incremental.mjs'],
		{
			cwd,
			encoding: 'utf8',
			timeout: 90_000,
			maxBuffer: 4 * 1024 * 1024,
			env: { ...process.env, FORCE_COLOR: '0' }
		}
	);
	expect(result.status, String(result.error ?? '') + result.stdout + result.stderr).toBe(0);
	expect(result.stdout).toMatch(/# pass [1-9][0-9]*/);
	expect(result.stdout).toMatch(/# fail 0/);
}, 100_000);
