export type RuntimeProgressActivityPhase =
	| 'legacy'
	| 'resolving'
	| 'downloading'
	| 'verifying'
	| 'decompressing'
	| 'initializing'
	| 'compiling'
	| 'linking'
	| 'instantiating'
	| 'starting';

export interface RuntimeProgressMeasurement {
	kind: 'bytes';
	completed: number;
	total: number;
}

export type RuntimeProgressEvent =
	| {
			kind: 'activity';
			phase: RuntimeProgressActivityPhase;
			phaseId?: string;
			label: string;
			measurement?: RuntimeProgressMeasurement;
			/** Estimated completion from 0 to 1; reaching 1 does not imply runtime readiness. */
			estimatedFraction?: number;
			operationId?: string;
	  }
	| {
			kind: 'ready';
			state: 'running' | 'waiting-input' | 'paused';
			reason: 'started' | 'stdout' | 'stderr' | 'stdin-request' | 'debug-paused' | 'result';
			label?: string;
			operationId?: string;
	  }
	| {
			kind: 'settled';
			outcome: 'completed' | 'failed' | 'cancelled' | 'timed-out';
			label?: string;
			operationId?: string;
	  };

export interface ProgressLike {
	/** @deprecated Numeric progress has no cross-runtime unit. Prefer report(). */
	set?: (value: number, stage?: string) => void;
	report?: (event: RuntimeProgressEvent) => void;
}

export interface RuntimeProgressLifecycle {
	readonly lifecycleId: string;
	readonly progress?: ProgressLike;
	end(): void;
}

interface RuntimeProgressState {
	lifecycleId: string;
	lastValue: number;
	lastStage: string;
	ready: boolean;
	settled: boolean;
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
		const state: RuntimeProgressState = {
			lifecycleId,
			lastValue: 0,
			lastStage: initialStage,
			ready: false,
			settled: false
		};
		this.#active = state;
		try {
			if (progress?.report) {
				progress.report({
					kind: 'activity',
					phase: 'starting',
					label: initialStage,
					operationId: lifecycleId
				});
			} else {
				progress?.set?.(0, initialStage);
			}
		} catch (error) {
			if (this.#active === state) this.#active = undefined;
			throw error;
		}

		let ended = false;
		const reportToLegacySink = (event: RuntimeProgressEvent) => {
			if (!progress?.set) return;
			if (event.kind === 'activity') {
				const measurement = event.measurement;
				const value =
					typeof event.estimatedFraction === 'number' &&
					Number.isFinite(event.estimatedFraction)
						? event.estimatedFraction
						: measurement &&
							  Number.isFinite(measurement.completed) &&
							  Number.isFinite(measurement.total) &&
							  measurement.total > 0
							? measurement.completed / measurement.total
							: state.lastValue;
				const clamped = clampProgressValue(value);
				if (clamped < state.lastValue) return;
				state.lastValue = clamped;
				state.lastStage = event.label;
				progress.set(clamped, event.label);
				return;
			}
			const label = event.label || state.lastStage;
			if (event.kind === 'ready' || event.outcome === 'completed') {
				state.lastValue = 1;
				progress.set(1, label);
				return;
			}
			progress.set(state.lastValue, label);
		};

		const scopedProgress = progress
			? Object.freeze<ProgressLike>({
					set: (value, stage) => {
						if (this.#active !== state || state.ready || state.settled) return;
						const nextStage = stage || state.lastStage;
						state.lastStage = nextStage;
						if (progress.report) {
							progress.report({
								kind: 'activity',
								phase: 'legacy',
								label: nextStage,
								estimatedFraction: clampProgressValue(value),
								operationId: lifecycleId
							});
							return;
						}
						const clamped = clampProgressValue(value);
						if (clamped < state.lastValue) return;
						state.lastValue = clamped;
						progress.set?.(clamped, nextStage);
					},
					report: (event) => {
						if (this.#active !== state || state.settled) return;
						if (event.kind === 'activity') {
							if (state.ready) return;
							state.lastStage = event.label;
						} else if (event.kind === 'ready') {
							if (state.ready) return;
							state.ready = true;
							if (event.label) state.lastStage = event.label;
						} else {
							state.settled = true;
							if (event.label) state.lastStage = event.label;
						}
						if (progress.report)
							progress.report({ ...event, operationId: lifecycleId });
						else reportToLegacySink(event);
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
	const scoped: ProgressLike = {};
	if (progress.set) {
		scoped.set = (value: number, stage?: string) => {
			const clamped = clampProgressValue(value);
			progress.set?.(start + (end - start) * clamped, stage || fallbackStage);
		};
	}
	if (progress.report) {
		scoped.report = (event) => progress.report?.(event);
	}
	return Object.freeze(scoped);
}

/** @deprecated Cross-runtime fixed bands are not a truthful measure of completion. */
export function progressBandsForLanguage(_language: string) {
	return {
		load: [0, 0.2] as const,
		prepare: [0.2, 0.99] as const
	};
}
