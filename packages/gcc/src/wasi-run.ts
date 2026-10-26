import { ConsoleStdout, File, OpenFile, WASI } from '@bjorn3/browser_wasi_shim';
import { compileGccWasm } from './wasm-output.js';
import type { WasiGccArtifact, WasiGccRunOptions, WasiGccRunResult } from './types.js';

const encoder = new TextEncoder();

/** Buffered Preview 1 stdin/stdout host; program instructions are executed by WebAssembly. */
export async function runGccWasiArtifact(
	artifact: WasiGccArtifact,
	options: WasiGccRunOptions = {}
): Promise<WasiGccRunResult> {
	if (
		artifact?.target !== 'wasm32-wasi' ||
		artifact.format !== 'wasm-executable' ||
		!(artifact.bytes instanceof Uint8Array)
	)
		throw new Error('GCC run requires a linked wasm32-wasi executable artifact');
	if (
		Object.keys(options).some(
			(key) => !['stdin', 'args', 'env', 'maxOutputBytes'].includes(key)
		)
	)
		throw new Error('Unsupported GCC WASI run option');
	const limit = options.maxOutputBytes ?? 4 * 1024 * 1024;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid GCC WASI output limit');
	if (
		options.stdin !== undefined &&
		typeof options.stdin !== 'string' &&
		!(options.stdin instanceof Uint8Array)
	)
		throw new Error('Invalid GCC WASI stdin');
	if (options.args !== undefined && (!Array.isArray(options.args) || options.args.length > 1024))
		throw new Error('Invalid GCC WASI arguments');
	const args = ['program.wasm', ...(options.args ?? [])];
	if (args.some((arg) => typeof arg !== 'string' || arg.includes('\0')))
		throw new Error('Invalid GCC WASI argument text');
	if (
		options.env !== undefined &&
		(!options.env || typeof options.env !== 'object' || Array.isArray(options.env))
	)
		throw new Error('Invalid GCC WASI environment');
	const env = Object.entries(options.env ?? {}).map(([key, value]) => {
		if (!key || /[=\0]/u.test(key) || typeof value !== 'string' || value.includes('\0'))
			throw new Error('Invalid GCC WASI environment entry');
		return `${key}=${value}`;
	});
	let outputBytes = 0;
	const streams = [[], []] as Uint8Array[][];
	const output = (stream: number) =>
		new ConsoleStdout((bytes) => {
			outputBytes += bytes.length;
			if (outputBytes > limit) throw new Error('GCC WASI program exceeded its output limit');
			streams[stream].push(Uint8Array.from(bytes));
		});
	const stdin =
		typeof options.stdin === 'string'
			? encoder.encode(options.stdin)
			: Uint8Array.from(options.stdin ?? []);
	const wasi = new WASI(
		args,
		env,
		[new OpenFile(new File(stdin, { readonly: true })), output(0), output(1)],
		{ debug: false }
	);
	const { module, inspection } = await compileGccWasm(artifact.bytes, 'executable');
	for (const entry of inspection.imports)
		if (typeof wasi.wasiImport[entry.name] !== 'function')
			throw new Error(`Unsupported WASI Preview 1 function: ${entry.name}`);
	let memory: WebAssembly.Memory;
	// Shim 0.4.2 counts JS code units for argv allocation; WASI strings are UTF-8 bytes.
	wasi.wasiImport.args_sizes_get = (argc: number, size: number) => {
		const view = new DataView(memory.buffer);
		view.setUint32(argc, args.length, true);
		view.setUint32(
			size,
			args.reduce((sum, arg) => sum + encoder.encode(arg).length + 1, 0),
			true
		);
		return 0;
	};
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasi.wasiImport
	});
	memory = instance.exports.memory as WebAssembly.Memory;
	const start = performance.now();
	const exitCode = wasi.start(instance as unknown as Parameters<WASI['start']>[0]);
	function decode(chunks: Uint8Array[]) {
		const decoder = new TextDecoder();
		return (
			chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') +
			decoder.decode()
		);
	}
	return {
		exitCode,
		stdout: decode(streams[0]),
		stderr: decode(streams[1]),
		milliseconds: performance.now() - start,
		peakMemoryBytes: memory.buffer.byteLength
	};
}
