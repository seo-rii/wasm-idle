import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPagePlan, shouldSkipAssetVerification } from './run-page.mjs';

const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const taskNames = (plan) =>
	plan.filter((step) => step.args[0] === 'run').map((step) => step.args[1]);

test('ordinary page deployments keep the full build, browser audit and publish order', () => {
	const plan = createPagePlan(scripts, {});
	assert.deepEqual(taskNames(plan), ['page:build', 'test:browser:audit:full']);
	assert.deepEqual(plan.at(-1).args, ['gh-pages.js']);
	assert.equal(scripts.page, 'node scripts/run-page.mjs');
	const steps = scripts['page:build'].split(' && ');
	assert(steps.indexOf('pnpm run prepare:page-container') < steps.indexOf('pnpm run build'));
	assert(steps.includes('pnpm run prepare:page-container'));
	assert.equal(scripts['prepare:page-container'], 'node scripts/prepare-page-container.mjs');
});

test('skipping deployment checks retains asset preparation and the website build', () => {
	const plan = createPagePlan(scripts, { WASM_IDLE_SKIP_ASSET_VERIFICATION: '1' });
	const names = taskNames(plan);
	for (const name of [
		'verify:page-c3',
		'verify:page-lfortran',
		'check:assets-lock',
		'test:browser:audit:full'
	])
		assert(!names.includes(name), name);
	for (const name of [
		'prepare:test-assets',
		'build:page-runtimes',
		'layer:static-runtimes',
		'assets:lock',
		'prepare:page-container',
		'build',
		'compress:build-runtimes'
	])
		assert(names.includes(name), name);
	assert.deepEqual(plan.at(-1).args, ['gh-pages.js']);
});

test('host-only deployment reuses static assets and still rebuilds the container example', () => {
	const plan = createPagePlan(scripts, {
		WASM_IDLE_SKIP_ASSET_VERIFICATION: '1',
		WASM_IDLE_PAGE_REUSE_ASSETS: '1'
	});
	assert.deepEqual(taskNames(plan), [
		'prepare:page-container',
		'build',
		'compress:build-runtimes'
	]);
	assert.deepEqual(plan.at(-1).args, ['gh-pages.js']);
});

test('asset reuse alone preserves verification and the full browser audit', () => {
	const names = taskNames(createPagePlan(scripts, { WASM_IDLE_PAGE_REUSE_ASSETS: '1' }));
	assert.equal(names.filter((name) => name === 'verify:page-c3').length, 2);
	assert.equal(names.filter((name) => name === 'verify:page-lfortran').length, 2);
	assert(names.includes('check:assets-lock'));
	assert(names.includes('test:browser:audit:full'));
	assert(!names.includes('assets:lock'));
	assert(!names.includes('sync:page-runtimes'));
});

test('only explicit 1 flags opt out, and unknown build command forms fail closed', () => {
	for (const value of [undefined, '', '0', 'true']) {
		const environment = {
			WASM_IDLE_SKIP_ASSET_VERIFICATION: value,
			WASM_IDLE_PAGE_REUSE_ASSETS: value
		};
		assert.equal(shouldSkipAssetVerification(environment), false);
		assert.deepEqual(taskNames(createPagePlan(scripts, environment)), [
			'page:build',
			'test:browser:audit:full'
		]);
	}
	assert.throws(
		() =>
			createPagePlan(
				{ 'page:build': 'node custom-build.mjs' },
				{ WASM_IDLE_PAGE_REUSE_ASSETS: '1' }
			),
		/Unsupported page:build command/
	);
});
