import {
	CancelledError,
	ProtocolError,
	TimeoutError,
	WorkerStartupError,
	resolveExecutionLimits,
	type ExecutionLimits
} from '@wasm-idle/core';
import {
	STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
	collectStaticRuntimePreflightTransferables,
	deserializeStaticRuntimePreflightError,
	isStaticRuntimePreflightProgress,
	isStaticRuntimePreflightSerializedError,
	type StaticRuntimePreflightProgress,
	type StaticRuntimePreflightRequestMessage,
	type StaticRuntimePreflightResponseMessage,
	type StaticRuntimePreflightRuntimeId
} from '$lib/playground/staticRuntimePreflightProtocol';

export interface StaticRuntimeWorkerPreflightRequest {
	readonly runtimeId: StaticRuntimePreflightRuntimeId;
	readonly displayName: string;
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: unknown;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly reportProgress?: (progress: StaticRuntimePreflightProgress) => void;
}

interface StaticRuntimePreflightWorker {
	onmessage: ((event: MessageEvent<StaticRuntimePreflightResponseMessage>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticRuntimePreflightRequestMessage): void;
	terminate(): void;
}

const REQUEST_ID = 1;

export async function preflightStaticRuntimeAssetsInWorker<T extends object>(
	request: StaticRuntimeWorkerPreflightRequest
): Promise<T> {
	const limits = resolveExecutionLimits(request.limits);
	if (request.signal?.aborted) {
		throw new CancelledError(`${request.displayName} runtime preflight cancelled`, {
			cause: request.signal.reason,
			phase: 'asset',
			runtimeId: request.runtimeId
		});
	}

	return await new Promise<T>((resolve, reject) => {
		let worker: StaticRuntimePreflightWorker | null = null;
		let settled = false;
		const cleanup = () => {
			try {
				clearTimeout(timeout);
			} catch {
				// Cleanup cannot replace the operation outcome.
			}
			try {
				request.signal?.removeEventListener('abort', onAbort);
			} catch {
				// Caller-owned signal cleanup cannot replace the operation outcome.
			}
			if (!worker) return;
			try {
				worker.onmessage = null;
			} catch {}
			try {
				worker.onerror = null;
			} catch {}
			try {
				worker.onmessageerror = null;
			} catch {}
			try {
				worker.terminate();
			} catch {
				// The one-shot preflight worker is already detached.
			}
			worker = null;
		};
		const settle = (outcome: { readonly payload: T } | { readonly error: unknown }) => {
			if (settled) return;
			settled = true;
			cleanup();
			if ('payload' in outcome) resolve(outcome.payload);
			else reject(outcome.error);
		};
		const onAbort = () => {
			settle({
				error: new CancelledError(`${request.displayName} runtime preflight cancelled`, {
					cause: request.signal?.reason,
					phase: 'asset',
					runtimeId: request.runtimeId
				})
			});
		};
		const timeout = setTimeout(() => {
			settle({
				error: new TimeoutError(
					`${request.displayName} runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
					{
						phase: 'asset',
						runtimeId: request.runtimeId,
						timeoutMs: limits.assetTimeoutMs
					}
				)
			});
		}, limits.assetTimeoutMs);
		try {
			request.signal?.addEventListener('abort', onAbort, { once: true });
			if (request.signal?.aborted) {
				onAbort();
				return;
			}
		} catch (error) {
			settle({ error });
			return;
		}

		void import('$lib/playground/worker/staticRuntimePreflight?worker').then(
			({ default: WorkerConstructor }) => {
				if (settled) return;
				let createdWorker: StaticRuntimePreflightWorker;
				try {
					createdWorker = new WorkerConstructor() as StaticRuntimePreflightWorker;
				} catch (error) {
					settle({
						error: new WorkerStartupError(
							`${request.displayName} preflight worker failed to start`,
							{
								cause: error,
								phase: 'asset',
								runtimeId: request.runtimeId
							}
						)
					});
					return;
				}
				if (settled) {
					try {
						createdWorker.terminate();
					} catch {}
					return;
				}
				worker = createdWorker;
				const onMessage = (event: MessageEvent<StaticRuntimePreflightResponseMessage>) => {
					if (settled) return;
					const message = event.data;
					if (
						!message ||
						typeof message !== 'object' ||
						message.protocolVersion !== STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION ||
						message.requestId !== REQUEST_ID
					) {
						settle({
							error: new ProtocolError(
								`${request.displayName} preflight worker returned an invalid response`,
								{ runtimeId: request.runtimeId }
							)
						});
						return;
					}
					if (message.type === 'progress') {
						if (!isStaticRuntimePreflightProgress(message.progress)) {
							settle({
								error: new ProtocolError(
									`${request.displayName} preflight worker returned invalid progress`,
									{ runtimeId: request.runtimeId }
								)
							});
							return;
						}
						try {
							request.reportProgress?.(message.progress);
						} catch (error) {
							settle({ error });
						}
						return;
					}
					if (message.type === 'error') {
						settle({
							error: isStaticRuntimePreflightSerializedError(message.error)
								? deserializeStaticRuntimePreflightError(
										message.error,
										request.runtimeId
									)
								: new ProtocolError(
										`${request.displayName} preflight worker returned an invalid error`,
										{ runtimeId: request.runtimeId }
									)
						});
						return;
					}
					if (message.type !== 'result') {
						settle({
							error: new ProtocolError(
								`${request.displayName} preflight worker returned an unknown response`,
								{ runtimeId: request.runtimeId }
							)
						});
						return;
					}
					try {
						collectStaticRuntimePreflightTransferables(message.payload);
						settle({ payload: Object.freeze(message.payload) as T });
					} catch (error) {
						settle({
							error: new ProtocolError(
								`${request.displayName} preflight worker returned an invalid payload`,
								{ cause: error, runtimeId: request.runtimeId }
							)
						});
					}
				};
				const onError = (event: ErrorEvent) => {
					try {
						event.preventDefault?.();
					} catch {
						// Error classification and worker cleanup still need to settle.
					}
					settle({
						error: new WorkerStartupError(
							`${request.displayName} preflight worker failed: ${event.message || 'unknown error'}`,
							{
								cause: event.error ?? event,
								phase: 'asset',
								runtimeId: request.runtimeId
							}
						)
					});
				};
				const onMessageError = (event: MessageEvent<unknown>) => {
					settle({
						error: new ProtocolError(
							`${request.displayName} preflight worker response could not be deserialized`,
							{ cause: event, runtimeId: request.runtimeId }
						)
					});
				};
				try {
					createdWorker.onmessage = onMessage;
					createdWorker.onerror = onError;
					createdWorker.onmessageerror = onMessageError;
				} catch (error) {
					settle({
						error: new WorkerStartupError(
							`${request.displayName} preflight worker handlers could not be installed`,
							{
								cause: error,
								phase: 'asset',
								runtimeId: request.runtimeId
							}
						)
					});
					return;
				}
				if (settled) return;
				try {
					createdWorker.postMessage({
						protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
						type: 'preflight',
						requestId: REQUEST_ID,
						runtimeId: request.runtimeId,
						baseUrl: request.baseUrl,
						manifestUrl: request.manifestUrl,
						profile: request.profile,
						limits
					});
				} catch (error) {
					settle({
						error: new ProtocolError(
							`${request.displayName} preflight worker request could not be sent`,
							{ cause: error, runtimeId: request.runtimeId }
						)
					});
				}
			},
			(error) => {
				settle({
					error: new WorkerStartupError(
						`${request.displayName} preflight worker bundle failed to load`,
						{
							cause: error,
							phase: 'asset',
							runtimeId: request.runtimeId
						}
					)
				});
			}
		);
	});
}
