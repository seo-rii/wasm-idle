import { describe, expect, it, vi } from 'vitest';

import { supportedLanguageIds } from '../../packages/core/src/languages.js';
import {
	RuntimeProgressController,
	phaseProgress,
	progressBandsForLanguage
} from '../../packages/core/src/progress.js';

describe('runtime progress phases', () => {
	it('uses one phase contract for every supported language', () => {
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
});
