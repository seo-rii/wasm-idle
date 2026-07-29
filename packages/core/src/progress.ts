export interface ProgressLike {
	set?: (value: number, stage?: string) => void;
}

export interface RuntimeProgressLifecycle {
	readonly lifecycleId: string;
	readonly progress?: ProgressLike;
	end(): void;
}

interface RuntimeProgressState {
	lifecycleId: string;
	lastValue: number;
}

const clampProgressValue = (value: number) =>
	Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;

export class RuntimeProgressController {
	#active: RuntimeProgressState | undefined;

	get activeLifecycleId() {
		return this.#active?.lifecycleId;
	}

	begin(
		lifecycleId: string,
		progress?: ProgressLike,
		initialStage = 'Starting runtime'
	): RuntimeProgressLifecycle {
		if (!lifecycleId.trim()) throw new TypeError('Progress lifecycle ID must not be blank');
		const state: RuntimeProgressState = { lifecycleId, lastValue: 0 };
		this.#active = state;
		try {
			progress?.set?.(0, initialStage);
		} catch (error) {
			if (this.#active === state) this.#active = undefined;
			throw error;
		}

		let ended = false;
		const scopedProgress = progress
			? Object.freeze<ProgressLike>({
					set: (value, stage) => {
						if (this.#active !== state) return;
						const clamped = clampProgressValue(value);
						if (clamped < state.lastValue) return;
						state.lastValue = clamped;
						progress.set?.(clamped, stage);
					}
				})
			: undefined;

		return Object.freeze({
			lifecycleId,
			progress: scopedProgress,
			end: () => {
				if (ended) return;
				ended = true;
				if (this.#active === state) this.#active = undefined;
			}
		});
	}

	invalidate() {
		this.#active = undefined;
	}
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
			const clamped = clampProgressValue(value);
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
