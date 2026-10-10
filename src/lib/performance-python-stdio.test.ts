// @vitest-environment node
// Collect actual-source regression scripts in normal root CI.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const cwd = fileURLToPath(new URL('../../', import.meta.url));

it('runs the python-stdio host regressions without replacing their assertions', () => {
	const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/test-python-stdio.mjs', 'scripts/test-python-stdio-worker.mjs'], {
		cwd, encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, FORCE_COLOR: '0' }
	});
	expect(result.status, String(result.error ?? '') + result.stdout + result.stderr).toBe(0);
	expect(result.stdout).toMatch(/# pass [1-9][0-9]*/);
	expect(result.stdout).toMatch(/# fail 0/);
}, 100_000);

it('runs native Python flush-hook regressions (not browser performance evidence)', () => {
	const result = spawnSync(process.env.PYTHON ?? 'python3', ['scripts/test-python-flush-hooks.py'], {
		cwd, timeout: 90_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8'
	});
	expect(result.status, String(result.error ?? '') + result.stdout + result.stderr).toBe(0);
}, 100_000);
