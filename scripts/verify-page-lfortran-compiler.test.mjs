import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPageLfortranCompiler } from './verify-page-lfortran-compiler.mjs';

test('lfortran release rejects a fresh checkout without required producer input', async (t) => {
	const rootDir = await mkdtemp(path.join(os.tmpdir(), 'lfortran-page-missing-'));
	t.after(() => rm(rootDir, { recursive: true, force: true }));
	await assert.rejects(
		verifyPageLfortranCompiler({ rootDir }),
		/sync:wasm-lfortran.*before page:build/
	);
});

test('lfortran page build and direct publish validate required input and final output', async () => {
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
	const steps = pkg.scripts['page:build'].split(' && ');
	const check = 'pnpm run verify:page-lfortran';
	assert.ok(steps.indexOf(check) < steps.indexOf('pnpm run build:page-runtimes'));
	assert.ok(
		steps.indexOf(check + ' -- build') > steps.indexOf('pnpm run compress:build-runtimes')
	);
	const publish = await readFile(new URL('../gh-pages.js', import.meta.url), 'utf8');
	assert.ok(
		publish.indexOf('await verifyPageLfortranCompiler({ rootDir: buildDir })') <
			publish.indexOf('publish(')
	);
});
