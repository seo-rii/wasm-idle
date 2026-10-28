import assert from 'node:assert/strict';
import { test } from 'node:test';

import { waitForInitialTinyGoBrowserReadiness } from './tinygo-browser-probe-lib.mjs';

const ready = {
	crossOriginIsolated: true,
	sharedArrayBuffer: true,
	serviceWorkerControlled: true
};
const notReady = { ...ready, serviceWorkerControlled: false };
const url = 'http://127.0.0.1:5173/wasm-idle/';

function mockPage(t, reads, { readinessError, loadError } = {}) {
	t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
	const calls = { navigations: [], reads: 0, loadWaits: 0, delays: [] };
	return {
		calls,
		async goto(target, options) {
			calls.navigations.push({ target, ...options });
		},
		async evaluate(_callback, serviceWorkerWaitMs) {
			if (serviceWorkerWaitMs !== undefined) {
				if (readinessError) throw readinessError;
				t.mock.timers.tick(serviceWorkerWaitMs);
				return;
			}
			const result = reads[Math.min(calls.reads++, reads.length - 1)];
			if (result instanceof Error) throw result;
			return result;
		},
		async waitForLoadState() {
			calls.loadWaits += 1;
			if (loadError) throw loadError;
		},
		async waitForTimeout(delay) {
			calls.delays.push(delay);
			t.mock.timers.tick(delay);
		}
	};
}

test('initial readiness survives a service-worker navigation before measuring COI', async (t) => {
	for (const message of [
		'page.evaluate: Execution context was destroyed, most likely because of a navigation',
		'page.evaluate: Cannot find context with specified id'
	]) {
		const page = mockPage(t, [new Error(message), ready]);
		assert.deepEqual(await waitForInitialTinyGoBrowserReadiness(page, url, 10_000), ready);
		assert.equal(page.calls.reads, 2);
		assert.equal(page.calls.loadWaits, 1);
		assert.equal(page.calls.navigations.length, 1);
		t.mock.timers.reset();
	}
});

test('initial readiness retains the existing controlled-page navigation fallback', async (t) => {
	const page = mockPage(t, [notReady, ready]);
	assert.deepEqual(await waitForInitialTinyGoBrowserReadiness(page, url, 10_000), ready);
	assert.equal(page.calls.navigations.length, 2);
});

test('a permanently unready page fails within the original deadline', async (t) => {
	const page = mockPage(t, [notReady]);
	const deadline = Date.now() + 2_100;
	await assert.rejects(
		waitForInitialTinyGoBrowserReadiness(page, url, 2_100),
		/page is not ready for wasm-idle TinyGo/u
	);
	assert.equal(Date.now(), deadline);
	assert.equal(page.calls.navigations.length, 1);
});

test('repeated transient navigations cannot reset the initial deadline', async (t) => {
	const navigationError = new Error('page.evaluate: Execution context was destroyed');
	const page = mockPage(t, [navigationError]);
	const deadline = Date.now() + 2_600;
	await assert.rejects(waitForInitialTinyGoBrowserReadiness(page, url, 2_600), (error) => {
		assert.match(error.message, /page is not ready for wasm-idle TinyGo/u);
		assert.equal(error.cause, navigationError);
		return true;
	});
	assert.equal(Date.now(), deadline);
	assert.equal(page.calls.navigations.length, 1);
	assert.ok(page.calls.reads <= 4);
});

test('initial readiness keeps the existing four-reload bound', async (t) => {
	const page = mockPage(t, [notReady]);
	await assert.rejects(
		waitForInitialTinyGoBrowserReadiness(page, url, 300_000),
		/page is not ready for wasm-idle TinyGo/u
	);
	assert.equal(page.calls.navigations.length, 5);
});

test('non-navigation evaluation and readiness errors propagate immediately', async (t) => {
	for (const failure of [
		new Error('page.evaluate: application initialization failed'),
		new Error('page.evaluate: Target page, context or browser has been closed')
	]) {
		const page = mockPage(t, [failure]);
		await assert.rejects(waitForInitialTinyGoBrowserReadiness(page, url, 10_000), (error) => {
			assert.equal(error, failure);
			return true;
		});
		assert.equal(page.calls.reads, 1);
		assert.equal(page.calls.loadWaits, 0);
		t.mock.timers.reset();
	}
	const failure = new Error('service-worker readiness failed');
	const page = mockPage(t, [notReady], { readinessError: failure });
	await assert.rejects(waitForInitialTinyGoBrowserReadiness(page, url, 10_000), (error) => {
		assert.equal(error, failure);
		return true;
	});
});

test('non-navigation errors during the recovery load wait propagate', async (t) => {
	const failure = new Error('page.waitForLoadState: browser has been closed');
	const page = mockPage(t, [new Error('page.evaluate: Execution context was destroyed')], {
		loadError: failure
	});
	await assert.rejects(waitForInitialTinyGoBrowserReadiness(page, url, 10_000), (error) => {
		assert.equal(error, failure);
		return true;
	});
});
