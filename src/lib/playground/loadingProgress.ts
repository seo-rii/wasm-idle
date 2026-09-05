import type { ProgressLike, RuntimeProgressEvent } from '@wasm-idle/core';

export interface LoadingProgressState {
	visible: boolean;
	value: number;
	stage: string;
	indeterminate: boolean;
}

interface LoadingProgressControllerOptions {
	onChange: (state: LoadingProgressState) => void;
}

export interface LoadingProgressController extends ProgressLike {
	start: (stage?: string) => ProgressLike;
	reset: () => void;
}

const hiddenState = (): LoadingProgressState => ({
	visible: false,
	value: 0,
	stage: '',
	indeterminate: false
});

// These are presentation estimates for runtimes that cannot measure a phase.
// They must never substitute for an explicit ready or settled event.
const estimatedPhaseProgress = {
	legacy: 0.05,
	resolving: 0.05,
	downloading: 0.1,
	verifying: 0.45,
	decompressing: 0.55,
	initializing: 0.65,
	compiling: 0.75,
	linking: 0.9,
	instantiating: 0.95,
	starting: 0.02
} satisfies Record<Extract<RuntimeProgressEvent, { kind: 'activity' }>['phase'], number>;

export function createLoadingProgressController({
	onChange
}: LoadingProgressControllerOptions): LoadingProgressController {
	let generation = 0;
	let active = false;
	let state = hiddenState();
	let activityPhase: string | null = null;
	let measurementTotal: number | null = null;
	let measurementValue = 0;
	let measurementPoisoned = false;
	let currentOperationId: string | null = null;
	const retiredOperationIds = new Set<string>();

	const emit = () => onChange({ ...state });
	const resetActivityPhase = () => {
		activityPhase = null;
		measurementTotal = null;
		measurementValue = 0;
		measurementPoisoned = false;
	};
	const resetOperationTracking = () => {
		currentOperationId = null;
		retiredOperationIds.clear();
	};
	const emitHidden = () => {
		active = false;
		resetActivityPhase();
		resetOperationTracking();
		state = hiddenState();
		emit();
	};
	const begin = (stage: string) => {
		active = true;
		resetActivityPhase();
		resetOperationTracking();
		state = { visible: true, value: 0, stage, indeterminate: false };
		emit();
	};
	const reportEvent = (expectedGeneration: number, event: RuntimeProgressEvent) => {
		if (!active || expectedGeneration !== generation) return;
		const operationId =
			typeof event.operationId === 'string' && event.operationId.trim()
				? event.operationId
				: null;
		if (operationId !== null) {
			if (retiredOperationIds.has(operationId)) return;
			if (currentOperationId !== operationId) {
				if (currentOperationId !== null) retiredOperationIds.add(currentOperationId);
				currentOperationId = operationId;
				resetActivityPhase();
			}
		} else if (currentOperationId !== null && event.kind !== 'settled') {
			// Unscoped page-level activity may precede the first runtime operation, while an
			// unscoped settlement closes the owning page session. Neither unscoped activity
			// nor readiness may supersede a correlated operation once it has started.
			return;
		}
		if (event.kind === 'ready' || event.kind === 'settled') {
			emitHidden();
			return;
		}

		const nextActivityPhase = `${event.operationId ?? ''}\u0000${event.phase}\u0000${event.phaseId ?? ''}`;
		if (activityPhase !== nextActivityPhase) {
			activityPhase = nextActivityPhase;
			measurementTotal = null;
			measurementValue = 0;
			measurementPoisoned = false;
		}

		const estimate =
			typeof event.estimatedFraction === 'number' && Number.isFinite(event.estimatedFraction)
				? event.estimatedFraction
				: estimatedPhaseProgress[event.phase];
		const estimatedValue = Math.min(0.99, Math.max(state.value, estimate, 0));
		const { measurement } = event;
		if (!measurement) {
			state = {
				visible: true,
				value: estimatedValue,
				stage: event.label,
				indeterminate: false
			};
			emit();
			return;
		}

		const validMeasurement =
			measurement.kind === 'bytes' &&
			Number.isSafeInteger(measurement.completed) &&
			measurement.completed >= 0 &&
			Number.isSafeInteger(measurement.total) &&
			measurement.total > 0 &&
			measurement.completed <= measurement.total;
		if (
			!validMeasurement ||
			(measurementTotal !== null && measurementTotal !== measurement.total)
		) {
			measurementPoisoned = true;
		}
		if (measurementPoisoned) {
			state = {
				visible: true,
				value: estimatedValue,
				stage: event.label,
				indeterminate: false
			};
			emit();
			return;
		}

		measurementTotal ??= measurement.total;
		measurementValue = Math.max(measurementValue, measurement.completed / measurement.total);
		state = {
			visible: true,
			value: measurementValue,
			stage: event.label,
			indeterminate: false
		};
		emit();
	};

	const setLegacyActivity = (expectedGeneration: number, value: number, stage?: string) => {
		reportEvent(expectedGeneration, {
			kind: 'activity',
			phase: 'legacy',
			label: stage || state.stage,
			estimatedFraction: value
		});
	};

	const start = (stage = 'Loading runtime') => {
		generation += 1;
		const sessionGeneration = generation;
		begin(stage);
		return Object.freeze<ProgressLike>({
			set: (value, nextStage) => setLegacyActivity(sessionGeneration, value, nextStage),
			report: (event) => reportEvent(sessionGeneration, event)
		});
	};

	const set = (value: number, stage?: string) => {
		if (!active) return;
		setLegacyActivity(generation, value, stage);
	};
	const report = (event: RuntimeProgressEvent) => {
		if (!active) return;
		reportEvent(generation, event);
	};
	const reset = () => {
		generation += 1;
		emitHidden();
	};

	return { start, set, report, reset };
}
