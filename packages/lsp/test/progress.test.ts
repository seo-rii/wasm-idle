import { describe, expect, it } from 'vitest';

import { nextFallbackProgress, progressRatio } from '../src/progress.js';

describe('LSP progress fallback', () => {
	it('maps common loading stages to stable percentages', () => {
		expect(nextFallbackProgress(0, 'startup')).toBe(0);
		expect(nextFallbackProgress(0, 'load-ruby-runtime')).toBe(0.45);
		expect(nextFallbackProgress(0.45, 'load-haskell-rootfs')).toBe(0.62);
		expect(nextFallbackProgress(0.62, 'extract-haskell-rootfs')).toBe(0.72);
		expect(nextFallbackProgress(0.72, 'rustc-diagnostics')).toBe(0.86);
		expect(nextFallbackProgress(0.86, 'ready', 0.95)).toBe(0.95);
	});

	it('falls back monotonically for unknown stages', () => {
		const first = nextFallbackProgress(0, 'custom-stage');
		const second = nextFallbackProgress(first, 'custom-stage');

		expect(first).toBe(0.08);
		expect(second).toBe(0.26);
	});

	it('clamps explicit progress ratios', () => {
		expect(progressRatio(3, 6, 0.92)).toBe(0.5);
		expect(progressRatio(8, 6, 0.92)).toBe(0.92);
		expect(progressRatio(-1, 6, 0.92)).toBe(0);
	});
});
