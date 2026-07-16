export interface ProgressLike {
	set?: (value: number, stage?: string) => void;
}

export function phaseProgress(
	progress: ProgressLike | undefined,
	start: number,
	end: number,
	fallbackStage?: string
): ProgressLike | undefined {
	if (!progress) return undefined;
	return {
		set(value: number, stage?: string) {
			const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
			progress.set?.(start + (end - start) * clamped, stage || fallbackStage);
		}
	};
}

export function progressBandsForLanguage(_language: string) {
	return {
		load: [0, 0.2] as const,
		prepare: [0.2, 0.99] as const
	};
}
