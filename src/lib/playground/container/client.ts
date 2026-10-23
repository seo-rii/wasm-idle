import {
	CONTAINER_WORKER_PROTOCOL,
	OWNER_CLEANUP_DEADLINE_MS,
	snapshotContainerArguments,
	type ContainerWorkerCallOptions,
	type ContainerWorkerEvent,
	type ContainerWorkerInitialization,
	type ContainerWorkerRequest,
	type ContainerWorkerResponse
} from './protocol';
import { installContainerCdpRelay } from './cdp-bridge';

export interface ContainerWorkerClient {
	call<T = unknown>(
		method: string,
		args?: unknown[],
		options?: ContainerWorkerCallOptions
	): Promise<T>;
	onEvent(listener: (event: ContainerWorkerEvent) => void): () => void;
	dispose(): Promise<void>;
}
type OwnerWorker = Pick<
	Worker,
	'postMessage' | 'addEventListener' | 'removeEventListener' | 'terminate'
>;
interface ClientOptions extends ContainerWorkerInitialization {
	/** Injection is used only by deterministic transport tests. */
	workerFactory?: () => OwnerWorker;
	initializationTimeoutMs?: number;
	cleanupDeadlineMs?: number;
}

export function createContainerWorkerClient(options: ClientOptions): ContainerWorkerClient {
	const channel = crypto.randomUUID();
	const worker =
		options.workerFactory?.() ??
		new Worker(new URL('./owner.worker.ts', import.meta.url), {
			type: 'module',
			name: 'wasm-idle-container-owner'
		});
	const disposeCdpRelay = installContainerCdpRelay(worker, channel);
	const listeners = new Set<(event: ContainerWorkerEvent) => void>();
	const pending = new Map<
		number,
		{
			resolve(value: unknown): void;
			reject(error: unknown): void;
			options?: ContainerWorkerCallOptions;
			cleanup(): void;
			cancelTimer?: ReturnType<typeof setTimeout>;
		}
	>();
	let nextId = 1,
		disposed = false,
		disposal: Promise<void> | undefined;
	let retirementError: unknown;
	const cleanupDeadlineMs = options.cleanupDeadlineMs ?? OWNER_CLEANUP_DEADLINE_MS;
	const abortError = () => new DOMException('Container operation cancelled', 'AbortError');
	const post = (data: ContainerWorkerRequest) => worker.postMessage(data);
	const retire = (error: unknown) => {
		if (disposed) return;
		retirementError = error;
		disposed = true;
		disposeCdpRelay();
		worker.removeEventListener('message', message);
		worker.removeEventListener('error', crash);
		worker.removeEventListener('messageerror', crash);
		worker.terminate();
		for (const entry of pending.values()) {
			entry.cleanup();
			entry.reject(error);
		}
		pending.clear();
		listeners.clear();
	};
	const crash = (event: Event) => {
		if (event.type === 'messageerror') {
			retire(new Error('The container owner Worker message could not be decoded'));
			return;
		}
		const failure = event as ErrorEvent;
		retire(failure.error ?? new Error(failure.message || 'The container owner Worker crashed'));
	};
	const message = (event: MessageEvent<ContainerWorkerResponse>) => {
		const data = event.data;
		if (!data || data.version !== CONTAINER_WORKER_PROTOCOL || data.channel !== channel) return;
		if (data.type === 'event') {
			for (const listener of listeners) {
				try {
					listener(data.event);
				} catch (error) {
					console.error('Container UI event handler failed', error);
				}
			}
			return;
		}
		const entry = pending.get(data.id);
		if (!entry) return;
		if (data.type === 'progress') {
			try {
				if (data.progress.kind === 'set')
					entry.options?.progress?.set?.(data.progress.value, data.progress.stage);
				else entry.options?.progress?.report?.(data.progress.event);
			} catch (error) {
				console.error('Container UI progress handler failed', error);
			}
			return;
		}
		entry.cleanup();
		pending.delete(data.id);
		if (data.type === 'error') {
			const error = Object.assign(new Error(data.error.message), {
				name: data.error.name,
				code: data.error.code
			});
			entry.reject(error);
		} else entry.resolve(data.value);
	};
	worker.addEventListener('message', message as EventListener);
	worker.addEventListener('error', crash);
	worker.addEventListener('messageerror', crash);

	const initialized = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => retire(new Error('Container owner initialization timed out')),
			options.initializationTimeoutMs ?? 60_000
		);
		pending.set(0, { resolve: () => resolve(), reject, cleanup: () => clearTimeout(timer) });
		try {
			post({
				version: CONTAINER_WORKER_PROTOCOL,
				channel,
				id: 0,
				type: 'init',
				settings: snapshotContainerArguments({
					runtimeAssets: options.runtimeAssets,
					applicationRootURL: options.applicationRootURL,
					workspaceId: options.workspaceId
				})
			});
		} catch (error) {
			retire(error);
		}
	});
	void initialized.catch(() => {});

	const call = async <T>(
		method: string,
		args: unknown[] = [],
		settings: ContainerWorkerCallOptions = {}
	): Promise<T> => {
		if (disposed) throw retirementError;
		if (settings.signal?.aborted) throw abortError();
		// Snapshot before the first await; caller mutation never changes a pending request.
		const values = snapshotContainerArguments(args);
		await initialized;
		if (disposed) throw retirementError;
		if (settings.signal?.aborted) throw abortError();
		const id = nextId++;
		return await new Promise<T>((resolve, reject) => {
			const cancel = () => {
				const entry = pending.get(id);
				if (!entry || entry.cancelTimer) return;
				try {
					post({ version: CONTAINER_WORKER_PROTOCOL, channel, id, type: 'cancel' });
				} catch (error) {
					retire(error);
					return;
				}
				entry.cancelTimer = setTimeout(
					() =>
						retire(
							new Error(
								'Container owner did not finish cancellation before its cleanup deadline'
							)
						),
					cleanupDeadlineMs
				);
			};
			pending.set(id, {
				resolve: (value) =>
					settings.signal?.aborted ? reject(abortError()) : resolve(value as T),
				reject,
				options: settings,
				cleanup() {
					settings.signal?.removeEventListener('abort', cancel);
					const timer = pending.get(id)?.cancelTimer;
					if (timer) clearTimeout(timer);
				}
			});
			settings.signal?.addEventListener('abort', cancel, { once: true });
			try {
				post({
					version: CONTAINER_WORKER_PROTOCOL,
					channel,
					id,
					type: 'call',
					method,
					args: values
				});
			} catch (error) {
				const entry = pending.get(id);
				entry?.cleanup();
				pending.delete(id);
				reject(error);
			}
			if (settings.signal?.aborted) cancel();
		});
	};
	return {
		call,
		onEvent(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			return (disposal ??= (async () => {
				if (disposed) return;
				const timer = setTimeout(
					() => retire(new Error('Container owner disposal deadline expired')),
					cleanupDeadlineMs
				);
				try {
					await call('dispose');
				} catch {
					/* Retiring the Worker is the final cleanup boundary. */
				} finally {
					clearTimeout(timer);
					retire(new Error('Container owner has been disposed'));
				}
			})());
		}
	};
}
