import type { RuntimeProgressEvent } from '@wasm-idle/core';

export interface ProgressSink {
	set?: (value: number, stage?: string) => void;
	report?: (event: RuntimeProgressEvent) => void;
}

export interface WorkerNumericProgressPayload {
	percent?: number;
	stage?: string;
}

export type WorkerLifecycleProgressEvent = Extract<
	RuntimeProgressEvent,
	{ kind: 'ready' | 'settled' }
>;

export type WorkerProgressPayload = WorkerNumericProgressPayload | WorkerLifecycleProgressEvent;

const readyStates = new Set(['running', 'waiting-input', 'paused']);
const readyReasons = new Set([
	'started',
	'stdout',
	'stderr',
	'stdin-request',
	'debug-paused',
	'result'
]);
const settledOutcomes = new Set(['completed', 'failed', 'cancelled', 'timed-out']);

function optionalLabel(payload: Record<string, unknown>) {
	return typeof payload.label === 'string' && payload.label ? payload.label : undefined;
}

function normalizeLifecycleEvent(
	payload: Record<string, unknown>
): WorkerLifecycleProgressEvent | null {
	const label = optionalLabel(payload);
	if (
		payload.kind === 'ready' &&
		typeof payload.state === 'string' &&
		readyStates.has(payload.state) &&
		typeof payload.reason === 'string' &&
		readyReasons.has(payload.reason)
	) {
		return {
			kind: 'ready',
			state: payload.state as Extract<
				WorkerLifecycleProgressEvent,
				{ kind: 'ready' }
			>['state'],
			reason: payload.reason as Extract<
				WorkerLifecycleProgressEvent,
				{ kind: 'ready' }
			>['reason'],
			...(label ? { label } : {})
		};
	}
	if (
		payload.kind === 'settled' &&
		typeof payload.outcome === 'string' &&
		settledOutcomes.has(payload.outcome)
	) {
		return {
			kind: 'settled',
			outcome: payload.outcome as Extract<
				WorkerLifecycleProgressEvent,
				{ kind: 'settled' }
			>['outcome'],
			...(label ? { label } : {})
		};
	}
	return null;
}

export function reportWorkerProgress(
	progress: ProgressSink | undefined,
	payload: unknown
): WorkerLifecycleProgressEvent | undefined {
	if (typeof payload === 'number') {
		if (Number.isFinite(payload)) progress?.set?.(Math.max(0, Math.min(payload, 1)));
		return;
	}
	if (!payload || typeof payload !== 'object') return;
	const record = payload as Record<string, unknown>;
	if ('kind' in record) {
		const lifecycleEvent = normalizeLifecycleEvent(record);
		if (!lifecycleEvent) return;
		if (progress?.report) {
			progress.report(lifecycleEvent);
		} else if (lifecycleEvent.kind === 'ready' || lifecycleEvent.outcome === 'completed') {
			progress?.set?.(1, lifecycleEvent.label);
		}
		return lifecycleEvent;
	}
	const { percent, stage } = record;
	if (typeof percent !== 'number' || !Number.isFinite(percent)) return;
	progress?.set?.(
		Math.max(0, Math.min(percent / 100, 1)),
		typeof stage === 'string' && stage ? stage : undefined
	);
}

export function reportWorkerInputReady(
	progress: ProgressSink | undefined,
	label = 'Runtime ready for input'
) {
	return reportWorkerProgress(progress, {
		kind: 'ready',
		state: 'waiting-input',
		reason: 'stdin-request',
		label
	});
}
