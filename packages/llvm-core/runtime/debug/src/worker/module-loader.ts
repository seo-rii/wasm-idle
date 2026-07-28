import { SharedByteQueue } from '../shared-byte-queue.js';
import type {
	DebugSessionGeneration,
	DebugWorkerKind,
	DebugWorkerOutboundMessage,
	SharedByteQueueDescriptor
} from '../types.js';

export interface EmscriptenFileSystem {
	mkdirTree(path: string): void;
	writeFile(path: string, data: string | Uint8Array): void;
	chdir(path: string): void;
}

export interface EmscriptenDebugModule {
	FS: EmscriptenFileSystem;
	callMain(args: string[]): number | Promise<number>;
}

export type EmscriptenModuleFactory = (
	options: Record<string, unknown>
) => EmscriptenDebugModule | Promise<EmscriptenDebugModule>;

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
	// eslint-disable-next-line no-var
	var __wasmIdleDebugTransport: BrowserDebugTransportBindings | undefined;
	// eslint-disable-next-line no-var
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

export function createTransportBindings(options: {
	generation: DebugSessionGeneration;
	rspInput: SharedByteQueueDescriptor;
	rspOutput: SharedByteQueueDescriptor;
	dapInput?: SharedByteQueueDescriptor;
	dapOutput?: SharedByteQueueDescriptor;
}): BrowserDebugTransportBindings {
	return {
		generation: options.generation,
		rspInput: new SharedByteQueue(options.rspInput),
		rspOutput: new SharedByteQueue(options.rspOutput),
		...(options.dapInput ? { dapInput: new SharedByteQueue(options.dapInput) } : {}),
		...(options.dapOutput ? { dapOutput: new SharedByteQueue(options.dapOutput) } : {})
	};
}

export function mountDebugFiles(
	module: EmscriptenDebugModule,
	program: Uint8Array,
	sources: Array<{ path: string; content: string }>
) {
	module.FS.mkdirTree('/workspace');
	module.FS.writeFile('/workspace/program.wasm', program);
	for (const source of sources) {
		validateDebugSourcePath(source.path);
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
