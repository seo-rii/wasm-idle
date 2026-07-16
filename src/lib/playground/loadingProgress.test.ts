import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createLoadingProgressController,
	LOADING_PROGRESS_STALL_MS,
	type LoadingProgressState
} from './loadingProgress';

describe('loading progress controller', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('switches a stalled determinate value to an honest indeterminate state', () => {
		vi.useFakeTimers();
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});

		progress.start('Loading Python runtime');
		progress.set(0.2, 'Initializing Pyodide');
		vi.advanceTimersByTime(LOADING_PROGRESS_STALL_MS);

		expect(states.at(-1)).toEqual({
			value: 0.2,
			stage: 'Initializing Pyodide',
			indeterminate: true
		});
	});

	it('does not render an early high value as a trustworthy percentage', () => {
		vi.useFakeTimers();
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});

		progress.start('Loading C runtime');
		progress.set(0.9, 'Compiling C source');

		expect(states.at(-1)).toEqual({
			value: 0.9,
			stage: 'Compiling C source',
			indeterminate: true
		});
	});

	it('returns to determinate mode when measurable work advances later', () => {
		vi.useFakeTimers();
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});

		progress.start();
		progress.set(0.3, 'Downloading compiler');
		vi.advanceTimersByTime(LOADING_PROGRESS_STALL_MS);
		progress.set(0.45, 'Downloading compiler');

		expect(states.at(-1)).toMatchObject({ value: 0.45, indeterminate: false });
	});

	it('does not reset a stalled value when only its stage label changes', () => {
		vi.useFakeTimers();
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});

		progress.start();
		progress.set(0.4, 'Downloading compiler');
		vi.advanceTimersByTime(LOADING_PROGRESS_STALL_MS);
		progress.set(0.4, 'Initializing compiler');

		expect(states.at(-1)).toEqual({
			value: 0.4,
			stage: 'Initializing compiler',
			indeterminate: true
		});
	});

	it('stays monotonic, completes determinately, and cancels timers on reset', () => {
		vi.useFakeTimers();
		const states: LoadingProgressState[] = [];
		const progress = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});

		progress.start();
		progress.set(0.4, 'Loading runtime');
		progress.set(0.2, 'Stale runtime event');
		progress.set(1, 'Runtime ready');
		vi.advanceTimersByTime(LOADING_PROGRESS_STALL_MS * 2);
		expect(states.at(-1)).toEqual({
			value: 1,
			stage: 'Runtime ready',
			indeterminate: false
		});

		progress.reset();
		vi.advanceTimersByTime(LOADING_PROGRESS_STALL_MS * 2);
		expect(states.at(-1)).toEqual({ value: -1, stage: '', indeterminate: false });
	});
});
