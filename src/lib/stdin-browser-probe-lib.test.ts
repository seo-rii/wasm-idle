import { describe, expect, it } from 'vitest';

import {
	classifyTerminalRun,
	withWallClockTimeout
} from '../../scripts/stdin-browser-probe-lib.mjs';

describe('classifyTerminalRun', () => {
	it('waits while the terminal has no new conclusive output', () => {
		expect(classifyTerminalRun('ready', 'ready', 'main=73')).toBe('running');
		expect(classifyTerminalRun('ready', 'ready\ncompiling', 'main=73')).toBe('running');
	});

	it('accepts expected output only from the current run', () => {
		expect(classifyTerminalRun('old main=73', 'old main=73\ncompiling', 'main=73')).toBe(
			'running'
		);
		expect(classifyTerminalRun('ready', 'ready\nmain=73', 'main=73')).toBe('success');
	});

	it('fails immediately when the current run exits without expected output', () => {
		expect(classifyTerminalRun('ready', 'ready\nprocess exited with code 1', 'main=73')).toBe(
			'failure'
		);
		expect(classifyTerminalRun('ready', 'ready\nProcess finished after 12ms', 'main=73')).toBe(
			'failure'
		);
		expect(classifyTerminalRun('ready', 'ready\r\n\x1b[1;3;31mcompile failed', 'main=73')).toBe(
			'failure'
		);
	});
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
