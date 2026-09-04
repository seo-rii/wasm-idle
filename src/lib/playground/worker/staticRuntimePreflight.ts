import { executeStaticRuntimePreflight } from '$lib/playground/staticRuntimePreflightExecute';
import {
	STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
	collectStaticRuntimePreflightTransferables,
	serializeStaticRuntimePreflightError,
	type StaticRuntimePreflightRequestMessage,
	type StaticRuntimePreflightResponseMessage
} from '$lib/playground/staticRuntimePreflightProtocol';

interface StaticRuntimePreflightWorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void | Promise<void>) | null;
	postMessage(message: StaticRuntimePreflightResponseMessage, transfer?: Transferable[]): void;
}

const workerSelf = globalThis as unknown as StaticRuntimePreflightWorkerScope;
let handled = false;

function isRequest(value: unknown): value is StaticRuntimePreflightRequestMessage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const request = value as Record<string, unknown>;
	return (
		request.protocolVersion === STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION &&
		request.type === 'preflight' &&
		Number.isSafeInteger(request.requestId) &&
		(request.requestId as number) > 0 &&
		(request.runtimeId === 'BQN' ||
			request.runtimeId === 'CLOJURESCRIPT' ||
			request.runtimeId === 'FORTH' ||
			request.runtimeId === 'J' ||
			request.runtimeId === 'JANET' ||
			request.runtimeId === 'PROLOG') &&
		typeof request.baseUrl === 'string' &&
		typeof request.manifestUrl === 'string' &&
		request.profile !== null &&
		typeof request.profile === 'object' &&
		request.limits !== null &&
		typeof request.limits === 'object'
	);
}

workerSelf.onmessage = async (event) => {
	const request = event.data;
	if (handled || !isRequest(request)) return;
	handled = true;
	try {
		const payload = await executeStaticRuntimePreflight(request, (progress) => {
			workerSelf.postMessage({
				protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
				type: 'progress',
				requestId: request.requestId,
				progress
			});
		});
		const transferables = collectStaticRuntimePreflightTransferables(payload);
		workerSelf.postMessage(
			{
				protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
				type: 'result',
				requestId: request.requestId,
				payload
			},
			transferables
		);
	} catch (error) {
		workerSelf.postMessage({
			protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
			type: 'error',
			requestId: request.requestId,
			error: serializeStaticRuntimePreflightError(error)
		});
	}
};
