import { describe, expect, it, vi } from 'vitest';

import { reportWorkerProgress } from './workerProgress';

describe('reportWorkerProgress', () => {
	it('normalizes numeric and structured worker progress', () => {
		const set = vi.fn();

		reportWorkerProgress({ set }, 0.4);
		reportWorkerProgress({ set }, { percent: 75, stage: 'Linking program' });

		expect(set).toHaveBeenNthCalledWith(1, 0.4);
		expect(set).toHaveBeenNthCalledWith(2, 0.75, 'Linking program');
	});

	it('clamps finite values and ignores malformed payloads', () => {
		const set = vi.fn();

		reportWorkerProgress({ set }, { percent: 125 });
		reportWorkerProgress({ set }, { percent: Number.NaN });
		reportWorkerProgress({ set }, null);

		expect(set).toHaveBeenCalledOnce();
		expect(set).toHaveBeenCalledWith(1, undefined);
	});
});
