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
		report((state.clang + state.lld + state.memfs) / 3);
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
