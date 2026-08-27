export interface ExecutionPreflight {
	readonly generation: number;
	readonly signal: AbortSignal;
}

export function createExecutionPreflightGate() {
	let generation = 0;
	let activeController: AbortController | null = null;

	return {
		begin(): ExecutionPreflight {
			activeController?.abort();
			activeController = new AbortController();
			return Object.freeze({
				generation: ++generation,
				signal: activeController.signal
			});
		},
		cancel() {
			generation += 1;
			activeController?.abort();
			activeController = null;
		},
		isCurrent(preflight: ExecutionPreflight) {
			return preflight.generation === generation && !preflight.signal.aborted;
		},
		finish(preflight: ExecutionPreflight) {
			if (preflight.generation === generation) activeController = null;
		}
	};
}
