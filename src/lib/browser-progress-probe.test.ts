// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
	assertLoadingProgressTrace,
	installLoadingProgressProbe,
	readLoadingProgressTrace,
	stopLoadingProgressProbe
} from '../../scripts/browser-progress-probe.mjs';

const localPage = {
	evaluate: async (callback: (...args: any[]) => unknown, argument?: unknown) =>
		await callback(argument)
};

async function flushMutationObserver() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(async () => {
	await stopLoadingProgressProbe(localPage as never);
	document.body.replaceChildren();
	delete (globalThis as any).__wasmIdleProgressTrace;
	delete (globalThis as any).__wasmIdleProgressObserver;
});

describe('loading progress DOM observer', () => {
	it('records only semantic DOM events and ignores visual-only animation changes', async () => {
		await installLoadingProgressProbe(localPage as never);
		const progressBar = document.createElement('div');
		progressBar.className = 'progress-track';
		progressBar.setAttribute('role', 'progressbar');
		progressBar.setAttribute('aria-label', 'Downloading runtime');
		progressBar.setAttribute('aria-valuenow', '20');
		progressBar.setAttribute('data-progress-mode', 'determinate');
		const fill = document.createElement('div');
		fill.className = 'progress-fill';
		progressBar.append(fill);
		document.body.append(progressBar);
		await flushMutationObserver();

		fill.style.transform = 'scaleX(0.98)';
		await flushMutationObserver();
		expect(await readLoadingProgressTrace(localPage as never)).toHaveLength(1);

		progressBar.setAttribute('aria-valuenow', '40');
		await flushMutationObserver();
		progressBar.remove();
		await flushMutationObserver();
		const trace = await readLoadingProgressTrace(localPage as never);

		expect(trace).toMatchObject([
			{ value: 20, mode: 'determinate', observed: ['visibility'] },
			{ value: 40, mode: 'determinate', observed: ['aria-valuenow'] },
			{ value: null, mode: 'hidden', observed: ['visibility'] }
		]);
	});
});

describe('assertLoadingProgressTrace', () => {
	it('accepts determinate movement backed by observed value changes', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{
						label: 'Downloading runtime',
						value: 0,
						mode: 'determinate',
						at: 0,
						observed: ['visibility']
					},
					{
						label: 'Downloading runtime',
						value: 35,
						mode: 'determinate',
						at: 10,
						observed: ['aria-valuenow']
					},
					{
						label: 'Initializing runtime',
						value: null,
						mode: 'indeterminate',
						at: 20,
						observed: ['data-progress-mode', 'aria-label']
					},
					{
						label: 'Initializing runtime',
						value: null,
						mode: 'hidden',
						at: 30,
						observed: ['visibility']
					}
				],
				'fixture',
				{ at: 35, reason: 'expected output' }
			)
		).not.toThrow();
	});

	it('does not infer progress or failure from a timer plateau', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{
						label: 'Downloading runtime',
						value: 20,
						mode: 'determinate',
						at: 0,
						observed: ['visibility']
					},
					{
						label: 'Downloading runtime',
						value: null,
						mode: 'hidden',
						at: 60_000,
						observed: ['visibility']
					}
				],
				'fixture',
				{ at: 60_001, reason: 'runtime ready' }
			)
		).not.toThrow();
	});

	it('treats indeterminate activity as having no percentage semantics', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{
						label: 'Compiling program',
						value: null,
						mode: 'indeterminate',
						at: 0,
						observed: ['visibility']
					},
					{
						label: 'Compiling program',
						value: null,
						mode: 'hidden',
						at: 90_000,
						observed: ['visibility']
					}
				],
				'fixture'
			)
		).not.toThrow();

		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Compiling', value: 40, mode: 'indeterminate' },
					{ label: 'Compiling', value: null, mode: 'hidden' }
				],
				'fixture'
			)
		).toThrow('invalid loading progress');
	});

	it('rejects determinate movement that was not caused by an observed value event', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{
						label: 'Downloading',
						value: 10,
						mode: 'determinate',
						at: 0,
						observed: ['visibility']
					},
					{
						label: 'Downloading',
						value: 20,
						mode: 'determinate',
						at: 10,
						observed: ['aria-label']
					},
					{
						label: 'Downloading',
						value: null,
						mode: 'hidden',
						at: 20,
						observed: ['visibility']
					}
				],
				'fixture'
			)
		).toThrow('moved without an observed event');

		expect(() =>
			assertLoadingProgressTrace(
				[
					{
						label: 'Downloading',
						value: null,
						mode: 'indeterminate',
						at: 0,
						observed: ['visibility']
					},
					{
						label: 'Downloading',
						value: 20,
						mode: 'determinate',
						at: 10,
						observed: ['data-progress-mode']
					},
					{
						label: 'Downloading',
						value: null,
						mode: 'hidden',
						at: 20,
						observed: ['visibility']
					}
				],
				'fixture'
			)
		).toThrow('moved without an observed event');
	});

	it('allows phase-local resets but rejects regression within one phase label', () => {
		const phaseReset = [
			{ label: 'Downloading compiler', value: 80, mode: 'determinate' as const },
			{ label: 'Downloading runtime', value: 10, mode: 'determinate' as const },
			{ label: 'Downloading runtime', value: null, mode: 'hidden' as const }
		];
		expect(() => assertLoadingProgressTrace(phaseReset, 'fixture')).not.toThrow();

		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Downloading runtime', value: 80 },
					{ label: 'Downloading runtime', value: 10 },
					{ label: 'Downloading runtime', value: null, mode: 'hidden' }
				],
				'fixture'
			)
		).toThrow('invalid loading progress');
	});

	it('requires consistent timestamps and observation metadata', () => {
		expect(() =>
			assertLoadingProgressTrace(
				[
					{ label: 'Loading', value: 20, at: 10 },
					{ label: 'Loading', value: null, mode: 'hidden', at: 5 }
				],
				'fixture'
			)
		).toThrow('invalid loading progress timestamp');

		expect(() =>
			assertLoadingProgressTrace(
				[
					{
						label: 'Loading',
						value: 20,
						observed: ['visibility']
					},
					{ label: 'Loading', value: null, mode: 'hidden' }
				],
				'fixture'
			)
		).toThrow('change was not observed');
	});

	it('tracks whether the indicator was hidden by independently observed readiness', () => {
		const trace = [
			{ label: 'Starting runtime', value: null, mode: 'indeterminate' as const, at: 0 },
			{ label: 'Starting runtime', value: null, mode: 'hidden' as const, at: 25 }
		];
		expect(() =>
			assertLoadingProgressTrace(trace, 'fixture', { at: 30, reason: 'expected output' })
		).not.toThrow();
		expect(() =>
			assertLoadingProgressTrace(trace, 'fixture', { at: 20, reason: 'expected output' })
		).toThrow('remained visible after expected output');
	});

	it('requires exactly one final hidden transition', () => {
		expect(() =>
			assertLoadingProgressTrace([{ label: 'Loading runtime', value: 50 }], 'fixture')
		).toThrow('did not become hidden');
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
		).toThrow('did not become hidden');
	});
});
