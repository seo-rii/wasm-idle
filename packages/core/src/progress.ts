import { isDeferredProgressLanguage } from './languages.js';

export interface ProgressLike {
	set?: (value: number) => void;
}

export function phaseProgress(
	progress: ProgressLike | undefined,
	start: number,
	end: number
): ProgressLike | undefined {
	if (!progress) return undefined;
	return {
		set(value: number) {
			const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
			progress.set?.(start + (end - start) * clamped);
		}
	};
}

export function progressBandsForLanguage(language: string) {
	return isDeferredProgressLanguage(language)
		? {
				load: [0, 0.05] as const,
				prepare: [0.05, 0.99] as const
			}
		: {
				load: [0, 0.85] as const,
				prepare: [0.85, 0.99] as const
			};
}
