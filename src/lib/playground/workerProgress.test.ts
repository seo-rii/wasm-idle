import { describe, expect, it, vi } from 'vitest';

import { reportWorkerInputReady, reportWorkerProgress } from './workerProgress';

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

	it('forwards validated readiness and settlement without trusting a worker operation id', () => {
		const report = vi.fn();

		const ready = reportWorkerProgress(
			{ report },
			{
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'Program started',
				operationId: 'worker-controlled'
			}
		);
		const settled = reportWorkerProgress(
			{ report },
			{
				kind: 'settled',
				outcome: 'completed',
				label: 'Program complete',
				operationId: 'worker-controlled'
			}
		);

		expect(ready).toEqual({
			kind: 'ready',
			state: 'running',
			reason: 'started',
			label: 'Program started'
		});
		expect(settled).toEqual({
			kind: 'settled',
			outcome: 'completed',
			label: 'Program complete'
		});
		expect(report.mock.calls).toEqual([[ready], [settled]]);
	});

	it('maps user-ready and successful settlement events onto legacy numeric sinks', () => {
		const set = vi.fn();

		reportWorkerProgress(
			{ set },
			{ kind: 'ready', state: 'waiting-input', reason: 'stdin-request', label: 'Input' }
		);
		reportWorkerProgress({ set }, { kind: 'settled', outcome: 'completed', label: 'Complete' });
		reportWorkerProgress({ set }, { kind: 'settled', outcome: 'failed', label: 'Failed' });

		expect(set.mock.calls).toEqual([
			[1, 'Input'],
			[1, 'Complete']
		]);
	});

	it('reports stdin waits as execution readiness', () => {
		const report = vi.fn();

		expect(reportWorkerInputReady({ report }, 'Haskell ready for input')).toEqual({
			kind: 'ready',
			state: 'waiting-input',
			reason: 'stdin-request',
			label: 'Haskell ready for input'
		});
		expect(report).toHaveBeenCalledWith({
			kind: 'ready',
			state: 'waiting-input',
			reason: 'stdin-request',
			label: 'Haskell ready for input'
		});
	});

	it('ignores malformed lifecycle envelopes', () => {
		const progress = { set: vi.fn(), report: vi.fn() };

		expect(
			reportWorkerProgress(progress, {
				kind: 'ready',
				state: 'bootstrapped',
				reason: 'started'
			})
		).toBeUndefined();
		expect(
			reportWorkerProgress(progress, { kind: 'settled', outcome: 'pending', percent: 100 })
		).toBeUndefined();
		expect(
			reportWorkerProgress(progress, { kind: 'activity', label: 'Unscoped' })
		).toBeUndefined();
		expect(progress.set).not.toHaveBeenCalled();
		expect(progress.report).not.toHaveBeenCalled();
	});
});
