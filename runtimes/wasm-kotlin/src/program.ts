import {
	createKotlinWasiConsole,
	WASI_CONSOLE_ERRNO,
	type KotlinWasiConsoleOutput
} from './wasi.js';

/** Internal raw-Wasm execution boundary. It does not compile Kotlin source. */
export interface KotlinWasiProgramOptions {
	bytes: Uint8Array;
	stdin: Uint8Array;
	maxProgramBytes: number;
	maxStdinBytes: number;
	maxOutputBytes: number;
}

export interface KotlinWasiProgramResult extends KotlinWasiConsoleOutput {
	readonly status: 'completed' | 'runtime-error' | 'output-limit';
	readonly exitCode: number | null;
	readonly error?: string;
}

const PROGRAM_IMPORTS = new Set(['fd_read', 'fd_write', 'poll_oneoff', 'random_get']);

/**
 * Invoke only the explicit WASI command entry of a fresh instance. The caller
 * must run this inside a disposable Worker with an external deadline beginning
 * before compilation/instantiation, since even a Wasm start section can block.
 * I/O inside the start section is unsupported with an exported memory: imports
 * cannot access that memory until instantiation has returned the instance.
 * Byte limits do not impose a hard cap on linear memory, GC or the JS heap.
 */
export async function runKotlinWasiProgram(
	options: KotlinWasiProgramOptions
): Promise<KotlinWasiProgramResult> {
	if (
		!(options.bytes instanceof Uint8Array) ||
		!Number.isSafeInteger(options.maxProgramBytes) ||
		options.maxProgramBytes < 8 ||
		options.bytes.byteLength > options.maxProgramBytes
	) {
		throw new RangeError('Invalid or oversized Kotlin program bytes');
	}
	// Snapshot caller-owned bytes before any asynchronous engine work.
	const bytes = new Uint8Array(options.bytes);
	let memory: WebAssembly.Memory | undefined;
	const console = createKotlinWasiConsole({
		memory: () => {
			if (!memory) throw new Error('WASI I/O before exported memory is available');
			return memory;
		},
		stdin: options.stdin,
		maxStdinBytes: options.maxStdinBytes,
		maxOutputBytes: options.maxOutputBytes
	});
	let error: string | undefined;
	let exitCode: number | null = null;
	const random_get = (pointer: number, length: number): number => {
		if (
			![pointer, length].every(
				(value) => Number.isInteger(value) && value >= -0x8000_0000 && value <= 0xffff_ffff
			)
		)
			return WASI_CONSOLE_ERRNO.inval;
		const offset = pointer >>> 0;
		const bytes = length >>> 0;
		if (bytes > 1024 * 1024) return WASI_CONSOLE_ERRNO.inval;
		if (!memory) throw new Error('WASI random_get before exported memory is available');
		const buffer = memory.buffer;
		if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer)
			return WASI_CONSOLE_ERRNO.notsup;
		if (offset > buffer.byteLength || bytes > buffer.byteLength - offset)
			return WASI_CONSOLE_ERRNO.fault;
		if (!globalThis.crypto?.getRandomValues) return WASI_CONSOLE_ERRNO.notsup;
		for (let written = 0; written < bytes; written += 65536) {
			globalThis.crypto.getRandomValues(
				new Uint8Array(buffer, offset + written, Math.min(65536, bytes - written))
			);
		}
		return WASI_CONSOLE_ERRNO.success;
	};
	try {
		const module = await WebAssembly.compile(bytes);
		for (const entry of WebAssembly.Module.imports(module)) {
			if (
				entry.module !== 'wasi_snapshot_preview1' ||
				entry.kind !== 'function' ||
				!PROGRAM_IMPORTS.has(entry.name)
			) {
				throw new Error(`Unsupported program import: ${entry.module}.${entry.name}`);
			}
		}
		const exports = WebAssembly.Module.exports(module);
		if (!exports.some((entry) => entry.name === '_start' && entry.kind === 'function')) {
			throw new Error('Kotlin WASI command must export _start');
		}
		if (!exports.some((entry) => entry.name === 'memory' && entry.kind === 'memory')) {
			throw new Error('Kotlin WASI command must export memory');
		}
		const instance = await WebAssembly.instantiate(module, {
			wasi_snapshot_preview1: { ...console.imports.wasi_snapshot_preview1, random_get }
		});
		memory = instance.exports.memory as WebAssembly.Memory;
		const start = instance.exports._start as (...args: unknown[]) => unknown;
		if (start.length !== 0)
			throw new Error('Kotlin WASI command _start must have no parameters');
		if (start() !== undefined)
			throw new Error('Kotlin WASI command _start must not return a value');
		exitCode = 0;
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	}
	const output = console.finish();
	const status = output.outputLimitExceeded
		? 'output-limit'
		: error === undefined
			? 'completed'
			: 'runtime-error';
	return Object.freeze({
		...output,
		status,
		exitCode,
		...(error === undefined ? {} : { error })
	});
}
