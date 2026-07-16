import { describe, expect, it } from 'vitest';

import { assertLoadingProgressTrace } from '../../scripts/browser-progress-probe.mjs';

describe('assertLoadingProgressTrace', () => {
	it('accepts labeled, monotonic progress that advances', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: 0 },
					{ label: 'Loading runtime', value: 35 },
					{ label: 'Running program', value: 100 },
					{ label: 'Running program', value: null, mode: 'hidden' }
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
		expect(() => assertLoadingProgressTrace([{ label: '', value: 50 }], 'fixture')).toThrow(
			'invalid loading progress'
		);
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

	it('rejects malformed DOM values and invalid timestamps', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: null, mode: 'determinate' },
					{ label: 'Loading runtime', value: null, mode: 'hidden' }
				],
				'fixture'
			)
		).toThrow('invalid loading progress');
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: 20, mode: 'determinate', at: 10 },
					{ label: 'Loading runtime', value: null, mode: 'hidden', at: 5 }
				],
				'fixture'
			)
		).toThrow('invalid loading progress timestamp');
	});

	it('accepts an indeterminate transition before a long unmeasured phase', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: 20, mode: 'determinate', at: 0 },
					{ label: 'Initializing runtime', value: null, mode: 'indeterminate', at: 1500 },
					{ label: 'Initializing runtime', value: null, mode: 'hidden', at: 9000 }
				],
				'fixture'
			)
		).not.toThrow();
	});

	it('rejects a determinate value that remains visible without updates', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: 85, mode: 'determinate', at: 0 },
					{ label: 'Loading runtime', value: null, mode: 'hidden', at: 5000 }
				],
				'fixture'
			)
		).toThrow('stalled at 85%');
	});

	it('does not let stage label changes hide a determinate plateau', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading compiler', value: 90, mode: 'determinate', at: 0 },
					{ label: 'Initializing compiler', value: 90, mode: 'determinate', at: 2500 },
					{ label: 'Preparing compiler', value: 90, mode: 'determinate', at: 4500 },
					{ label: 'Preparing compiler', value: null, mode: 'hidden', at: 5000 }
				],
				'fixture'
			)
		).toThrow('stalled at 90%');
	});

	it('requires one final hidden completion event', () => {
		expect(() =>
			assertLoadingProgressTrace([{ label: 'Loading runtime', value: 50 }], 'fixture')
		).toThrow('did not complete');
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading runtime', value: 50 },
					{ label: 'Loading runtime', value: null, mode: 'hidden' },
					{ label: 'Loading runtime again', value: 75 },
					{ label: 'Loading runtime again', value: null, mode: 'hidden' }
				],
				'fixture'
			)
		).toThrow('did not complete');
	});
});
