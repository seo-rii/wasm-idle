import { describe, expect, it } from 'vitest';
import { createExecutionObserver } from './executionObservation';

describe('execution observation', () => {
	it('preserves the failed phase and rejects late events from an earlier run', () => {
		const observer = createExecutionObserver();
		const first = observer.start(1, 'NIM', {});
		first.report?.({ kind: 'activity', phase: 'compiling', label: 'Nim to C' });
		observer.finish(1, 'failed', new Error('invalid source'));
		expect(observer.snapshot()).toMatchObject({
			status: 'failed',
			exitCode: null,
			stage: 'Nim to C',
			error: 'Error: invalid source'
		});
		observer.start(2, 'CSHARP', {});
		first.report?.({ kind: 'ready', state: 'running', reason: 'started' });
		observer.finish(1, 'completed');
		expect(observer.snapshot()).toMatchObject({
			id: 2,
			language: 'CSHARP',
			status: 'preparing',
			exitCode: null
		});
		observer.finish(2, 'completed');
		expect(observer.snapshot()).toMatchObject({ status: 'completed', exitCode: 0 });
	});
	it('bounds the diagnostic buffer and returns independent snapshots', () => {
		const observer = createExecutionObserver();
		const progress = observer.start(1, 'NIM', {});
		for (let i = 0; i < 200; i++)
			progress.report?.({ kind: 'activity', phase: 'initializing', label: `step ${i}` });
		const snapshot = observer.snapshot();
		expect(snapshot.events).toHaveLength(128);
		snapshot.events[0].stage = 'changed';
		expect(observer.snapshot().events[0].stage).not.toBe('changed');
	});
});
