import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyStartupCwdSources } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('pinned startup constructor follows initialization, preserves argv and fails closed before main', async () => {
	const policy = await verifyStartupCwdSources();
	assert.equal(policy.constructorPriority, 65535);
	assert.equal(policy.pinnedPreopenConstructorPriority, 51);
	const directory = await mkdtemp(path.join(tmpdir(), 'bash-startup-cwd-'));
	try {
		const executable = path.join(directory, 'startup-cwd-fixture');
		// The wrappers test this C constructor's sequencing and error cleanup.
		// They cannot establish the real pinned libc, Bash or browser semantics.
		execFileSync(
			'cc',
			[
				'-std=c11',
				'-Wall',
				'-Wextra',
				'-Werror',
				path.join(HERE, '../startup_cwd.c'),
				path.join(HERE, 'startup-cwd.fixture.c'),
				...['getcwd', 'chdir', 'free', 'write', '_Exit'].map(
					(name) => `-Wl,--wrap=${name}`
				),
				'-o',
				executable
			],
			{ timeout: 10000, stdio: 'pipe' }
		);
		for (const scenario of [
			'success',
			'getcwd-error',
			'chdir-error',
			'partial-diagnostic',
			'zero-diagnostic',
			'closed-diagnostic'
		]) {
			const result = spawnSync(executable, ['space arg', '한글', ''], {
				env: { ...process.env, STARTUP_CWD_FIXTURE_CASE: scenario },
				encoding: 'utf8',
				timeout: 5000,
				maxBuffer: 16384
			});
			assert.ifError(result.error);
			assert.equal(result.signal, null, scenario);
			assert.equal(result.status, scenario === 'success' ? 0 : 125, scenario);
			assert.equal(result.stdout, scenario === 'success' ? 'main-after-cwd\n' : '', scenario);
			const diagnostic = ['success', 'zero-diagnostic', 'closed-diagnostic'].includes(
				scenario
			)
				? ''
				: 'wasm-idle bash: unable to initialize cwd\n';
			assert.equal(result.stderr, diagnostic, scenario);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
