import type {
	CreateCrossGccCompilerOptions,
	CrossGccCompileResult,
	CrossGccIdentity,
	CrossGccManifest,
	CrossGccPrecompileResult,
	CrossGccWorker
} from './types.js';

type WorkerMessage =
	| { id: number; type: 'ready'; manifest: CrossGccManifest; identity: CrossGccIdentity }
	| { id: number; type: 'result'; result: CrossGccCompileResult }
	| { id: number; type: 'precompiled'; result: CrossGccPrecompileResult }
	| { id: number; type: 'error'; message: string };

/** Owns a dedicated Worker. Cancellation ends its CPU work even inside synchronous main(). */
export async function createCrossGccWorker(
	options: Omit<CreateCrossGccCompilerOptions, 'fetchImpl'>
): Promise<CrossGccWorker> {
	options.signal?.throwIfAborted();
	const worker = new Worker(new URL('./worker-entry.js', import.meta.url), {
		type: 'module',
		name: 'gcc-x86-64-compiler'
	});
	let disposed = false,
		busy = false,
		nextId = 0;
	const pending = new Map<
		number,
		{ resolve(message: WorkerMessage): void; reject(error: unknown): void; cleanup(): void }
	>();
	function stop(error: Error) {
		if (disposed) return;
		disposed = true;
		worker.terminate();
		for (const request of pending.values()) {
			request.cleanup();
			request.reject(error);
		}
		pending.clear();
	}
	worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
		const request = pending.get(data.id);
		if (!request) return;
		pending.delete(data.id);
		request.cleanup();
		if (data.type === 'error') request.reject(new Error(data.message));
		else request.resolve(data);
	};
	worker.onerror = (event) => stop(new Error(`GCC Worker failed: ${event.message}`));
	worker.onmessageerror = () => stop(new Error('GCC Worker returned an unreadable response'));
	function send(message: object, signal?: AbortSignal): Promise<WorkerMessage> {
		if (disposed) return Promise.reject(new Error('GCC Worker is disposed'));
		signal?.throwIfAborted();
		const id = nextId++;
		return new Promise((resolve, reject) => {
			const abort = () => stop(new DOMException('GCC compilation cancelled', 'AbortError'));
			const cleanup = () => signal?.removeEventListener('abort', abort);
			pending.set(id, { resolve, reject, cleanup });
			signal?.addEventListener('abort', abort, { once: true });
			try {
				worker.postMessage({ ...message, id });
			} catch (error) {
				pending.delete(id);
				cleanup();
				reject(error);
			}
		});
	}
	try {
		const ready = await send(
			{
				type: 'initialize',
				options: {
					manifestUrl: options.manifestUrl.toString(),
					manifestSha256: options.manifestSha256,
					...(options.maxAssetBytes === undefined
						? {}
						: { maxAssetBytes: options.maxAssetBytes })
				}
			},
			options.signal
		);
		if (ready.type !== 'ready')
			throw new Error('GCC Worker returned an invalid initialization response');
		return {
			manifest: ready.manifest,
			identity: ready.identity,
			async compile(request, { signal } = {}) {
				if (busy) throw new Error('GCC Worker is busy');
				busy = true;
				try {
					const response = await send({ type: 'compile', request }, signal);
					if (response.type !== 'result')
						throw new Error('GCC Worker returned an invalid compile response');
					return response.result;
				} finally {
					busy = false;
				}
			},
			async precompileHeader(request = {}, { signal } = {}) {
				if (busy) throw new Error('GCC Worker is busy');
				busy = true;
				try {
					const response = await send({ type: 'precompileHeader', request }, signal);
					if (response.type !== 'precompiled')
						throw new Error('GCC Worker returned an invalid precompile response');
					return response.result;
				} finally {
					busy = false;
				}
			},
			cancel: () => stop(new DOMException('GCC compilation cancelled', 'AbortError')),
			dispose: () => stop(new DOMException('GCC Worker disposed', 'AbortError'))
		};
	} catch (error) {
		stop(new Error('GCC Worker initialization failed'));
		throw error;
	}
}
