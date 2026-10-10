// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('runs the actual MemFS input and tracing regressions in normal CI', () => {
	const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/test-memfs-io.mjs'], {
		cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
		timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, FORCE_COLOR: '0' }
	});
	expect(result.status, String(result.error ?? '') + result.stdout + result.stderr).toBe(0);
	expect(result.stdout).toMatch(/# pass [1-9][0-9]*/);
	expect(result.stdout).toMatch(/# fail 0/);
}, 100_000);
