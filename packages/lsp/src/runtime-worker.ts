export interface RuntimeWorkerDiagnosticRequest {
	workerUrl: string;
	message: Record<string, unknown>;
	timeoutMs?: number;
	timeoutMessage: string;
}

export interface RuntimeWorkerDiagnosticResult {
	error?: string;
	output?: string;
}

export function runRuntimeWorkerDiagnostics(
	request: RuntimeWorkerDiagnosticRequest
): Promise<RuntimeWorkerDiagnosticResult> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(request.workerUrl);
		let output = '';
		const timeout = setTimeout(() => {
			worker.terminate();
			reject(new Error(request.timeoutMessage));
		}, request.timeoutMs ?? 5000);
		worker.onerror = (event) => {
			clearTimeout(timeout);
			worker.terminate();
			reject(event.error || new Error(event.message || 'Runtime worker failed'));
		};
		worker.onmessage = (
			event: MessageEvent<RuntimeWorkerDiagnosticResult & { results?: boolean }>
		) => {
			if (typeof event.data?.output === 'string') {
				output += event.data.output;
				return;
			}
			if (!event.data?.results && !event.data?.error) return;
			clearTimeout(timeout);
			worker.terminate();
			resolve({ error: event.data.error, output });
		};
		worker.postMessage(request.message);
	});
}
