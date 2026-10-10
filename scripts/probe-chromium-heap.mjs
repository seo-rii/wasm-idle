#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// A measurement calibration, not a debugger/runtime benchmark. Never replace
// the product lifecycle test with this small allocation probe.
const executablePath = process.argv[2] || process.env.WASM_IDLE_CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error('Pass the precision-enabled Chromium launcher');
const browser = await chromium.launch({ headless: true, executablePath });
try {
	const page = await browser.newPage();
	await page.setContent('<title>Heap measurement calibration</title>');
	const read = () => page.evaluate(() => performance.memory.usedJSHeapSize);
	await page.requestGC();
	const baseline = await read();
	await page.evaluate(() => {
		globalThis.__heapCalibration = new Uint8Array(96 * 1024 * 1024);
		globalThis.__heapCalibration.fill(1);
	});
	await page.requestGC();
	const retained = await read();
	await page.evaluate(() => { delete globalThis.__heapCalibration; });
	await page.requestGC();
	const released = await read();
	const evidence = { browser: browser.version(), measurement: 'performance.memory.usedJSHeapSize',
		baseline, retained, released, retainedGrowth: retained - baseline, releasedGrowth: released - baseline,
		scope: 'local renderer including external memory; not product lifecycle or process RSS' };
	console.log(JSON.stringify(evidence));
	assert.ok(baseline > 0, 'Heap measurements must be available');
	// A deliberately retained buffer must fail the product's unchanged 64 MiB threshold.
	assert.ok(retained - baseline > 64 * 1024 * 1024, 'Retained memory was hidden by a stale/bucketized measurement');
	assert.ok(released - baseline < 16 * 1024 * 1024, 'Released memory measurement did not refresh after GC');
} finally { await browser.close(); }
