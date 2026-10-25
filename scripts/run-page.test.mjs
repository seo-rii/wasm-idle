import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPagePlan, shouldSkipAssetVerification } from './run-page.mjs';

const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const taskNames = (plan) =>
	plan.filter((step) => step.args[0] === 'run').map((step) => step.args[1]);

test('ordinary page deployments verify built assets and smoke-test the page before publishing', () => {
	const plan = createPagePlan(scripts, {});
	assert.deepEqual(taskNames(plan), [
		'page:build',
		'verify:page-assets',
		'test:browser:page-smoke'
	]);
	assert.deepEqual(plan.at(-1).args, ['gh-pages.js']);
	assert.equal(scripts.page, 'node scripts/run-page.mjs');
	const steps = scripts['page:build'].split(' && ');
	assert(steps.indexOf('pnpm run prepare:page-container') < steps.indexOf('pnpm run build'));
	assert(steps.includes('pnpm run prepare:page-container'));
	assert.equal(scripts['prepare:page-container'], 'node scripts/prepare-page-container.mjs');
});

test('skipping deployment checks retains asset preparation and the website build', () => {
	const plan = createPagePlan(scripts, {
		WASM_IDLE_SKIP_ASSET_VERIFICATION: '1',
		WASM_IDLE_PAGE_FULL_AUDIT: '1'
	});
	const names = taskNames(plan);
	for (const name of [
		'verify:page-c3',
		'verify:page-lfortran',
		'check:assets-lock',
		'verify:page-assets',
		'test:browser:page-smoke',
		'test:browser:audit:full'
	])
		assert(!names.includes(name), name);
	for (const name of [
		'sync:phpantom-lsp',
		'sync:forth-lsp',
		'sync:c3-lsp',
		'sync:v-lsp',
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
		WASM_IDLE_PAGE_REUSE_ASSETS: '1',
		WASM_IDLE_PAGE_FULL_AUDIT: '1'
	});
	assert.deepEqual(taskNames(plan), [
		'prepare:page-container',
		'build',
		'compress:build-runtimes'
	]);
	assert.deepEqual(plan.at(-1).args, ['gh-pages.js']);
});

test('asset reuse preserves receipt checks, build checks and the page smoke test', () => {
	const names = taskNames(createPagePlan(scripts, { WASM_IDLE_PAGE_REUSE_ASSETS: '1' }));
	assert.deepEqual(names, [
		'verify:page-c3',
		'verify:page-lfortran',
		'check:assets-lock',
		'prepare:page-container',
		'build',
		'compress:build-runtimes',
		'verify:page-c3',
		'verify:page-lfortran',
		'verify:page-assets',
		'test:browser:page-smoke'
	]);
});

test('the full browser audit is explicit and runs after the smoke test before publishing', () => {
	for (const reuseAssets of [undefined, '1']) {
		const environment = { WASM_IDLE_PAGE_REUSE_ASSETS: reuseAssets };
		const ordinaryPlan = createPagePlan(scripts, environment);
		const plan = createPagePlan(scripts, { ...environment, WASM_IDLE_PAGE_FULL_AUDIT: '1' });
		assert.deepEqual(plan.slice(0, -2), ordinaryPlan.slice(0, -1));
		assert.deepEqual(plan.at(-2).args, ['run', 'test:browser:audit:full', '--use-build']);
		assert.deepEqual(plan.at(-1), ordinaryPlan.at(-1));
	}
});

test('only explicit 1 flags change the default deployment checks', () => {
	for (const value of [undefined, '', '0', 'true', '01', ' 1', '1 ']) {
		const environment = {
			WASM_IDLE_SKIP_ASSET_VERIFICATION: value,
			WASM_IDLE_PAGE_REUSE_ASSETS: value,
			WASM_IDLE_PAGE_FULL_AUDIT: value
		};
		assert.equal(shouldSkipAssetVerification(environment), false);
		assert.deepEqual(taskNames(createPagePlan(scripts, environment)), [
			'page:build',
			'verify:page-assets',
			'test:browser:page-smoke'
		]);
	}
});

test('unknown build command forms fail closed when selecting individual build steps', () => {
	for (const environment of [
		{ WASM_IDLE_PAGE_REUSE_ASSETS: '1' },
		{ WASM_IDLE_SKIP_ASSET_VERIFICATION: '1' }
	]) {
		assert.throws(
			() => createPagePlan({ 'page:build': 'node custom-build.mjs' }, environment),
			/Unsupported page:build command/
		);
	}
});
