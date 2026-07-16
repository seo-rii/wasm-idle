import { describe, expect, it, vi } from 'vitest';

import { supportedLanguageIds } from '../../packages/core/src/languages.js';
import { phaseProgress, progressBandsForLanguage } from '../../packages/core/src/progress.js';

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
});
