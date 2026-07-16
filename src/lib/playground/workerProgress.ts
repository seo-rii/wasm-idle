export interface ProgressSink {
	set?: (value: number, stage?: string) => void;
}

export interface WorkerProgressPayload {
	percent?: number;
	stage?: string;
}

export function reportWorkerProgress(progress: ProgressSink | undefined, payload: unknown) {
	if (typeof payload === 'number') {
		if (Number.isFinite(payload)) progress?.set?.(Math.max(0, Math.min(payload, 1)));
		return;
	}
	if (!payload || typeof payload !== 'object') return;
	const { percent, stage } = payload as WorkerProgressPayload;
	if (typeof percent !== 'number' || !Number.isFinite(percent)) return;
	progress?.set?.(
		Math.max(0, Math.min(percent / 100, 1)),
		typeof stage === 'string' && stage ? stage : undefined
	);
}
