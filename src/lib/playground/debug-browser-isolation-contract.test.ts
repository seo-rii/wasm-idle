import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const browserTestSource = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');

function sharedPageHelperSource() {
	const start = browserTestSource.indexOf('async function ensureSharedBrowserPage(');
	const end = browserTestSource.indexOf('\nasync function readPausedLine(', start);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return browserTestSource.slice(start, end);
}

describe('LLDB browser isolation test contract', () => {
	it('lets the product perform the only post-registration reload', () => {
		const helperSource = sharedPageHelperSource();
		expect(helperSource.match(/page\.goto\(/gu) ?? []).toHaveLength(1);
		expect(helperSource).not.toContain('navigator.serviceWorker.ready');
	});
});
