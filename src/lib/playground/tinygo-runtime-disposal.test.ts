import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTinyGoRuntime } from '../../../runtimes/wasm-tinygo/src/runtime';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
};

type ComlinkMessage = {
	id: string;
	path?: string[];
	type: string;
};

const COMPILER_WORKER_SOURCE =
	'const __webpack_require__={p:""};__webpack_require__.p=new URL("./",self.location.href).href;__webpack_require__.b=self.location+"";async cachedLazyFile(e,r,t,n){const o=await this._cache;const r=this.readFile(`${o}/${t}`,{encoding:"binary"});this.writeFile(e,r);return void 0!==e.response?new Uint8Array(e.response||[]):intArrayFromString(e.responseText||"",!0)}persist(e){};await e.cachedLazyFile(n,...t)}e.exists("/emscripten/cache/cache.lock")';

const createDeferred = <T>(): Deferred<T> => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
};

const expectPromptDisposalRejection = async (pending: Promise<unknown>) => {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const settlement = await Promise.race([
			pending.then(
				() => ({ status: 'resolved' as const }),
				(error) => ({ error: error as unknown, status: 'rejected' as const })
			),
			new Promise<{ status: 'pending' }>((resolve) => {
				timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
			})
		]);
		expect(settlement).toMatchObject({
			error: expect.objectContaining({
				message: expect.stringContaining('disposed during compiler startup')
			}),
			status: 'rejected'
		});
	} finally {
		if (timeout) clearTimeout(timeout);
	}
};

const installMockWorker = (holdInit = false) => {
	const initStarted = createDeferred<void>();
	let pendingInit: { message: ComlinkMessage; worker: MockWorker } | null = null;
	const workers: MockWorker[] = [];
	const workerBlobs: Blob[] = [];
	let objectUrlId = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(COMPILER_WORKER_SOURCE))
	);
	vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
		workerBlobs.push(value as Blob);
		return `blob:tinygo-worker-${++objectUrlId}`;
	});
	const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

	class MockWorker {
		readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
		readonly url: string | URL;
		terminateCalls = 0;

		constructor(url: string | URL) {
			this.url = url;
			workers.push(this);
		}

		addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
			if (type === 'message') this.listeners.add(listener);
		}

		removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
			if (type === 'message') this.listeners.delete(listener);
		}

		start() {}

		postMessage(message: ComlinkMessage) {
			if (holdInit && message.type === 'APPLY' && message.path?.at(-1) === 'init') {
				pendingInit = { message, worker: this };
				initStarted.resolve();
				return;
			}
			queueMicrotask(() => this.respond(message));
		}

		respond(message: ComlinkMessage) {
			const event = {
				data: { id: message.id, type: 'RAW', value: undefined }
			} as MessageEvent<unknown>;
			for (const listener of this.listeners) listener(event);
		}

		terminate() {
			this.terminateCalls += 1;
		}
	}

	vi.stubGlobal('Worker', MockWorker);
	return {
		initStarted: initStarted.promise,
		releaseInit() {
			if (!pendingInit) throw new Error('Mock emception init has not started');
			pendingInit.worker.respond(pendingInit.message);
			pendingInit = null;
		},
		revokeObjectURL,
		workerBlobs,
		workers
	};
};

describe('TinyGo compiler runtime disposal', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('cannot create a compiler worker after disposal while resolving its URL', async () => {
		const { workers } = installMockWorker();
		const loaderStarted = createDeferred<void>();
		const loaderResult = createDeferred<string>();
		const runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			assetLoader: ({ assetPath }) => {
				expect(assetPath).toBe('vendor/emception/emception.worker.js');
				loaderStarted.resolve();
				return loaderResult.promise;
			}
		});
		const booting = runtime.boot();

		await loaderStarted.promise;
		runtime.dispose();
		try {
			await expectPromptDisposalRejection(booting);
		} finally {
			loaderResult.resolve('https://runtime.invalid/emception.worker.js');
			await booting.catch(() => undefined);
		}
		expect(workers).toHaveLength(0);
	});

	it('suppresses late compiler readiness after disposal during initialization', async () => {
		const { initStarted, releaseInit, revokeObjectURL, workers } = installMockWorker(true);
		const activity: string[] = [];
		const runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			assetLoader: () => 'https://runtime.invalid/emception.worker.js',
			onLogAppended: ({ message }) => activity.push(message)
		});
		const booting = runtime.boot();

		await initStarted;
		expect(workers).toHaveLength(1);
		runtime.dispose();
		const activityAfterDispose = activity.length;
		expect(workers[0]?.terminateCalls).toBe(1);
		expect(revokeObjectURL).toHaveBeenCalledOnce();
		await expectPromptDisposalRejection(booting);
		releaseInit();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(workers[0]?.terminateCalls).toBe(1);
		expect(activity).toHaveLength(activityAfterDispose);
	});

	it('does not republish a boot invalidated by a startup callback', async () => {
		const { workers } = installMockWorker();
		let disposeOnLock = true;
		let runtime!: ReturnType<typeof createTinyGoRuntime>;
		runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			assetLoader: () => 'https://runtime.invalid/emception.worker.js',
			onControlsLockedChange: (locked) => {
				if (locked && disposeOnLock) {
					disposeOnLock = false;
					runtime.dispose();
				}
			}
		});

		await expect(runtime.boot()).rejects.toThrow('disposed during compiler startup');
		expect(workers).toHaveLength(0);
		await expect(runtime.boot()).resolves.toBeUndefined();
		expect(workers).toHaveLength(1);
		runtime.dispose();
		expect(workers[0]?.terminateCalls).toBe(1);
	});

	it('retires a booted compiler worker when the asset byte limit changes', async () => {
		const { revokeObjectURL, workerBlobs, workers } = installMockWorker();
		const runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			assetLoader: () => 'https://runtime.invalid/emception.worker.js',
			maxAssetBytes: 8192
		});

		await runtime.boot();
		expect(workers).toHaveLength(1);
		expect(revokeObjectURL).toHaveBeenCalledOnce();
		await expect(workerBlobs[0]?.text()).resolves.toContain(
			'const __wasmIdleTinyGoCompilerAssetMaxBytes=8192;'
		);

		runtime.setMaxAssetBytes(4096);
		expect(workers[0]?.terminateCalls).toBe(1);

		await runtime.boot();
		expect(workers).toHaveLength(2);
		expect(revokeObjectURL).toHaveBeenCalledTimes(2);
		await expect(workerBlobs[1]?.text()).resolves.toContain(
			'const __wasmIdleTinyGoCompilerAssetMaxBytes=4096;'
		);
		runtime.dispose();
		expect(workers[1]?.terminateCalls).toBe(1);
	});

	it('rejects an oversized compiler worker before constructing it', async () => {
		const { workers } = installMockWorker();
		const assetLoader = vi.fn(() => 'https://runtime.invalid/emception.worker.js');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('oversized', {
						headers: { 'content-length': '9' }
					})
			)
		);
		const runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			assetLoader,
			maxAssetBytes: 8
		});

		await expect(runtime.boot()).rejects.toThrow('download size exceeds the 8 byte limit');
		expect(assetLoader).toHaveBeenCalledOnce();
		expect(workers).toHaveLength(0);
	});

	it('resolves loader-provided relative worker URLs against the browser location', async () => {
		const { workers } = installMockWorker();
		vi.stubGlobal('location', { href: 'https://app.invalid/wasm-idle/' });
		const fetchMock = vi.fn(async () => new Response(COMPILER_WORKER_SOURCE));
		vi.stubGlobal('fetch', fetchMock);
		const runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			assetLoader: () => 'assets/emception.worker.js'
		});

		await runtime.boot();
		expect(fetchMock).toHaveBeenCalledWith(
			'https://app.invalid/wasm-idle/assets/emception.worker.js',
			expect.objectContaining({ credentials: 'omit', redirect: 'error' })
		);
		expect(workers).toHaveLength(1);
		runtime.dispose();
	});

	it('cancels a stalled compiler worker download during disposal', async () => {
		const { workers } = installMockWorker();
		const readStarted = createDeferred<void>();
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							pull() {
								readStarted.resolve();
							},
							cancel() {
								cancelled = true;
							}
						})
					)
			)
		);
		const runtime = createTinyGoRuntime({
			assetBaseUrl: 'https://runtime.invalid/',
			assetLoader: () => 'https://runtime.invalid/emception.worker.js'
		});
		const booting = runtime.boot();

		await readStarted.promise;
		runtime.dispose();
		await expectPromptDisposalRejection(booting);
		expect(cancelled).toBe(true);
		expect(workers).toHaveLength(0);
	});
});
