import type {
	CreateCrossGccCompilerOptions,
	CreateGccCompilerOptions,
	CrossGccCompileRequest,
	CrossGccCompileResult,
	CrossGccIdentity,
	CrossGccManifest,
	CrossGccWorker,
	WasiGccArtifact,
	WasiGccCompileRequest,
	WasiGccCompileResult,
	WasiGccIdentity,
	WasiGccManifest,
	WasiGccRunOptions,
	WasiGccRunResult,
	WasiGccWorker
} from './types.js';

type WorkerMessage =
	| {
			id: number;
			type: 'ready';
			manifest: CrossGccManifest | WasiGccManifest;
			identity: CrossGccIdentity | WasiGccIdentity;
	  }
	| { id: number; type: 'result'; result: CrossGccCompileResult | WasiGccCompileResult }
	| { id: number; type: 'run-result'; result: WasiGccRunResult }
	| { id: number; type: 'error'; message: string };

type GccWorkerOptions = Omit<CreateGccCompilerOptions, 'fetchImpl'>;
export function createGccWorker(
	options: GccWorkerOptions & { target: 'x86_64-linux-gnu' }
): Promise<CrossGccWorker>;
export function createGccWorker(
	options: GccWorkerOptions & { target: 'wasm32-wasi' }
): Promise<WasiGccWorker>;
export function createGccWorker(options: GccWorkerOptions): Promise<CrossGccWorker | WasiGccWorker>;
/** Owns a dedicated Worker. Cancellation ends compiler and guest CPU work synchronously. */
export async function createGccWorker(
	options: GccWorkerOptions
): Promise<CrossGccWorker | WasiGccWorker> {
	if (options.target !== 'x86_64-linux-gnu' && options.target !== 'wasm32-wasi')
		throw new Error('GCC requires an explicit supported output target');
	options.signal?.throwIfAborted();
	const worker = new Worker(new URL('./worker-entry.js', import.meta.url), {
		type: 'module',
		name: `gcc-${options.target}-compiler`
	});
	let disposed = false,
		busy = false,
		nextId = 0;
	const pending = new Map<
		number,
		{
			expected: WorkerMessage['type'];
			resolve(message: WorkerMessage): void;
			reject(error: unknown): void;
			cleanup(): void;
		}
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
		if (disposed) return;
		if (
			!data ||
			typeof data !== 'object' ||
			!Number.isSafeInteger(data.id) ||
			data.id < 0 ||
			!['ready', 'result', 'run-result', 'error'].includes(data.type)
		) {
			stop(new Error('GCC Worker returned an invalid response'));
			return;
		}
		const request = pending.get(data.id);
		if (!request) return;
		if (
			(data.type !== 'error' && data.type !== request.expected) ||
			(data.type === 'error' && typeof data.message !== 'string') ||
			(data.type === 'ready' && (!data.manifest || !data.identity)) ||
			((data.type === 'result' || data.type === 'run-result') &&
				(!data.result || typeof data.result !== 'object'))
		) {
			stop(new Error('GCC Worker returned an invalid response'));
			return;
		}
		pending.delete(data.id);
		request.cleanup();
		if (data.type === 'error') request.reject(new Error(data.message));
		else request.resolve(data);
	};
	worker.onerror = (event) => stop(new Error(`GCC Worker failed: ${event.message}`));
	worker.onmessageerror = () => stop(new Error('GCC Worker returned an unreadable response'));
	function send(
		message: { type: 'initialize' | 'compile' | 'run'; [key: string]: unknown },
		signal?: AbortSignal
	): Promise<WorkerMessage> {
		if (disposed) return Promise.reject(new Error('GCC Worker is disposed'));
		signal?.throwIfAborted();
		const id = nextId++;
		return new Promise((resolve, reject) => {
			const abort = () => stop(new DOMException('GCC compilation cancelled', 'AbortError'));
			const cleanup = () => signal?.removeEventListener('abort', abort);
			const expected =
				message.type === 'initialize'
					? 'ready'
					: message.type === 'compile'
						? 'result'
						: 'run-result';
			pending.set(id, { expected, resolve, reject, cleanup });
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
					target: options.target,
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
		if (ready.identity.target !== options.target)
			throw new Error('GCC Worker returned a different output target');
		const compiler = {
			manifest: ready.manifest,
			identity: ready.identity,
			async compile(
				request: CrossGccCompileRequest | WasiGccCompileRequest,
				{ signal }: { signal?: AbortSignal } = {}
			) {
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
			...(options.target === 'wasm32-wasi'
				? {
						async run(
							artifact: WasiGccArtifact,
							{
								signal,
								...runOptions
							}: WasiGccRunOptions & { signal?: AbortSignal } = {}
						) {
							if (busy) throw new Error('GCC Worker is busy');
							busy = true;
							try {
								const response = await send(
									{ type: 'run', artifact, options: runOptions },
									signal
								);
								if (response.type !== 'run-result')
									throw new Error('GCC Worker returned an invalid run response');
								return response.result;
							} finally {
								busy = false;
							}
						}
					}
				: {}),
			cancel: () => stop(new DOMException('GCC compilation cancelled', 'AbortError')),
			dispose: () => stop(new DOMException('GCC Worker disposed', 'AbortError'))
		};
		return compiler as CrossGccWorker | WasiGccWorker;
	} catch (error) {
		stop(new Error('GCC Worker initialization failed'));
		throw error;
	}
}

/** Backward-compatible GCC 13 x86 Worker API. */
export function createCrossGccWorker(
	options: Omit<CreateCrossGccCompilerOptions, 'fetchImpl'>
): Promise<CrossGccWorker> {
	return createGccWorker({ ...options, target: 'x86_64-linux-gnu' });
}
