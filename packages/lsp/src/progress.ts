const FALLBACK_PROGRESS_STEPS = [0.08, 0.26, 0.44, 0.62, 0.78, 0.9] as const;

export function isProgressValue(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function isExplicitProgress(loaded: unknown, total: unknown) {
	return isProgressValue(loaded) && isProgressValue(total) && total > 0;
}

export function progressRatio(loaded: number, total: number, max = 1) {
	return Math.max(0, Math.min(loaded / total, max));
}

function fallbackForStage(stage: string | undefined) {
	const normalized = stage?.toLowerCase().replace(/[_\s]+/gu, '-') || '';
	if (!normalized) return null;
	if (normalized === 'startup') return 0;
	if (normalized === 'ready') return 1;
	if (normalized.includes('pyodide')) return 0.35;
	if (normalized.includes('jedi')) return 0.72;
	if (normalized.includes('extract') || normalized.includes('unpack')) return 0.72;
	if (normalized.includes('diagnostic')) return 0.86;
	if (normalized.includes('manifest')) return 0.35;
	if (normalized.includes('stdlib') || normalized.includes('rootfs')) return 0.62;
	if (normalized.startsWith('load-') || normalized.startsWith('download-')) return 0.45;
	if (normalized.startsWith('preload-') || normalized.startsWith('fetch-')) return 0.35;
	return null;
}

export function nextFallbackProgress(current: number, stage?: string, max = 0.92) {
	const boundedCurrent = Math.max(0, Math.min(current, max));
	const stageFallback = fallbackForStage(stage);
	if (stageFallback !== null) {
		return Math.max(boundedCurrent, Math.min(stageFallback, max));
	}
	const nextStep =
		FALLBACK_PROGRESS_STEPS.find((step) => step > boundedCurrent) ??
		Math.min(boundedCurrent + 0.1, max);
	return Math.min(nextStep, max);
}
