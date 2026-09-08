import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
	classifyTerminalRun,
	withWallClockTimeout
} from '../../scripts/stdin-browser-probe-lib.mjs';

describe('classifyTerminalRun', () => {
	const completed = { id: 2, status: 'completed', exitCode: 0 };
	it('requires the current run to settle, even after expected output appears', () => {
		expect(
			classifyTerminalRun('', 'main=73', 'main=73', { ...completed, status: 'running' }, 1)
		).toBe('running');
		expect(classifyTerminalRun('', 'main=73', 'main=73', completed, 2)).toBe('running');
		expect(classifyTerminalRun('', 'main=73', 'main=73', null, 1)).toBe('running');
	});
	it('accepts only current output with successful completion and zero exit', () => {
		expect(
			classifyTerminalRun('old main=73', 'old main=73\nother', 'main=73', completed, 1)
		).toBe('failure');
		expect(classifyTerminalRun('ready', 'ready\nmain=73', 'main=73', completed, 1)).toBe(
			'success'
		);
		expect(
			classifyTerminalRun('', 'main=73', 'main=73', { ...completed, exitCode: 1 }, 1)
		).toBe('failure');
	});
	it.each(['failed', 'cancelled', 'timed-out'])(
		'does not mistake output before %s for success',
		(status) => {
			expect(
				classifyTerminalRun(
					'',
					'main=73\nProcess finished after 12ms',
					'main=73',
					{ ...completed, status },
					1
				)
			).toBe('failure');
		}
	);
});

describe('withWallClockTimeout', () => {
	it('returns a completed browser operation', async () => {
		await expect(withWallClockTimeout(Promise.resolve('done'), 50)).resolves.toBe('done');
	});

	it('rejects an unresponsive browser operation at the wall-clock deadline', async () => {
		await expect(
			withWallClockTimeout(new Promise(() => {}), 5, 'terminal read')
		).rejects.toThrow('terminal read timed out after 5ms');
	});
});

describe('stdin browser probe language selector', () => {
	it('targets the language selector instead of whichever select happens to render first', async () => {
		const source = await readFile('scripts/stdin-browser-probe-lib.mjs', 'utf8');

		expect(source).toContain("page.locator('#language-select').selectOption(language)");
		expect(source).toContain("document.querySelector('#language-select')");
		expect(source).toContain('HTMLSelectElement | null');
		expect(source).toMatch(/\?\.value\s*===\s*expectedLanguage/u);
		expect(source).not.toMatch(/(?:locator|waitForSelector)\('select'/u);
		expect(source).not.toContain("querySelector('select')");
	});
});
