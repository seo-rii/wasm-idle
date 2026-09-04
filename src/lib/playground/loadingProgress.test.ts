import { describe, expect, it } from 'vitest';

import { createLoadingProgressController, type LoadingProgressState } from './loadingProgress';

describe('loading progress controller', () => {
	it('starts as unmeasured activity and never treats legacy numbers as percentages', () => {
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});
		const session = progress.start('Loading Python runtime');

		session.set?.(0.2, 'Initializing Pyodide');
		session.set?.(1, 'Legacy runtime ready');

		expect(states).toEqual([
			{
				visible: true,
				value: 0,
				stage: 'Loading Python runtime',
				indeterminate: true
			},
			{
				visible: true,
				value: 0,
				stage: 'Initializing Pyodide',
				indeterminate: true
			},
			{
				visible: true,
				value: 0,
				stage: 'Legacy runtime ready',
				indeterminate: true
			}
		]);
	});

	it('renders only valid byte measurements as phase-local determinate progress', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 25, total: 100 }
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 100, total: 100 }
		});

		expect(states.at(-2)).toEqual({
			visible: true,
			value: 0.25,
			stage: 'Downloading runtime',
			indeterminate: false
		});
		expect(states.at(-1)).toMatchObject({ visible: true, value: 1, indeterminate: false });
	});

	it('keeps a stable byte phase monotonic without using elapsed-time guesses', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 60, total: 100 }
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Late chunk',
			measurement: { kind: 'bytes', completed: 40, total: 100 }
		});

		expect(states.at(-1)).toEqual({
			visible: true,
			value: 0.6,
			stage: 'Late chunk',
			indeterminate: false
		});
	});

	it('fails closed to indeterminate when a denominator is invalid or changes mid-phase', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 10, total: 100 }
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Runtime asset set changed',
			measurement: { kind: 'bytes', completed: 20, total: 200 }
		});

		expect(states.at(-1)).toEqual({
			visible: true,
			value: 0,
			stage: 'Runtime asset set changed',
			indeterminate: true
		});

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Later update from the poisoned phase',
			measurement: { kind: 'bytes', completed: 30, total: 200 }
		});
		expect(states.at(-1)).toEqual({
			visible: true,
			value: 0,
			stage: 'Later update from the poisoned phase',
			indeterminate: true
		});

		session.report?.({
			kind: 'activity',
			phase: 'verifying',
			label: 'Verifying runtime',
			measurement: { kind: 'bytes', completed: 1, total: 0 }
		});
		expect(states.at(-1)).toMatchObject({ value: 0, indeterminate: true });
	});

	it.each([
		{ completed: -1, total: 100 },
		{ completed: 101, total: 100 },
		{ completed: 0.5, total: 100 },
		{ completed: 1, total: 1.5 },
		{ completed: Number.NaN, total: 100 },
		{ completed: 1, total: Number.POSITIVE_INFINITY }
	])('rejects malformed byte counts and keeps their phase poisoned: %o', (measurement) => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Malformed byte count',
			measurement: { kind: 'bytes', ...measurement }
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Later valid-looking count',
			measurement: { kind: 'bytes', completed: 50, total: 100 }
		});

		expect(states.at(-1)).toEqual({
			visible: true,
			value: 0,
			stage: 'Later valid-looking count',
			indeterminate: true
		});
	});

	it('retains a measured phase identity across unmeasured activity', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'runtime-assets',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 10, total: 100 }
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'runtime-assets',
			label: 'Waiting for the next chunk'
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'runtime-assets',
			label: 'Changed total after an unmeasured update',
			measurement: { kind: 'bytes', completed: 20, total: 200 }
		});

		expect(states.at(-1)).toMatchObject({
			value: 0,
			stage: 'Changed total after an unmeasured update',
			indeterminate: true
		});
	});

	it('allows a new measured phase to begin at a lower local ratio', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloaded runtime',
			measurement: { kind: 'bytes', completed: 100, total: 100 }
		});
		session.report?.({
			kind: 'activity',
			phase: 'verifying',
			label: 'Verifying runtime',
			measurement: { kind: 'bytes', completed: 10, total: 100 }
		});

		expect(states.at(-1)).toMatchObject({ value: 0.1, indeterminate: false });
	});

	it('allows an explicit phase ID to start a new pass of the same activity phase', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'compiler',
			label: 'Downloading compiler',
			measurement: { kind: 'bytes', completed: 90, total: 100 }
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'stdlib',
			label: 'Downloading standard library',
			measurement: { kind: 'bytes', completed: 10, total: 200 }
		});

		expect(states.at(-1)).toMatchObject({ value: 0.05, indeterminate: false });
	});

	it('isolates byte measurements from a new operation using the same phase', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'runtime-assets',
			operationId: 'first',
			label: 'First download',
			measurement: { kind: 'bytes', completed: 80, total: 100 }
		});
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'runtime-assets',
			operationId: 'second',
			label: 'Second download',
			measurement: { kind: 'bytes', completed: 10, total: 200 }
		});

		expect(states.at(-1)).toEqual({
			visible: true,
			value: 0.05,
			stage: 'Second download',
			indeterminate: false
		});
	});

	it('retires a prepare operation after the final run operation begins', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.({
			kind: 'activity',
			phase: 'compiling',
			operationId: 'CPP:prepare',
			label: 'Preparing C++ program'
		});
		session.report?.({
			kind: 'activity',
			phase: 'starting',
			operationId: 'CPP:run',
			label: 'Starting C++ program'
		});
		const statesBeforeStaleEvents = states.length;

		session.report?.({
			kind: 'activity',
			phase: 'compiling',
			operationId: 'CPP:prepare',
			label: 'Late prepare activity'
		});
		session.report?.({
			kind: 'ready',
			state: 'running',
			reason: 'result',
			operationId: 'CPP:prepare'
		});
		session.report?.({
			kind: 'settled',
			outcome: 'completed',
			operationId: 'CPP:prepare'
		});

		expect(states).toHaveLength(statesBeforeStaleEvents);
		expect(states.at(-1)).toMatchObject({
			visible: true,
			stage: 'Starting C++ program'
		});

		session.report?.({
			kind: 'ready',
			state: 'running',
			reason: 'started',
			operationId: 'CPP:run'
		});
		expect(states.at(-1)?.visible).toBe(false);
	});

	it('does not let unscoped activity or readiness supersede a correlated operation', () => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start('Checking LLDB debug runtime');

		session.report?.({
			kind: 'activity',
			phase: 'starting',
			operationId: 'RUST:run',
			label: 'Starting Rust program'
		});
		const statesBeforeUnscopedEvents = states.length;

		session.set?.(1, 'Late legacy completion');
		session.report?.({
			kind: 'activity',
			phase: 'resolving',
			label: 'Late unscoped LLDB activity'
		});
		session.report?.({ kind: 'ready', state: 'paused', reason: 'debug-paused' });

		expect(states).toHaveLength(statesBeforeUnscopedEvents);
		expect(states.at(-1)).toMatchObject({
			visible: true,
			stage: 'Starting Rust program'
		});

		// The unscoped settlement is emitted by the owner of this scoped page session.
		session.report?.({ kind: 'settled', outcome: 'timed-out' });
		expect(states.at(-1)?.visible).toBe(false);
	});

	it.each([
		{ kind: 'ready', state: 'running', reason: 'started' } as const,
		{ kind: 'ready', state: 'waiting-input', reason: 'stdin-request' } as const,
		{ kind: 'ready', state: 'paused', reason: 'debug-paused' } as const,
		{ kind: 'settled', outcome: 'completed' } as const,
		{ kind: 'settled', outcome: 'failed' } as const,
		{ kind: 'settled', outcome: 'cancelled' } as const,
		{ kind: 'settled', outcome: 'timed-out' } as const
	])('hides immediately for $kind lifecycle event', (event) => {
		const states: LoadingProgressState[] = [];
		const session = createLoadingProgressController({
			onChange: (state) => states.push(state)
		}).start();

		session.report?.(event);

		expect(states.at(-1)).toEqual({
			visible: false,
			value: 0,
			stage: '',
			indeterminate: false
		});
	});

	it('ignores late events from hidden and replaced sessions', () => {
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});
		const first = progress.start('First run');
		first.report?.({ kind: 'ready', state: 'running', reason: 'started' });
		first.set?.(0.5, 'Late first run');
		const second = progress.start('Second run');
		first.report?.({ kind: 'settled', outcome: 'completed' });
		second.set?.(0.5, 'Second run activity');

		expect(states.map((state) => state.stage)).toEqual([
			'First run',
			'',
			'Second run',
			'Second run activity'
		]);
	});

	it('invalidates a scoped reporter when progress is reset', () => {
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});
		const session = progress.start('Starting run');

		progress.reset();
		session.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Late download',
			measurement: { kind: 'bytes', completed: 50, total: 100 }
		});

		expect(states).toHaveLength(2);
		expect(states.at(-1)?.visible).toBe(false);
	});

	it('does not let a result or failure resurrect a settled session', () => {
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});
		const session = progress.start('Starting run');

		session.report?.({ kind: 'settled', outcome: 'completed' });
		session.report?.({ kind: 'ready', state: 'running', reason: 'result' });
		session.report?.({
			kind: 'activity',
			phase: 'starting',
			label: 'Late activity'
		});

		expect(states).toHaveLength(2);
		expect(states.at(-1)?.visible).toBe(false);
	});

	it('does not let controller-level late updates resurrect a settled session', () => {
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});
		const session = progress.start('Starting run');

		session.report?.({ kind: 'settled', outcome: 'completed' });
		progress.set?.(1, 'Late legacy completion');
		progress.report?.({
			kind: 'activity',
			phase: 'starting',
			operationId: 'late-run',
			label: 'Late correlated activity'
		});

		expect(states).toHaveLength(2);
		expect(states.at(-1)?.visible).toBe(false);
	});
});
