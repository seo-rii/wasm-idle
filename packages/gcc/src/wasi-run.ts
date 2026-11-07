import {
	ConsoleStdout,
	File,
	OpenFile,
	WASI,
	wasi as wasiConstants
} from '@bjorn3/browser_wasi_shim';
import { compileGccWasm } from './wasm-output.js';
import { parseWasiGccManifest } from './manifest.js';
import { createGccWasiFilesystem } from './wasi-filesystem.js';
import type {
	WasiGccArtifact,
	WasiGccManifest,
	WasiGccRunOptions,
	WasiGccRunResult
} from './types.js';

const encoder = new TextEncoder();

/** Buffered Preview 1 stdin/stdout host; program instructions are executed by WebAssembly. */
export async function runGccWasiArtifact(
	artifact: WasiGccArtifact,
	options: WasiGccRunOptions = {},
	manifest?: WasiGccManifest
): Promise<WasiGccRunResult> {
	if (
		artifact?.target !== 'wasm32-wasi' ||
		artifact.format !== 'wasm-executable' ||
		!(artifact.bytes instanceof Uint8Array)
	)
		throw new Error('GCC run requires a linked wasm32-wasi executable artifact');
	if (artifact.sharedMemory !== undefined)
		throw new Error('GCC shared artifacts require runGccSharedArtifact');
	if (artifact.exceptions !== undefined && typeof artifact.exceptions !== 'boolean')
		throw new Error('Invalid GCC WASI artifact exception profile');
	if (artifact.exceptions === true) {
		const trusted = manifest === undefined ? undefined : parseWasiGccManifest(manifest);
		if (!trusted?.capabilities.exceptions || trusted.qualification.status !== 'verified')
			throw new Error('GCC exception execution requires a qualified capable bundle');
		if (artifact.tls || artifact.atomics || artifact.relaxedSimd || artifact.coverage)
			throw new Error('GCC exception combination is not qualified');
	}
	if (artifact.tls !== undefined && typeof artifact.tls !== 'boolean')
		throw new Error('Invalid GCC WASI artifact TLS profile');
	if (artifact.tls === true) {
		const trusted = manifest === undefined ? undefined : parseWasiGccManifest(manifest);
		if (!trusted?.capabilities.tls || trusted.qualification.status !== 'verified')
			throw new Error('GCC TLS execution requires a qualified capable bundle');
	}
	if (artifact.atomics !== undefined && typeof artifact.atomics !== 'boolean')
		throw new Error('Invalid GCC WASI artifact atomic profile');
	if (artifact.atomics === true) {
		const trusted = manifest === undefined ? undefined : parseWasiGccManifest(manifest);
		if (!trusted?.capabilities.atomics || trusted.qualification.status !== 'verified')
			throw new Error('GCC atomic execution requires a qualified capable bundle');
	}
	if (artifact.relaxedSimd !== undefined && typeof artifact.relaxedSimd !== 'boolean')
		throw new Error('Invalid GCC WASI artifact relaxed SIMD profile');
	if (artifact.relaxedSimd === true) {
		const trusted = manifest === undefined ? undefined : parseWasiGccManifest(manifest);
		if (!trusted?.capabilities.relaxedSimd || trusted.qualification.status !== 'verified')
			throw new Error('GCC WASI relaxed SIMD execution requires a qualified capable bundle');
	}
	if (
		Object.keys(options).some(
			(key) =>
				![
					'stdin',
					'args',
					'env',
					'maxOutputBytes',
					'preopens',
					'filesystemLimits'
				].includes(key)
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
	if (artifact.coverage !== undefined) {
		const coverage = artifact.coverage;
		if (
			!coverage ||
			coverage.format !== 'gcc-gcov' ||
			coverage.directory !== '/profile' ||
			!Array.isArray(coverage.dataPaths) ||
			coverage.dataPaths.length < 1 ||
			coverage.dataPaths.length > 64 ||
			Array.from(coverage.dataPaths).some(
				(path, index) => path !== `/profile/program${index ? `.${index}` : ''}.gcda`
			)
		)
			throw new Error('Invalid GCC WASI executable coverage metadata');
		if (
			!Array.isArray(options.preopens) ||
			!options.preopens.some((mount) => mount?.path === '/profile' && mount.readonly !== true)
		)
			throw new Error('GCC WASI coverage requires an exact writable /profile preopen');
		for (const name of ['GCOV_PREFIX', 'GCOV_PREFIX_STRIP'])
			if (Object.hasOwn(options.env ?? {}, name))
				throw new Error(`GCC WASI coverage does not support ${name} profile redirection`);
	}
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
	const filesystem = createGccWasiFilesystem(options.preopens, options.filesystemLimits);
	const input = new OpenFile(new File(stdin, { readonly: true }));
	// Shim 0.4.2 does not check readonly in these two allocation paths. Stdin is
	// an input snapshot, never a way for the guest to allocate unbounded host data.
	input.fd_allocate = input.fd_filestat_set_size = () => wasiConstants.ERRNO_BADF;
	const wasi = new WASI(args, env, [input, output(0), output(1), ...filesystem.fds], {
		debug: false
	});
	const { module, inspection } = await compileGccWasm(artifact.bytes, 'executable', {
		exceptions: artifact.exceptions === true,
		relaxedSimd: artifact.relaxedSimd === true,
		atomics: artifact.atomics === true,
		tls: artifact.tls === true
	});
	for (const entry of inspection.imports)
		if (
			!Object.hasOwn(wasi.wasiImport, entry.name) ||
			typeof wasi.wasiImport[entry.name] !== 'function'
		)
			throw new Error(`Unsupported WASI Preview 1 function: ${entry.name}`);
	let memory: WebAssembly.Memory;
	// The shim appends every opened fd, even after close. Reuse vacancies so an
	// open/close loop cannot grow the descriptor table beyond the live-fd limit.
	const pathOpen = wasi.wasiImport.path_open;
	wasi.wasiImport.path_open = (...args: Parameters<typeof pathOpen>) => {
		const vacant = wasi.fds.findIndex((fd) => fd === undefined);
		const ret = pathOpen(...args);
		if (ret === 0 && vacant >= 0) {
			wasi.fds[vacant] = wasi.fds.pop()!;
			new DataView(memory.buffer).setUint32(args[8], vacant, true);
		}
		return ret;
	};
	const renumber = wasi.wasiImport.fd_renumber;
	wasi.wasiImport.fd_renumber = (from: number, to: number) =>
		from === to ? (wasi.fds[from] ? 0 : wasiConstants.ERRNO_BADF) : renumber(from, to);
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
		peakMemoryBytes: memory.buffer.byteLength,
		files: filesystem.files()
	};
}
