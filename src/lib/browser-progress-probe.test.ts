import { describe, expect, it } from 'vitest';

import { assertLoadingProgressTrace } from '../../scripts/browser-progress-probe.mjs';

describe('assertLoadingProgressTrace', () => {
	it('accepts labeled, monotonic progress that advances', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: 0 },
					{ label: 'Loading runtime', value: 35 },
					{ label: 'Running program', value: 100 }
				],
				'fixture'
			)
		).not.toThrow();
	});

	it('rejects absent, stalled, malformed, and regressing progress', () => {
		expect(() => assertLoadingProgressTrace([], 'fixture')).toThrow('never rendered');
		expect(() =>
			assertLoadingProgressTrace([{ label: 'Loading runtime', value: 0 }], 'fixture')
		).toThrow('never advanced');
		expect(() =>
			assertLoadingProgressTrace([{ label: '', value: 50 }], 'fixture')
		).toThrow('invalid loading progress');
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: 75 },
					{ label: 'Loading runtime', value: 50 }
				],
				'fixture'
			)
		).toThrow('invalid loading progress');
	});
});
