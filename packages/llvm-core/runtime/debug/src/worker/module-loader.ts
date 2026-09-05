import { assertDistinctSharedByteQueueBuffers, SharedByteQueue } from '../shared-byte-queue.js';
import type {
	DebugSessionGeneration,
	DebugWorkerKind,
	DebugWorkerOutboundMessage,
	SharedByteQueueDescriptor,
	VerifiedDebugAssetBytes
} from '../types.js';

export interface EmscriptenFileSystem {
	mkdirTree(path: string): void;
	writeFile(path: string, data: string | Uint8Array): void;
	chdir(path: string): void;
}

export interface EmscriptenDebugModule {
	FS: EmscriptenFileSystem;
	HEAPU8?: Uint8Array;
	callMain(args: string[]): number | Promise<number>;
}

export type EmscriptenModuleFactory = (
	options: Record<string, unknown>
) => EmscriptenDebugModule | Promise<EmscriptenDebugModule>;

export interface EmscriptenAssetUrls {
	js: string;
	wasm: string;
	worker: string;
	revoke(): void;
}

export interface BrowserDebugTransportBindings {
	generation: DebugSessionGeneration;
	rspInput: SharedByteQueue;
	rspOutput: SharedByteQueue;
	dapInput?: SharedByteQueue;
	dapOutput?: SharedByteQueue;
}

export interface WasmLldbSharedRingRegistry {
	protocol: 'shared-ring-v1';
	sessions: Record<
		string,
		{
			dap: {
				connectionId: number;
				rx: SharedByteQueueDescriptor;
				tx: SharedByteQueueDescriptor;
			};
			rsp: {
				connectionId: number;
				rx: SharedByteQueueDescriptor;
				tx: SharedByteQueueDescriptor;
			};
		}
	>;
}

declare global {
	// This is consumed by the Emscripten JS libraries owned by the LLDB/WAMR producers.
	var __wasmIdleDebugTransport: BrowserDebugTransportBindings | undefined;
	var wasmLldbSharedRingV1: WasmLldbSharedRingRegistry | undefined;
}

export async function loadEmscriptenModuleFactory(url: string): Promise<EmscriptenModuleFactory> {
	const namespace: unknown = await import(/* @vite-ignore */ url);
	if (!namespace || typeof namespace !== 'object') {
		throw new Error(`debug runtime module did not load from ${url}`);
	}
	const candidate = (namespace as { default?: unknown }).default;
	if (typeof candidate !== 'function') {
		throw new Error(`debug runtime module at ${url} does not export an Emscripten factory`);
	}
	return candidate as EmscriptenModuleFactory;
}

export function createEmscriptenAssetUrls(
	assets: VerifiedDebugAssetBytes,
	options: { rewritePthreadMainModuleImport?: string } = {}
): EmscriptenAssetUrls {
	for (const [value, label] of [
		[assets.js, 'debug runtime JavaScript'],
		[assets.wasm, 'debug runtime WebAssembly'],
		[assets.worker, 'debug runtime pthread worker']
	] as const) {
		if (!(value instanceof ArrayBuffer) || value.byteLength === 0) {
			throw new TypeError(`${label} must be a non-empty owned ArrayBuffer`);
		}
	}
	const { js, wasm, worker } = assets;
	const urls: string[] = [];
	try {
		const jsUrl = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
		urls.push(jsUrl);
		const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
		urls.push(wasmUrl);
		let workerSource: ArrayBuffer | string = worker;
		if (options.rewritePthreadMainModuleImport) {
			const specifier = options.rewritePthreadMainModuleImport;
			const source = new TextDecoder('utf-8', { fatal: true }).decode(worker);
			const candidates = [`import('${specifier}')`, `import("${specifier}")`];
			const matches = candidates.flatMap((candidate) => {
				const offsets: number[] = [];
				let offset = source.indexOf(candidate);
				while (offset !== -1) {
					offsets.push(offset);
					offset = source.indexOf(candidate, offset + candidate.length);
				}
				return offsets.map((offset) => ({ candidate, offset }));
			});
			if (matches.length !== 1) {
				throw new Error(
					`verified pthread worker must import ${specifier} exactly once; found ${matches.length}`
				);
			}
			const [{ candidate, offset }] = matches;
			workerSource = `${source.slice(0, offset)}import(${JSON.stringify(jsUrl)})${source.slice(
				offset + candidate.length
			)}`;
		}
		const workerUrl = URL.createObjectURL(
			new Blob([workerSource], { type: 'text/javascript' })
		);
		urls.push(workerUrl);
		let revoked = false;
		return {
			js: jsUrl,
			wasm: wasmUrl,
			worker: workerUrl,
			revoke() {
				if (revoked) return;
				revoked = true;
				for (const url of [...urls].reverse()) URL.revokeObjectURL(url);
			}
		};
	} catch (error) {
		for (const url of [...urls].reverse()) URL.revokeObjectURL(url);
		throw error;
	}
}

export function validateDebugSessionGeneration(
	generation: unknown
): asserts generation is DebugSessionGeneration {
	if (typeof generation !== 'string' || !generation || generation.includes('\0')) {
		throw new TypeError('debug worker generation must be a non-empty string without NUL bytes');
	}
}

export function createTransportBindings(options: {
	generation: DebugSessionGeneration;
	rspInput: SharedByteQueueDescriptor;
	rspOutput: SharedByteQueueDescriptor;
	dapInput?: SharedByteQueueDescriptor;
	dapOutput?: SharedByteQueueDescriptor;
}): BrowserDebugTransportBindings {
	if ((options.dapInput === undefined) !== (options.dapOutput === undefined)) {
		throw new Error('DAP input and output descriptors must be provided together');
	}
	const rspInput = new SharedByteQueue(options.rspInput);
	const rspOutput = new SharedByteQueue(options.rspOutput);
	const dapInput = options.dapInput ? new SharedByteQueue(options.dapInput) : undefined;
	const dapOutput = options.dapOutput ? new SharedByteQueue(options.dapOutput) : undefined;
	assertDistinctSharedByteQueueBuffers(
		[rspInput, rspOutput, ...(dapInput ? [dapInput] : []), ...(dapOutput ? [dapOutput] : [])],
		'debug transport channels must not reuse shared buffers'
	);
	return {
		generation: options.generation,
		rspInput,
		rspOutput,
		...(dapInput ? { dapInput } : {}),
		...(dapOutput ? { dapOutput } : {})
	};
}

export function mountDebugFiles(
	module: EmscriptenDebugModule,
	program: Uint8Array,
	sources: Array<{ path: string; content: string }>
) {
	const programValue: unknown = program;
	if (!(programValue instanceof Uint8Array)) {
		throw new TypeError('debug program must be a Uint8Array');
	}
	const sourceValues: unknown = sources;
	if (!Array.isArray(sourceValues)) {
		throw new TypeError('debug sources must be an array');
	}
	const validatedSources: Array<{ path: string; content: string }> = [];
	const sourcePaths = new Set<string>();
	for (const sourceValue of sourceValues) {
		if (typeof sourceValue !== 'object' || sourceValue === null || Array.isArray(sourceValue)) {
			throw new TypeError('debug source entry must be an object');
		}
		const source = sourceValue as Record<string, unknown>;
		if (typeof source.path !== 'string') {
			throw new TypeError('debug source path must be a string');
		}
		validateDebugSourcePath(source.path);
		if (typeof source.content !== 'string') {
			throw new TypeError(`debug source content must be a string: ${source.path}`);
		}
		if (sourcePaths.has(source.path)) {
			throw new Error(`duplicate debug source path: ${source.path}`);
		}
		sourcePaths.add(source.path);
		validatedSources.push({ path: source.path, content: source.content });
	}

	module.FS.mkdirTree('/workspace');
	module.FS.writeFile('/workspace/program.wasm', programValue);
	for (const source of validatedSources) {
		const parent = source.path.slice(0, source.path.lastIndexOf('/')) || '/workspace';
		module.FS.mkdirTree(parent);
		module.FS.writeFile(source.path, source.content);
	}
}

export function validateDebugSourcePath(path: string) {
	if (
		!path.startsWith('/workspace/') ||
		path === '/workspace/program.wasm' ||
		path.includes('\\') ||
		path.includes('\0')
	) {
		throw new Error(`invalid debug source path: ${path}`);
	}
	const segments = path.slice('/workspace/'.length).split('/');
	if (
		segments.length === 0 ||
		segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
	) {
		throw new Error(`debug source path must be canonical and under /workspace: ${path}`);
	}
}

export function createByteOutput(
	emit: (value: string) => void
): (character: number | null) => void {
	const decoder = new TextDecoder();
	let pending = '';
	let scheduled = false;
	const flush = () => {
		scheduled = false;
		if (!pending) return;
		const output = pending;
		pending = '';
		emit(output);
	};
	return (character) => {
		if (character === null) {
			pending += decoder.decode();
			flush();
			return;
		}
		pending += decoder.decode(Uint8Array.of(character), { stream: true });
		if (!scheduled) {
			scheduled = true;
			queueMicrotask(flush);
		}
	};
}

export function postWorkerMessage(
	message: DebugWorkerOutboundMessage,
	postMessageImpl: (message: DebugWorkerOutboundMessage) => void = (value) =>
		globalThis.postMessage(value)
) {
	postMessageImpl(message);
}

export function postWorkerError(
	worker: DebugWorkerKind,
	generation: DebugSessionGeneration,
	error: unknown
) {
	postWorkerMessage({
		type: 'error',
		worker,
		generation,
		message: error instanceof Error ? error.message : String(error)
	});
}

export function startLinearMemoryTelemetry(
	module: EmscriptenDebugModule,
	worker: DebugWorkerKind,
	generation: DebugSessionGeneration,
	intervalMs = 250
) {
	const descriptor = Object.getOwnPropertyDescriptor(module, 'HEAPU8');
	if (!descriptor || !('value' in descriptor) || !(descriptor.value instanceof Uint8Array)) {
		return () => undefined;
	}
	let previousBytes = 0;
	const sample = () => {
		const bytes = module.HEAPU8?.buffer.byteLength ?? 0;
		if (bytes <= previousBytes) return;
		previousBytes = bytes;
		postWorkerMessage({
			type: 'memory',
			worker,
			bytes,
			generation
		});
	};
	sample();
	const interval = setInterval(sample, intervalMs);
	return () => {
		clearInterval(interval);
		sample();
	};
}
