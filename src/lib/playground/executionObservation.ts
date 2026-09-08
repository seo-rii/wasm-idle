import type { ProgressLike, RuntimeProgressEvent } from '@wasm-idle/core';

export interface ExecutionObservation {
	id: number;
	language: string;
	status:
		| 'idle'
		| 'preparing'
		| 'running'
		| 'waiting-input'
		| 'paused'
		| 'completed'
		| 'failed'
		| 'cancelled'
		| 'timed-out';
	/** The legacy runner only confirms zero on success; failed/unfinished runs have no known exit code. */
	exitCode: number | null;
	startedAt: number | null;
	endedAt: number | null;
	stage: string;
	error?: string;
	events: Array<{ at: number; kind: string; stage: string }>;
}

export function createExecutionObserver() {
	let current: ExecutionObservation = {
		id: 0,
		language: '',
		status: 'idle',
		exitCode: null,
		startedAt: null,
		endedAt: null,
		stage: '',
		events: []
	};
	return {
		snapshot: (): ExecutionObservation => ({
			...current,
			events: current.events.map((event) => ({ ...event }))
		}),
		start(id: number, language: string, progress: ProgressLike): ProgressLike {
			current = {
				id,
				language,
				status: 'preparing',
				exitCode: null,
				startedAt: Date.now(),
				endedAt: null,
				stage: 'Preparing execution',
				events: []
			};
			const record = (kind: string, stage: string) => {
				if (current.id !== id || current.endedAt !== null) return;
				current.stage = stage;
				current.events.push({ at: Date.now(), kind, stage });
				if (current.events.length > 128) current.events.shift();
			};
			return {
				set(value, stage) {
					if (stage) record('legacy', stage);
					progress.set?.(value, stage);
				},
				report(event: RuntimeProgressEvent) {
					if (current.id === id && current.endedAt === null) {
						if (event.kind === 'activity') record(event.phase, event.label);
						if (event.kind === 'ready') {
							current.status = event.state;
							record(event.reason, event.label ?? event.state);
						}
					}
					progress.report?.(event);
				}
			};
		},
		finish(
			id: number,
			status: 'completed' | 'failed' | 'cancelled' | 'timed-out',
			error?: unknown
		) {
			if (current.id !== id || current.endedAt !== null) return;
			current.status = status;
			current.exitCode = status === 'completed' ? 0 : null;
			current.endedAt = Date.now();
			if (error !== undefined) current.error = String(error).slice(0, 2048);
		}
	};
}
