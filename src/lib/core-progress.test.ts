import { describe, expect, it, vi } from 'vitest';

import { supportedLanguageIds } from '../../packages/core/src/languages.js';
import {
	RuntimeProgressController,
	phaseProgress,
	progressBandsForLanguage,
	type RuntimeProgressEvent
} from '../../packages/core/src/progress.js';

describe('runtime progress phases', () => {
	it('keeps the deprecated fixed-band helper compatible without adding a fake run band', () => {
		for (const language of supportedLanguageIds) {
			expect(progressBandsForLanguage(language)).toEqual({
				load: [0, 0.2],
				prepare: [0.2, 0.99]
			});
		}
	});

	it('clamps phase values and supplies a meaningful fallback stage', () => {
		const set = vi.fn();
		const progress = phaseProgress({ set }, 0.2, 0.8, 'Preparing program');

		progress?.set?.(-1);
		progress?.set?.(0.5, 'Compiling source');
		progress?.set?.(2);

		expect(set.mock.calls).toEqual([
			[0.2, 'Preparing program'],
			[0.5, 'Compiling source'],
			[0.8, 'Preparing program']
		]);
	});

	it('preserves the capabilities of sinks wrapped with deprecated numeric bands', () => {
		const set = vi.fn();
		const report = vi.fn();
		const setOnly = phaseProgress({ set }, 0.2, 0.8);
		const reportOnly = phaseProgress({ report }, 0.2, 0.8);
		const event = {
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloading runtime'
		} as const;

		expect(setOnly?.set).toBeTypeOf('function');
		expect(setOnly?.report).toBeUndefined();
		expect(reportOnly?.set).toBeUndefined();
		expect(reportOnly?.report).toBeTypeOf('function');

		setOnly?.set?.(0.5, 'Loading');
		reportOnly?.report?.(event);
		expect(set).toHaveBeenCalledWith(0.5, 'Loading');
		expect(report).toHaveBeenCalledWith(event);
	});

	it('resets reused sinks and ignores stale or decreasing lifecycle updates', () => {
		const set = vi.fn();
		const controller = new RuntimeProgressController();
		const first = controller.begin('run-1', { set }, 'Starting first run');

		first.progress?.set?.(0.8, 'Compiling first run');
		const second = controller.begin('run-2', { set }, 'Starting second run');
		first.progress?.set?.(1, 'Late first result');
		second.progress?.set?.(0.25, 'Compiling second run');
		second.progress?.set?.(0.1, 'Stale second stage');
		first.end();
		second.progress?.set?.(0.5, 'Running second run');

		expect(controller.activeLifecycleId).toBe('run-2');
		expect(set.mock.calls).toEqual([
			[0, 'Starting first run'],
			[0.8, 'Compiling first run'],
			[0, 'Starting second run'],
			[0.25, 'Compiling second run'],
			[0.5, 'Running second run']
		]);

		second.end();
		second.end();
		second.progress?.set?.(1, 'Late second result');
		expect(controller.activeLifecycleId).toBeUndefined();
		expect(set).toHaveBeenCalledTimes(5);
	});

	it('invalidates active progress and rejects blank lifecycle IDs', () => {
		const set = vi.fn();
		const controller = new RuntimeProgressController();
		const lifecycle = controller.begin('run-1', { set });

		controller.invalidate();
		lifecycle.progress?.set?.(0.5, 'Ignored');

		expect(controller.activeLifecycleId).toBeUndefined();
		expect(set.mock.calls).toEqual([[0, 'Starting runtime']]);
		expect(() => controller.begin('   ', { set })).toThrow(
			'Progress lifecycle ID must not be blank'
		);
	});

	it('preserves legacy numeric estimates without treating completion as readiness', () => {
		const events: RuntimeProgressEvent[] = [];
		const set = vi.fn();
		const controller = new RuntimeProgressController();
		const lifecycle = controller.begin('run-1', {
			set,
			report: (event) => events.push(event)
		});

		lifecycle.progress?.set?.(0.2, 'Downloading compiler');
		lifecycle.progress?.set?.(1, 'Legacy runtime ready');

		expect(set).not.toHaveBeenCalled();
		expect(events).toEqual([
			{
				kind: 'activity',
				phase: 'starting',
				label: 'Starting runtime',
				operationId: 'run-1'
			},
			{
				kind: 'activity',
				phase: 'legacy',
				label: 'Downloading compiler',
				estimatedFraction: 0.2,
				operationId: 'run-1'
			},
			{
				kind: 'activity',
				phase: 'legacy',
				label: 'Legacy runtime ready',
				estimatedFraction: 1,
				operationId: 'run-1'
			}
		]);
	});

	it.each([
		[-1, 0],
		[0.4, 0.4],
		[2, 1],
		[Number.NaN, 0],
		[Number.POSITIVE_INFINITY, 0],
		[Number.NEGATIVE_INFINITY, 0]
	])('clamps numeric estimate %s to a finite fraction %s', (value, expected) => {
		const report = vi.fn();
		const lifecycle = new RuntimeProgressController().begin('run-1', { report });

		lifecycle.progress?.set?.(value, 'Loading runtime');

		expect(report).toHaveBeenLastCalledWith({
			kind: 'activity',
			phase: 'legacy',
			label: 'Loading runtime',
			estimatedFraction: expected,
			operationId: 'run-1'
		});
	});

	it('preserves numeric estimates through nested runtime lifecycles', () => {
		const events: RuntimeProgressEvent[] = [];
		const terminal = new RuntimeProgressController().begin('terminal-1', {
			report: (event) => events.push(event)
		});
		const runtime = new RuntimeProgressController().begin('runtime-1', terminal.progress);

		runtime.progress?.set?.(0.65, 'Compiling program');
		runtime.progress?.set?.(1, 'Compiler ready');
		runtime.progress?.report?.({ kind: 'ready', state: 'running', reason: 'started' });
		runtime.progress?.set?.(0.5, 'Late estimate');

		expect(events.slice(2)).toEqual([
			{
				kind: 'activity',
				phase: 'legacy',
				label: 'Compiling program',
				estimatedFraction: 0.65,
				operationId: 'terminal-1'
			},
			{
				kind: 'activity',
				phase: 'legacy',
				label: 'Compiler ready',
				estimatedFraction: 1,
				operationId: 'terminal-1'
			},
			{ kind: 'ready', state: 'running', reason: 'started', operationId: 'terminal-1' }
		]);
	});

	it('forwards measured activity and ignores activity after ready while preserving settlement', () => {
		const events: RuntimeProgressEvent[] = [];
		const controller = new RuntimeProgressController();
		const lifecycle = controller.begin('run-1', {
			report: (event) => events.push(event)
		});

		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 25, total: 100 }
		});
		lifecycle.progress?.report?.({ kind: 'ready', state: 'running', reason: 'started' });
		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'compiling',
			label: 'Late compiler update'
		});
		lifecycle.progress?.report?.({ kind: 'settled', outcome: 'completed' });

		expect(events).toEqual([
			{
				kind: 'activity',
				phase: 'starting',
				label: 'Starting runtime',
				operationId: 'run-1'
			},
			{
				kind: 'activity',
				phase: 'downloading',
				label: 'Downloading runtime',
				measurement: { kind: 'bytes', completed: 25, total: 100 },
				operationId: 'run-1'
			},
			{ kind: 'ready', state: 'running', reason: 'started', operationId: 'run-1' },
			{ kind: 'settled', outcome: 'completed', operationId: 'run-1' }
		]);
	});

	it('emits each lifecycle transition once and treats settlement as terminal', () => {
		const events: RuntimeProgressEvent[] = [];
		const controller = new RuntimeProgressController();
		const lifecycle = controller.begin('run-1', {
			report: (event) => events.push(event)
		});

		lifecycle.progress?.report?.({
			kind: 'ready',
			state: 'running',
			reason: 'stdout',
			label: 'Program produced output'
		});
		lifecycle.progress?.report?.({
			kind: 'ready',
			state: 'waiting-input',
			reason: 'stdin-request',
			label: 'Duplicate readiness'
		});
		lifecycle.progress?.report?.({ kind: 'settled', outcome: 'completed' });
		lifecycle.progress?.report?.({ kind: 'settled', outcome: 'failed' });
		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'starting',
			label: 'Late activity'
		});

		expect(events.slice(1)).toEqual([
			{
				kind: 'ready',
				state: 'running',
				reason: 'stdout',
				label: 'Program produced output',
				operationId: 'run-1'
			},
			{ kind: 'settled', outcome: 'completed', operationId: 'run-1' }
		]);
	});

	it.each(['completed', 'failed', 'cancelled', 'timed-out'] as const)(
		'treats a pre-ready %s result as terminal without fabricating readiness',
		(outcome) => {
			const events: RuntimeProgressEvent[] = [];
			const controller = new RuntimeProgressController();
			const lifecycle = controller.begin('run-1', {
				report: (event) => events.push(event)
			});

			lifecycle.progress?.report?.({ kind: 'settled', outcome });
			lifecycle.progress?.report?.({
				kind: 'ready',
				state: 'running',
				reason: 'result'
			});

			expect(events.slice(1)).toEqual([{ kind: 'settled', outcome, operationId: 'run-1' }]);
		}
	);

	it('owns the operation ID instead of accepting a producer-supplied correlation ID', () => {
		const events: RuntimeProgressEvent[] = [];
		const controller = new RuntimeProgressController();
		const lifecycle = controller.begin('run-1', {
			report: (event) => events.push(event)
		});

		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'starting',
			label: 'Starting program',
			operationId: 'untrusted-producer-id'
		});

		expect(events.at(-1)?.operationId).toBe('run-1');
	});

	it('rejects stale event reporters after a replacement lifecycle begins', () => {
		const events: RuntimeProgressEvent[] = [];
		const controller = new RuntimeProgressController();
		const first = controller.begin('run-1', { report: (event) => events.push(event) });
		const second = controller.begin('run-2', { report: (event) => events.push(event) });

		first.progress?.report?.({
			kind: 'ready',
			state: 'running',
			reason: 'started',
			label: 'Stale ready'
		});
		second.progress?.report?.({
			kind: 'ready',
			state: 'waiting-input',
			reason: 'stdin-request'
		});

		expect(events).toEqual([
			{
				kind: 'activity',
				phase: 'starting',
				label: 'Starting runtime',
				operationId: 'run-1'
			},
			{
				kind: 'activity',
				phase: 'starting',
				label: 'Starting runtime',
				operationId: 'run-2'
			},
			{
				kind: 'ready',
				state: 'waiting-input',
				reason: 'stdin-request',
				operationId: 'run-2'
			}
		]);
	});

	it('uses lifecycle identity, not a reused public ID, to reject stale reporters', () => {
		const events: RuntimeProgressEvent[] = [];
		const controller = new RuntimeProgressController();
		const first = controller.begin('run', { report: (event) => events.push(event) });
		const second = controller.begin('run', { report: (event) => events.push(event) });

		first.progress?.report?.({ kind: 'settled', outcome: 'completed' });
		second.progress?.report?.({
			kind: 'ready',
			state: 'running',
			reason: 'result'
		});

		expect(events.slice(2)).toEqual([
			{ kind: 'ready', state: 'running', reason: 'result', operationId: 'run' }
		]);
	});

	it('maps event reports back to numeric progress for legacy set-only sinks', () => {
		const set = vi.fn();
		const controller = new RuntimeProgressController();
		const lifecycle = controller.begin('run-1', { set });

		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 20, total: 80 }
		});
		lifecycle.progress?.report?.({
			kind: 'settled',
			outcome: 'failed',
			label: 'Runtime failed'
		});

		expect(set.mock.calls).toEqual([
			[0, 'Starting runtime'],
			[0.25, 'Downloading runtime'],
			[0.25, 'Runtime failed']
		]);
	});

	it('prefers estimates for legacy sinks and falls back to measurements or previous progress', () => {
		const set = vi.fn();
		const lifecycle = new RuntimeProgressController().begin('run-1', { set });

		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Estimated download',
			estimatedFraction: 0.2,
			measurement: { kind: 'bytes', completed: 80, total: 100 }
		});
		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'downloading',
			label: 'Measured download',
			estimatedFraction: Number.NaN,
			measurement: { kind: 'bytes', completed: 30, total: 100 }
		});
		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'verifying',
			label: 'Verifying download'
		});
		lifecycle.progress?.report?.({
			kind: 'activity',
			phase: 'starting',
			label: 'Starting program',
			estimatedFraction: 2
		});

		expect(set.mock.calls).toEqual([
			[0, 'Starting runtime'],
			[0.2, 'Estimated download'],
			[0.3, 'Measured download'],
			[0.3, 'Verifying download'],
			[1, 'Starting program']
		]);
	});
});
