import type { ProgressSink } from './types.js';

export interface CombinedProgressSlots {
	clang: ProgressSink;
	lld: ProgressSink;
	memfs: ProgressSink;
}

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function createCombinedProgress(report: (value: number) => void): CombinedProgressSlots {
	const state = {
		clang: 0,
		lld: 0,
		memfs: 0
	};

	const emit = () => {
		// Runtime readiness only depends on Clang and the filesystem. The linker is deliberately
		// loaded later, in parallel with source compilation, and must not hold startup progress
		// below 100%.
		report((state.clang + state.memfs) / 2);
	};

	const createSink = (key: keyof typeof state): ProgressSink => ({
		set(value) {
			state[key] = clamp(value);
			emit();
		}
	});

	return {
		clang: createSink('clang'),
		lld: createSink('lld'),
		memfs: createSink('memfs')
	};
}
