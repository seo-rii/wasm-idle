import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('lfortran page command rejects a fresh checkout without required producer input', async (t) => {
	const rootDir = await mkdtemp(path.join(os.tmpdir(), 'lfortran-page-missing-'));
	t.after(() => rm(rootDir, { recursive: true, force: true }));
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
	const command = pkg.scripts['page:build'].split(' && ').at(-1).split(' ');
	const result = spawnSync(command[0], [...command.slice(1, -1), rootDir], {
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		encoding: 'utf8'
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /sync:wasm-lfortran.*before page:build/);
	assert.doesNotMatch(result.stderr, /Usage:/);
});

test('lfortran page build and direct publish validate required input and final output', async () => {
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
	const steps = pkg.scripts['page:build'].split(' && ');
	const check = 'pnpm run verify:page-lfortran';
	assert.ok(
		steps.indexOf(check) >= 0 &&
			steps.indexOf(check) < steps.indexOf('pnpm run build:page-runtimes')
	);
	assert.ok(steps.indexOf(check + ' build') > steps.indexOf('pnpm run compress:build-runtimes'));
	const publish = await readFile(new URL('../gh-pages.js', import.meta.url), 'utf8');
	const verification = publish.indexOf('await verifyPageLfortranCompiler({ rootDir: buildDir })');
	assert.ok(verification >= 0 && verification < publish.indexOf('publish('));
});
