import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPageC3Compiler } from './verify-page-c3-compiler.mjs';

test('c3 release rejects a fresh checkout without required producer input', async (t) => {
	const rootDir = await mkdtemp(path.join(os.tmpdir(), 'c3-page-missing-'));
	t.after(() => rm(rootDir, { recursive: true, force: true }));
	await assert.rejects(verifyPageC3Compiler({ rootDir }), /sync:wasm-c3.*before page:build/);
});

test('c3 page build and direct publish validate required input and final output', async () => {
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
	const steps = pkg.scripts['page:build'].split(' && ');
	const check = 'pnpm run verify:page-c3';
	assert.ok(steps.indexOf(check) < steps.indexOf('pnpm run build:page-runtimes'));
	assert.ok(
		steps.indexOf(check + ' -- build') > steps.indexOf('pnpm run compress:build-runtimes')
	);
	const publish = await readFile(new URL('../gh-pages.js', import.meta.url), 'utf8');
	assert.ok(
		publish.indexOf('await verifyPageC3Compiler({ rootDir: buildDir })') <
			publish.indexOf('publish(')
	);
});
