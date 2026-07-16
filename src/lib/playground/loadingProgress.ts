export const LOADING_PROGRESS_STALL_MS = 1_500;
export const LOADING_PROGRESS_EARLY_JUMP_WINDOW_MS = 2_000;
export const LOADING_PROGRESS_EARLY_JUMP_THRESHOLD = 0.8;

export interface LoadingProgressState {
	value: number;
	stage: string;
	indeterminate: boolean;
}

interface LoadingProgressControllerOptions {
	onChange: (state: LoadingProgressState) => void;
	now?: () => number;
	stallMs?: number;
	earlyJumpWindowMs?: number;
	earlyJumpThreshold?: number;
}

export interface LoadingProgressController {
	start: (stage?: string) => void;
	set: (value: number, stage?: string) => void;
	reset: () => void;
}

export function createLoadingProgressController({
	onChange,
	now = () => Date.now(),
	stallMs = LOADING_PROGRESS_STALL_MS,
	earlyJumpWindowMs = LOADING_PROGRESS_EARLY_JUMP_WINDOW_MS,
	earlyJumpThreshold = LOADING_PROGRESS_EARLY_JUMP_THRESHOLD
}: LoadingProgressControllerOptions): LoadingProgressController {
	let active = false;
	let value = -1;
	let stage = '';
	let indeterminate = false;
	let startedAt = 0;
	let stallTimer: ReturnType<typeof setTimeout> | null = null;

	const emit = () => onChange({ value, stage, indeterminate });
	const clearStallTimer = () => {
		if (stallTimer !== null) clearTimeout(stallTimer);
		stallTimer = null;
	};
	const armStallTimer = () => {
		clearStallTimer();
		stallTimer = setTimeout(() => {
			stallTimer = null;
			if (!active || value >= 1 || indeterminate) return;
			indeterminate = true;
			emit();
		}, stallMs);
	};

	const start = (nextStage = 'Loading runtime') => {
		clearStallTimer();
		active = true;
		value = 0;
		stage = nextStage;
		indeterminate = false;
		startedAt = now();
		emit();
		armStallTimer();
	};

	const set = (nextValue: number, nextStage?: string) => {
		if (!active) start(nextStage);
		const clamped = Number.isFinite(nextValue) ? Math.min(1, Math.max(0, nextValue)) : 0;
		if (clamped < value) return;

		const previousValue = value;
		const stageChanged = !!nextStage && nextStage !== stage;
		const advanced = clamped > previousValue;
		if (!advanced && !stageChanged) return;

		value = clamped;
		if (nextStage) stage = nextStage;
		if (value >= 1) {
			indeterminate = false;
			clearStallTimer();
			emit();
			return;
		}

		const earlyHighValue =
			value >= earlyJumpThreshold && now() - startedAt <= earlyJumpWindowMs;
		if (advanced) {
			indeterminate = earlyHighValue;
			emit();
			armStallTimer();
			return;
		}

		// A new label does not make an unchanged percentage measurable again.
		emit();
	};

	const reset = () => {
		clearStallTimer();
		active = false;
		value = -1;
		stage = '';
		indeterminate = false;
		emit();
	};

	return { start, set, reset };
}
