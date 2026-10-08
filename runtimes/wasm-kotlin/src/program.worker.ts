import { runKotlinWasiProgram } from './program.js';

// Internal probe Worker, deliberately absent from the public language registry.
const worker = self as unknown as DedicatedWorkerGlobalScope;
let started = false;
worker.onmessage = async ({ data }: MessageEvent<unknown>) => {
	// Each Worker accepts one request. Errors, traps and deadlines require a new one.
	if (started) return;
	started = true;
	try {
		if (data === null || typeof data !== 'object') throw new Error('Invalid program request');
		const request = data as Record<string, unknown>;
		if (
			Object.keys(request).some(
				(key) =>
					!['requestId', 'generation', 'bytes', 'stdin', 'maxOutputBytes'].includes(key)
			) ||
			typeof request.requestId !== 'string' ||
			!request.requestId ||
			request.requestId.length > 128 ||
			!Number.isSafeInteger(request.generation) ||
			(request.generation as number) < 0 ||
			!(request.bytes instanceof ArrayBuffer) ||
			!(request.stdin instanceof Uint8Array) ||
			!Number.isSafeInteger(request.maxOutputBytes) ||
			(request.maxOutputBytes as number) < 0 ||
			(request.maxOutputBytes as number) > 1024 * 1024
		) {
			throw new Error('Invalid program request');
		}
		const result = await runKotlinWasiProgram({
			bytes: new Uint8Array(request.bytes),
			stdin: request.stdin,
			maxProgramBytes: 8 * 1024 * 1024,
			maxStdinBytes: 8 * 1024 * 1024,
			maxOutputBytes: request.maxOutputBytes as number
		});
		worker.postMessage({
			requestId: request.requestId,
			generation: request.generation,
			result
		});
	} catch (cause) {
		worker.postMessage({ fatal: cause instanceof Error ? cause.message : String(cause) });
	}
};
