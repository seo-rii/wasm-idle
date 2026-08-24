import type {
	TinyGoUpstreamCompileRequest,
	TinyGoUpstreamCompileResult,
	TinyGoUpstreamToolchainAssets
} from './upstream-runtime.ts';

const WASM_PAGE_BYTES = 65_536;
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00] as const;

export type TinyGoWorkerPhase =
	| 'prepare'
	| 'graph'
	| 'validate'
	| 'compile'
	| 'link'
	| 'optimize';

export interface TinyGoCompileWorkerLike {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface TinyGoDisposableCompileOptions {
	workerFactory?: () => TinyGoCompileWorkerLike;
	phaseTimeoutMs?: Partial<Record<TinyGoWorkerPhase, number>>;
	maxWasmMemoryBytes?: number;
	signal?: AbortSignal;
	onPhase?: (phase: TinyGoWorkerPhase) => void;
}

const DEFAULT_PHASE_TIMEOUT_MS: Record<TinyGoWorkerPhase, number> = {
	prepare: 300_000,
	graph: 60_000,
	validate: 30_000,
	compile: 240_000,
	link: 120_000,
	optimize: 120_000
};
const DEFAULT_MAX_WASM_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;

function readU32(bytes: Uint8Array, offset: number, label: string) {
	let value = 0;
	let shift = 0;
	for (let index = 0; index < 5 && offset < bytes.length; index += 1) {
		const byte = bytes[offset++]!;
		value |= (byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) return { value: value >>> 0, offset };
		shift += 7;
	}
	throw new Error(`${label} contains an invalid u32 LEB128`);
}

function writeU32(value: number) {
	const bytes: number[] = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
		if (value !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (value !== 0);
	return bytes;
}

function readName(bytes: Uint8Array, offset: number, label: string) {
	const length = readU32(bytes, offset, label);
	const end = length.offset + length.value;
	if (end > bytes.length) throw new Error(`${label} contains a truncated name`);
	return end;
}

function skipLimits(bytes: Uint8Array, offset: number, label: string) {
	const flags = readU32(bytes, offset, label);
	if ((flags.value & 0x04) !== 0) {
		throw new Error(`${label} uses unsupported memory64/table64 limits`);
	}
	let next = readU32(bytes, flags.offset, label).offset;
	if ((flags.value & 0x01) !== 0) next = readU32(bytes, next, label).offset;
	if ((flags.value & 0x08) !== 0) next = readU32(bytes, next, label).offset;
	return next;
}

function assertNoImportedMemory(payload: Uint8Array, label: string) {
	const count = readU32(payload, 0, label);
	let offset = count.offset;
	for (let index = 0; index < count.value; index += 1) {
		offset = readName(payload, offset, label);
		offset = readName(payload, offset, label);
		if (offset >= payload.length) throw new Error(`${label} contains a truncated import`);
		const kind = payload[offset++]!;
		switch (kind) {
			case 0:
				offset = readU32(payload, offset, label).offset;
				break;
			case 1:
				if (offset >= payload.length) throw new Error(`${label} contains a truncated table`);
				offset = skipLimits(payload, offset + 1, label);
				break;
			case 2:
				throw new Error(`${label} imports memory and cannot receive an engine-enforced cap`);
			case 3:
				offset += 2;
				break;
			case 4:
				offset = readU32(payload, offset, label).offset;
				offset = readU32(payload, offset, label).offset;
				break;
			default:
				throw new Error(`${label} contains an unsupported import kind`);
		}
		if (offset > payload.length) throw new Error(`${label} contains a truncated import`);
	}
	if (offset !== payload.length) throw new Error(`${label} import section has trailing bytes`);
}

function capMemorySection(payload: Uint8Array, maxPages: number, label: string) {
	const count = readU32(payload, 0, label);
	let offset = count.offset;
	let changed = false;
	const output: number[] = [...writeU32(count.value)];
	for (let index = 0; index < count.value; index += 1) {
		const flags = readU32(payload, offset, label);
		if ((flags.value & 0x04) !== 0 || (flags.value & 0x08) !== 0) {
			throw new Error(`${label} uses unsupported memory64 or custom-page memory`);
		}
		const minimum = readU32(payload, flags.offset, label);
		if (minimum.value > maxPages) {
			throw new Error(
				`${label} minimum memory ${minimum.value * WASM_PAGE_BYTES} exceeds the hard limit ${maxPages * WASM_PAGE_BYTES}`
			);
		}
		let next = minimum.offset;
		let maximum = maxPages;
		if ((flags.value & 0x01) !== 0) {
			const declaredMaximum = readU32(payload, next, label);
			maximum = Math.min(maximum, declaredMaximum.value);
			changed ||= declaredMaximum.value > maxPages;
			next = declaredMaximum.offset;
		} else changed = true;
		output.push(...writeU32(flags.value | 0x01), ...writeU32(minimum.value), ...writeU32(maximum));
		offset = next;
	}
	if (offset !== payload.length) throw new Error(`${label} memory section has trailing bytes`);
	return changed ? new Uint8Array(output) : payload;
}

export function capTinyGoWasmMemory(bytes: Uint8Array, maxBytes: number, label: string) {
	if (
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < WASM_PAGE_BYTES ||
		maxBytes % WASM_PAGE_BYTES !== 0 ||
		maxBytes > 4 * 1024 * 1024 * 1024
	) {
		throw new Error(`${label} memory limit must be a whole number of wasm32 pages`);
	}
	if (
		bytes.byteLength < WASM_HEADER.length ||
		WASM_HEADER.some((byte, index) => bytes[index] !== byte)
	) {
		throw new Error(`${label} does not have a WebAssembly header`);
	}
	const maxPages = maxBytes / WASM_PAGE_BYTES;
	const chunks: Uint8Array[] = [bytes.subarray(0, WASM_HEADER.length)];
	let changed = false;
	let offset: number = WASM_HEADER.length;
	while (offset < bytes.length) {
		const sectionStart = offset;
		const id = bytes[offset++]!;
		const size = readU32(bytes, offset, label);
		const payloadStart = size.offset;
		const payloadEnd = payloadStart + size.value;
		if (payloadEnd > bytes.length) throw new Error(`${label} contains a truncated section`);
		const payload = bytes.subarray(payloadStart, payloadEnd);
		if (id === 2) assertNoImportedMemory(payload, label);
		if (id === 5) {
			const capped = capMemorySection(payload, maxPages, label);
			if (capped === payload) chunks.push(bytes.subarray(sectionStart, payloadEnd));
			else {
				changed = true;
				chunks.push(new Uint8Array([id, ...writeU32(capped.byteLength), ...capped]));
			}
		} else {
			chunks.push(bytes.subarray(sectionStart, payloadEnd));
		}
		offset = payloadEnd;
	}
	if (!changed) return bytes;
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let outputOffset = 0;
	for (const chunk of chunks) {
		output.set(chunk, outputOffset);
		outputOffset += chunk.byteLength;
	}
	return output;
}

function defaultWorkerFactory(): TinyGoCompileWorkerLike {
	if (typeof Worker !== 'function') {
		throw new Error('TinyGo disposable compilation requires Web Worker support');
	}
	return new Worker(new URL('./upstream-compile-worker.ts', import.meta.url), {
		type: 'module',
		name: 'wasm-idle-tinygo-compile'
	});
}

export function compileTinyGoInDisposableWorker(
	assets: TinyGoUpstreamToolchainAssets,
	request: Omit<TinyGoUpstreamCompileRequest, 'signal' | 'onPhase'>,
	options: TinyGoDisposableCompileOptions = {}
): Promise<TinyGoUpstreamCompileResult> {
	const worker = (options.workerFactory ?? defaultWorkerFactory)();
	const phaseTimeouts = { ...DEFAULT_PHASE_TIMEOUT_MS, ...options.phaseTimeoutMs };
	const maxWasmMemoryBytes = options.maxWasmMemoryBytes ?? DEFAULT_MAX_WASM_MEMORY_BYTES;
	let phase: TinyGoWorkerPhase = 'prepare';
	let timer: ReturnType<typeof setTimeout> | undefined;
	let retired = false;
	let settled = false;
	const retire = () => {
		if (retired) return;
		retired = true;
		worker.terminate();
	};
	return new Promise<TinyGoUpstreamCompileResult>((resolve, reject) => {
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			options.signal?.removeEventListener('abort', abort);
			retire();
			callback();
		};
		const arm = (nextPhase: TinyGoWorkerPhase) => {
			phase = nextPhase;
			const timeoutMs = phaseTimeouts[phase];
			if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
				finish(() => reject(new Error(`TinyGo ${phase} phase has an invalid timeout`)));
				return;
			}
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(() => {
				finish(() =>
					reject(new Error(`TinyGo ${phase} phase exceeded ${timeoutMs} ms; compiler worker terminated`))
				);
			}, timeoutMs);
			options.onPhase?.(phase);
		};
		const abort = () => {
			finish(() => reject(options.signal?.reason ?? new Error('TinyGo compilation was aborted')));
		};
		worker.onmessage = (event) => {
			const message = event.data as
				| { type: 'phase'; phase: TinyGoWorkerPhase }
				| { type: 'result'; result: TinyGoUpstreamCompileResult }
				| { type: 'error'; error: string };
			if (message?.type === 'phase') arm(message.phase);
			else if (message?.type === 'result') finish(() => resolve(message.result));
			else if (message?.type === 'error') finish(() => reject(new Error(message.error)));
			else finish(() => reject(new Error('TinyGo compiler worker emitted an invalid message')));
		};
		worker.onerror = (event) => {
			finish(() => reject(event.error ?? new Error(event.message ?? 'TinyGo compiler worker crashed')));
		};
		if (options.signal?.aborted) {
			abort();
			return;
		}
		options.signal?.addEventListener('abort', abort, { once: true });
		arm('prepare');
		const copiedAssets = {
			...assets,
			producerReceipt: Uint8Array.from(assets.producerReceipt),
			packageGraphReceipt: Uint8Array.from(assets.packageGraphReceipt),
			compiler: Uint8Array.from(assets.compiler),
			packageGraph: Uint8Array.from(assets.packageGraph),
			rootArchive: Uint8Array.from(assets.rootArchive),
			lld: Uint8Array.from(assets.lld)
		};
		worker.postMessage(
			{ type: 'compile', assets: copiedAssets, request, maxWasmMemoryBytes },
			[
				copiedAssets.producerReceipt.buffer,
				copiedAssets.packageGraphReceipt.buffer,
				copiedAssets.compiler.buffer,
				copiedAssets.packageGraph.buffer,
				copiedAssets.rootArchive.buffer,
				copiedAssets.lld.buffer
			]
		);
	});
}
