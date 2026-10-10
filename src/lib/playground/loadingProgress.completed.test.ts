import { expect, it } from 'vitest';
import { createLoadingProgressController, type LoadingProgressState } from './loadingProgress';

it.each(['unmeasured', 'invalid-total'] as const)(
	'does not demote a completed byte phase after %s activity',
	(update) => {
		const states: LoadingProgressState[] = [];
		const controller = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});
		const session = controller.start();
		const phase = {
			kind: 'activity' as const,
			phase: 'downloading' as const,
			phaseId: 'compiler',
			operationId: 'build',
			label: 'Downloading compiler'
		};
		session.report?.({ ...phase, measurement: { kind: 'bytes', completed: 100, total: 100 } });
		session.report?.({
			...phase,
			...(update === 'invalid-total'
				? { measurement: { kind: 'bytes' as const, completed: 100, total: 0 } }
				: {})
		});
		expect(states.slice(1).map((state) => state.value)).toEqual([1, 1]);
		expect(states.at(-1)?.visible).toBe(true);
		// A new measured phase retains its local denominator; do not manufacture global percentages.
		session.report?.({
			...phase,
			phase: 'verifying',
			phaseId: 'verification',
			label: 'Verifying compiler',
			measurement: { kind: 'bytes', completed: 1, total: 10 }
		});
		expect(states.at(-1)?.value).toBe(0.1);
		session.report?.({ kind: 'ready', operationId: 'build', state: 'running', reason: 'stdout' });
		expect(states.at(-1)?.visible).toBe(false);
	}
);
