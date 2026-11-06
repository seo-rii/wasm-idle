import { parseWasiGccManifest } from './manifest.js';
import { compileGccWasm, snapshotGccSharedMemory } from './wasm-output.js';
import type {
	GccSharedRunOptions,
	GccSharedRunResult,
	WasiGccArtifact,
	WasiGccManifest
} from './types.js';

/** One owned cohort; cancellation invalidates results and permanently discards its memory. */
export async function runGccSharedArtifact(
	artifact: WasiGccArtifact,
	options: GccSharedRunOptions,
	manifest: WasiGccManifest
): Promise<GccSharedRunResult> {
	const started = performance.now();
	if (
		artifact?.target !== 'wasm32-wasi' ||
		artifact.format !== 'wasm-executable' ||
		!(artifact.bytes instanceof Uint8Array) ||
		artifact.atomics !== true
	)
		throw new Error('GCC shared execution requires an opted-in atomic executable artifact');
	const profile = snapshotGccSharedMemory(artifact.sharedMemory);
	const trusted = parseWasiGccManifest(manifest);
	if (
		!trusted.capabilities.atomics ||
		!trusted.capabilities.sharedMemory ||
		trusted.qualification.status !== 'verified'
	)
		throw new Error('GCC shared execution requires a qualified capable bundle');
	if (artifact.relaxedSimd !== undefined && typeof artifact.relaxedSimd !== 'boolean')
		throw new Error('Invalid GCC artifact relaxed SIMD profile');
	if (artifact.relaxedSimd && !trusted.capabilities.relaxedSimd)
		throw new Error('GCC shared relaxed SIMD requires a qualified capable bundle');
	if (artifact.tls !== undefined && typeof artifact.tls !== 'boolean')
		throw new Error('Invalid GCC artifact TLS profile');
	if (artifact.tls && !trusted.capabilities.tls)
		throw new Error('GCC shared TLS requires a qualified capable bundle');
	if (artifact.coverage !== undefined)
		throw new Error('GCC shared execution does not support coverage');
	if (
		!options ||
		typeof options !== 'object' ||
		Array.isArray(options) ||
		Object.keys(options).some(
			(key) => !['workerArguments', 'stackBytes', 'signal', 'timeoutMs'].includes(key)
		)
	)
		throw new Error('Invalid GCC shared execution options');
	const stackBytes = options.stackBytes,
		timeoutMs = options.timeoutMs ?? 30_000;
	if (
		!Number.isSafeInteger(stackBytes) ||
		stackBytes < 4096 ||
		stackBytes > 16 * 1024 * 1024 ||
		stackBytes % 16
	)
		throw new Error('GCC shared stacks must be 16-byte aligned and between 4 KiB and 16 MiB');
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
		throw new Error('Invalid GCC shared execution timeout');
	if (
		!Array.isArray(options.workerArguments) ||
		options.workerArguments.length < 1 ||
		options.workerArguments.length > 16
	)
		throw new Error('GCC shared execution requires between one and sixteen Workers');
	const argumentsByWorker = Array.from(options.workerArguments, (row) => {
		if (
			!Array.isArray(row) ||
			row.length > 64 ||
			Array.from(row).some(
				(value) => !Number.isSafeInteger(value) || value < -0x80000000 || value > 0xffffffff
			)
		)
			throw new Error('GCC shared Worker arguments must be bounded i32 values');
		return Array.from(row, (value) => value | 0);
	});
	const signal = options.signal;
	if (signal !== undefined && !(signal instanceof AbortSignal))
		throw new Error('Invalid GCC shared execution signal');
	signal?.throwIfAborted();
	if (
		globalThis.crossOriginIsolated !== true ||
		typeof SharedArrayBuffer !== 'function' ||
		typeof Worker !== 'function'
	)
		throw new Error(
			'GCC shared execution requires cross-origin isolation, SharedArrayBuffer and browser Workers'
		);
	const { module, inspection } = await compileGccWasm(artifact.bytes, 'executable', {
		atomics: true,
		relaxedSimd: artifact.relaxedSimd === true,
		tls: artifact.tls === true,
		sharedMemory: profile
	});
	signal?.throwIfAborted();
	const entry = inspection.sharedEntry!;
	if (argumentsByWorker.some((row) => row.length !== entry.parameterCount))
		throw new Error('GCC shared Worker arguments differ from the entry signature');
	const memoryBytes = profile.initialPages * 65536;
	let cursor = entry.tls?.reservedLow ?? entry.heapBase;
	const tlsRegions = entry.tls
		? argumentsByWorker.map(() => {
				const alignment = entry.tls!.alignment,
					low = Math.ceil((cursor + 16) / alignment) * alignment,
					high = low + entry.tls!.size;
				cursor = high + 16;
				return Object.freeze({ low, high, alignment });
			})
		: undefined;
	cursor = Math.ceil((cursor + 16) / 16) * 16;
	const stackRegions = argumentsByWorker.map(() => {
		const low = cursor,
			high = low + stackBytes;
		cursor = high + 32;
		return Object.freeze({ low, high });
	});
	if (cursor - 16 > (entry.tls?.reservedHigh ?? memoryBytes))
		throw new Error(
			entry.tls
				? 'GCC shared TLS reservedBytes cannot fit the Worker TLS blocks, stacks and guards'
				: 'GCC shared memory cannot fit the Worker stacks and data'
		);
	const remaining = timeoutMs - (performance.now() - started);
	if (remaining <= 0) throw new DOMException('GCC shared execution timed out', 'TimeoutError');
	let memory: WebAssembly.Memory | undefined = new WebAssembly.Memory({
		initial: profile.initialPages,
		maximum: profile.maximumPages,
		shared: true
	});
	const bytes = new Uint8Array(memory.buffer);
	const guardedRegions = [...(tlsRegions ?? []), ...stackRegions];
	for (const region of guardedRegions)
		for (const offset of [region.low - 16, region.high]) bytes.fill(0xa5, offset, offset + 16);
	const gate = new SharedArrayBuffer(4);
	return new Promise<GccSharedRunResult>((resolve, reject) => {
		const workers: Worker[] = [],
			phases: ('initializing' | 'ready' | 'done')[] = argumentsByWorker.map(
				() => 'initializing'
			);
		const values: number[] = [];
		let closed = false,
			cohortStarted = false;
		const abort = () => fail(new DOMException('GCC shared execution cancelled', 'AbortError'));
		const timer = setTimeout(
			() => fail(new DOMException('GCC shared execution timed out', 'TimeoutError')),
			remaining
		);
		function close() {
			closed = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			for (const worker of workers) {
				worker.onmessage = worker.onerror = worker.onmessageerror = null;
				worker.terminate();
			}
			// Chromium may defer physical termination. This buffer is never reused or returned on failure.
			memory = undefined;
		}
		function fail(error: unknown) {
			if (closed) return;
			close();
			reject(error);
		}
		signal?.addEventListener('abort', abort, { once: true });
		try {
			if (signal?.aborted) {
				abort();
				return;
			}
			for (const [id, args] of argumentsByWorker.entries()) {
				const worker = new Worker(new URL('./shared-worker-entry.js', import.meta.url), {
					type: 'module',
					name: `gcc-shared-${id}`
				});
				workers.push(worker);
				worker.onerror = (event) =>
					fail(new Error(`GCC shared Worker failed: ${event.message}`));
				worker.onmessageerror = () =>
					fail(new Error('GCC shared Worker returned an unreadable response'));
				worker.onmessage = ({ data }: MessageEvent) => {
					if (closed) return;
					try {
						if (
							!data ||
							data.id !== id ||
							!['ready', 'result', 'error'].includes(data.type)
						)
							throw new Error('Invalid GCC shared Worker response');
						if (data.type === 'error') {
							if (typeof data.message !== 'string')
								throw new Error('Invalid GCC shared Worker error');
							throw new Error(data.message.slice(0, 4096));
						}
						if (data.type === 'ready') {
							if (phases[id] !== 'initializing')
								throw new Error('Unexpected GCC shared Worker readiness');
							phases[id] = 'ready';
							if (phases.every((phase) => phase === 'ready')) {
								cohortStarted = true;
								Atomics.store(new Int32Array(gate), 0, 1);
								Atomics.notify(new Int32Array(gate), 0, workers.length);
							}
							return;
						}
						if (
							!cohortStarted ||
							phases[id] !== 'ready' ||
							!Number.isInteger(data.value) ||
							data.value < -0x80000000 ||
							data.value > 0x7fffffff
						)
							throw new Error('Invalid GCC shared Worker result');
						values[id] = data.value;
						phases[id] = 'done';
						if (phases.every((phase) => phase === 'done')) {
							for (const region of guardedRegions)
								for (const offset of [region.low - 16, region.high])
									if (
										!bytes
											.subarray(offset, offset + 16)
											.every((value) => value === 0xa5)
									)
										throw new Error(
											'GCC shared Worker exceeded its stack or TLS reservation'
										);
							const snapshot = Uint8Array.from(bytes);
							close();
							resolve({
								values: Object.freeze([...values]),
								memory: snapshot,
								stackRegions: Object.freeze(stackRegions),
								...(tlsRegions ? { tlsRegions: Object.freeze(tlsRegions) } : {}),
								milliseconds: performance.now() - started,
								peakMemoryBytes: memoryBytes
							});
						}
					} catch (error) {
						fail(error);
					}
				};
				worker.postMessage({
					id,
					module,
					memory,
					gate,
					entry: profile.entry,
					arguments: args,
					stackTop: stackRegions[id].high,
					heapBase: entry.heapBase,
					dataEnd: entry.dataEnd,
					...(entry.tls ? { tls: { ...entry.tls, base: tlsRegions![id].low } } : {}),
					memoryBytes,
					timeoutMs: Math.ceil(remaining)
				});
			}
		} catch (error) {
			fail(error);
		}
	});
}
