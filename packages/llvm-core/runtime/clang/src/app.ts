import type {
	DebugFrame,
	DebugPauseReason,
	DebugVariable,
	DebugVariableMetadata
} from './types.js';
import { bindNew } from '../../core/src/apply.js';
import type MemFS from '../../core/src/memfs.js';
import Memory from '../../core/src/memory.js';
import { getInstance } from '../../core/src/wasm.js';
import { AbortError, NotImplemented, ProcExit } from '../../core/src/error.js';
import {
	evaluateDebugExpressionWithResolver,
	parseStoredDebugValue,
	type DebugExpressionValue
} from './debug/expression.js';
import { flushQueuedStdin, readBufferedStdin } from './stdin-buffer.js';

const ESUCCESS = 0;
const ENOENT = 44;
const ENOTSUP = 58;
const WASI_RIGHT_FD_READ = 1 << 1;
const WASI_RIGHT_FD_SEEK = 1 << 2;
const WASI_RIGHT_FD_SYNC = 1 << 4;
const WASI_RIGHT_FD_TELL = 1 << 5;
const WASI_RIGHT_FD_WRITE = 1 << 6;
const WASI_RIGHT_FD_FILESTAT_GET = 1 << 21;
const WASI_RIGHT_FD_FILESTAT_SET_SIZE = 1 << 22;
const WASI_O_CREAT = 1 << 0;
const WASI_O_TRUNC = 1 << 3;
const WASI_FILETYPE_REGULAR_FILE = 4;
const WASI_SEEK_SET = 0;
const WASI_SEEK_CUR = 1;
const WASI_SEEK_END = 2;
const RAF_PROC_EXIT_CODE = 0xc0c0a;

interface DebugSession {
	buffer?: Int32Array;
	interruptBuffer?: Uint8Array;
	watchBuffer?: Int32Array;
	watchResultBuffer?: Int32Array;
	breakpoints: Set<number>;
	breakpointVersion: number;
	pauseOnEntry: boolean;
	stepArmed: boolean;
	nextLineArmed: boolean;
	stepOutArmed: boolean;
	callDepth: number;
	stepOutDepth: number;
	currentFunctionId: number;
	currentLine: number;
	resumeSkipActive: boolean;
	resumeSkipFunctionId: number;
	resumeSkipLine: number;
	nextLineFunctionId: number;
	nextLineLine: number;
	variableMetadata: Record<number, DebugVariableMetadata[]>;
	globalVariableMetadata: DebugVariableMetadata[];
	functionMetadata: Record<number, string>;
	frames: Array<{
		functionId: number;
		functionName: string;
		line: number;
		values: Map<number, string>;
	}>;
	globalValues: Map<number, string>;
	onPause?: (event: {
		type: 'pause';
		line: number;
		reason: DebugPauseReason;
		locals: DebugVariable[];
		callStack: DebugFrame[];
	}) => void;
}

interface AppInstantiationOptions {
	extraImports?: WebAssembly.Imports;
	instanceRef?: { current: WebAssembly.Instance | null };
}

export default class App {
	ready: Promise<void>;

	mem: Memory = <any>null;
	memfs: MemFS;
	instance: WebAssembly.Instance = <any>null;
	exports: any;
	trace: (message: string) => void = () => {};
	debugSession?: DebugSession;
	useJsReadOverlay = false;
	useJsSourceReadOverlay = false;

	argv: string[];
	environ: { [key: string]: string };
	handles = new Map<number, any>();
	nextHandle = 1024;
	syntheticFileHandles = new Set<number>();
	nextSyntheticInode = 1;
	syntheticInodes = new Map<string, number>();
	readFileHandles = new Map<number, { path: string; contents: Uint8Array; position: number }>();
	writeFileHandles = new Map<
		number,
		{ path: string; contents: Uint8Array; position: number; size: number }
	>();

	constructor(
		module: WebAssembly.Module,
		memfs: MemFS,
		name: string,
		...argsAndOptions: Array<string | AppInstantiationOptions>
	) {
		const lastArgument = argsAndOptions.at(-1);
		const options =
			lastArgument && typeof lastArgument === 'object'
				? (argsAndOptions.pop() as AppInstantiationOptions)
				: {};
		const args = argsAndOptions as string[];
		this.argv = [name, ...args];
		this.environ = { USER: 'wasm-clang' };
		this.memfs = memfs;
		this.useJsReadOverlay = name === 'wasm-ld' || name === 'ld.lld' || name === 'lld';
		this.useJsSourceReadOverlay = name === 'clang' || name === 'clang++' || name === 'cobc';

		const env = bindNew(
			this,
			'__wasm_idle_debug_enter',
			'__wasm_idle_debug_leave',
			'__wasm_idle_debug_line',
			'__wasm_idle_debug_value_num',
			'__wasm_idle_debug_value_bool',
			'__wasm_idle_debug_value_addr',
			'__wasm_idle_debug_value_text'
		);

		const wasi = {
			...bindNew(
				this,
				'proc_exit',
				'environ_sizes_get',
				'environ_get',
				'args_sizes_get',
				'args_get',
				'random_get',
				'clock_time_get',
				'poll_oneoff',
				'fd_filestat_set_times',
				'path_filestat_set_times',
				'sock_accept',
				'sock_recv',
				'sock_send',
				'sock_shutdown',
				'path_link',
				'path_rename'
			),
			...this.memfs.exports,
			...bindNew(
				this,
				'path_open',
				'path_filestat_get',
				'path_readlink',
				'path_unlink_file',
				'fd_fdstat_get',
				'fd_fdstat_set_flags',
				'fd_filestat_get',
				'fd_filestat_set_size',
				'fd_datasync',
				'fd_read',
				'fd_pread',
				'fd_seek',
				'fd_tell',
				'fd_write',
				'fd_close'
			)
		};

		// Rust/WASI modules import `wasi_snapshot_preview1`, while older toolchains here still use
		// `wasi_unstable`. Expose the same host under both names so either artifact shape runs.
		const extraEnv = (options.extraImports?.env || {}) as WebAssembly.ModuleImports;
		this.ready = getInstance(module, {
			...options.extraImports,
			wasi_unstable: wasi,
			wasi_snapshot_preview1: wasi,
			env: { ...extraEnv, ...env }
		}).then((instance) => {
			this.instance = instance;
			if (options.instanceRef) options.instanceRef.current = instance;
			this.exports = this.instance.exports;
			this.mem = new Memory(this.exports.memory);
			this.memfs.hostMem = this.mem;
		});
	}

	async run() {
		await this.ready;
		this.trace(
			`start(argv=${JSON.stringify(this.argv)}, exports=${JSON.stringify(
				Object.keys(this.exports || {})
			)})`
		);
		try {
			this.exports._start();
		} catch (exn: any) {
			let writeStack = true;
			if (exn instanceof ProcExit) {
				this.trace(`proc_exit(code=${exn.code})`);
				if (exn.code === RAF_PROC_EXIT_CODE) {
					this.trace('allow_rAF_after_exit');
					return true;
				}
				// Don't allow rAF unless you return the right code.
				this.trace(`disallow_rAF_after_exit(code=${exn.code})`);
				if (exn.code == 0) return false;
				writeStack = false;
			}
			if (exn instanceof NotImplemented) this.trace(`not_implemented(${exn.message})`);

			// Write error message.
			let msg = `\x1b[91mError: ${exn.message}`;
			if (writeStack) msg = msg + `\n${exn.stack}`;
			msg += '\x1b[0m\n';
			this.memfs.stdout(msg);

			// Propagate error.
			throw exn;
		}
		this.trace('start() returned without proc_exit');
	}

	proc_exit(code: number) {
		this.trace(`proc_exit_throw(code=${code})`);
		throw new ProcExit(code);
	}

	private toNumber(value: number | bigint) {
		return typeof value === 'bigint' ? Number(value) : value;
	}

	private writeU32(ptr: number, value: number) {
		this.mem.view.setUint32(ptr, value >>> 0, true);
	}

	private writeU64(ptr: number, value: number | bigint) {
		const wide = BigInt(value);
		this.mem.view.setUint32(ptr, Number(wide & 0xffffffffn), true);
		this.mem.view.setUint32(ptr + 4, Number((wide >> 32n) & 0xffffffffn), true);
	}

	private readMemfsFile(path: string) {
		const candidates = [
			path,
			path.replace(/^\/+/, ''),
			path.replace(/^\.\//, ''),
			path.replace(/^\/+/, '').replace(/^\.\//, '')
		];
		for (const candidate of candidates) {
			if (!this.memfs.hasFile(candidate)) continue;
			try {
				return Uint8Array.from(this.memfs.getFileContents(candidate));
			} catch {
				// Try the next normalized spelling.
			}
		}
		return null;
	}

	private shouldUseJsReadForPath(path: string) {
		if (this.useJsReadOverlay) return true;
		return this.useJsSourceReadOverlay;
	}

	private syntheticInodeForPath(path: string) {
		const normalized = path.replace(/^\/+/, '').replace(/^\.\//, '');
		const key = normalized || path;
		let inode = this.syntheticInodes.get(key);
		if (!inode) {
			inode = this.nextSyntheticInode++;
			this.syntheticInodes.set(key, inode);
		}
		return inode;
	}

	private copyFileToIovs(
		contents: Uint8Array,
		position: number,
		iovs: number,
		iovsLen: number,
		nread: number
	) {
		this.mem.check();
		let copied = 0;
		for (let index = 0; index < iovsLen; index += 1) {
			const buffer = this.mem.read32(iovs);
			iovs += 4;
			const length = this.mem.read32(iovs);
			iovs += 4;
			if (length <= 0) continue;
			const available = Math.max(0, contents.length - position);
			const chunkLength = Math.min(length, available);
			if (chunkLength > 0) {
				this.mem.write(buffer, contents.subarray(position, position + chunkLength));
				position += chunkLength;
				copied += chunkLength;
			}
			if (chunkLength < length) break;
		}
		this.writeU32(nread, copied);
		return { copied, position };
	}

	private writeRegularFileStat(statPtr: number, size: number, path: string) {
		this.mem.check();
		this.writeU64(statPtr, 1);
		this.writeU64(statPtr + 8, this.syntheticInodeForPath(path));
		this.mem.write8(statPtr + 16, WASI_FILETYPE_REGULAR_FILE);
		this.writeU64(statPtr + 24, 1);
		this.writeU64(statPtr + 32, size);
		this.writeU64(statPtr + 40, 0);
		this.writeU64(statPtr + 48, 0);
		this.writeU64(statPtr + 56, 0);
	}

	private seekPosition(current: number, size: number, offset: number | bigint, whence: number) {
		const numericOffset = this.toNumber(offset);
		if (whence === WASI_SEEK_SET) return Math.max(0, numericOffset);
		if (whence === WASI_SEEK_CUR) return Math.max(0, current + numericOffset);
		if (whence === WASI_SEEK_END) return Math.max(0, size + numericOffset);
		return null;
	}

	private ensureWriteCapacity(
		handle: { contents: Uint8Array; position: number; size: number },
		capacity: number
	) {
		if (handle.contents.length >= capacity) return;
		let nextCapacity = Math.max(1024, handle.contents.length);
		while (nextCapacity < capacity) nextCapacity *= 2;
		const next = new Uint8Array(nextCapacity);
		next.set(handle.contents.subarray(0, handle.size));
		handle.contents = next;
	}

	private atomicOutputTarget(path: string) {
		const match = path.match(/^(.+)-[0-9a-f]+(\.[^.]+)\.tmp$/);
		if (!match) return null;
		return `${match[1]}${match[2]}`;
	}

	private storeFileContents(path: string, contents: Uint8Array) {
		if (this.useJsReadOverlay || this.useJsSourceReadOverlay) {
			this.memfs.setFile(path, contents);
			return;
		}
		this.memfs.addFile(path, contents);
	}

	path_open(
		dirfd: number,
		dirflags: number,
		pathPtr: number,
		pathLen: number,
		oflags: number,
		fsRightsBase: number | bigint,
		fsRightsInheriting: number | bigint,
		fdflags: number,
		openedFd: number
	) {
		this.mem.check();
		const path = this.mem.readStr(pathPtr, pathLen);
		const rights = this.toNumber(fsRightsBase);
		const writesFile =
			(rights & WASI_RIGHT_FD_WRITE) !== 0 || (oflags & (WASI_O_CREAT | WASI_O_TRUNC)) !== 0;
		this.trace(
			`path_open_request(path=${JSON.stringify(path)}, rights=${rights}, oflags=${oflags}, write=${writesFile})`
		);
		const overlayReadContents =
			!writesFile && this.shouldUseJsReadForPath(path) && (rights & WASI_RIGHT_FD_READ) !== 0
				? this.readMemfsFile(path)
				: null;
		if (
			!writesFile &&
			this.shouldUseJsReadForPath(path) &&
			(rights & WASI_RIGHT_FD_READ) !== 0 &&
			!overlayReadContents
		) {
			this.trace(`path_open_read_missing(path=${JSON.stringify(path)})`);
			return ENOENT;
		}
		let result = ESUCCESS;
		let fd: number;
		if (this.useJsReadOverlay && (writesFile || overlayReadContents)) {
			fd = this.nextHandle++;
			this.syntheticFileHandles.add(fd);
			this.writeU32(openedFd, fd);
			this.trace(`path_open_overlay(fd=${fd}, path=${JSON.stringify(path)})`);
		} else {
			result = this.memfs.exports.path_open(
				dirfd,
				dirflags,
				pathPtr,
				pathLen,
				oflags,
				fsRightsBase,
				fsRightsInheriting,
				fdflags,
				openedFd
			);
			if (result !== ESUCCESS) return result;
			fd = this.mem.read32(openedFd);
		}
		if (writesFile) {
			const existing = (oflags & WASI_O_TRUNC) === 0 ? this.readMemfsFile(path) : null;
			const contents = existing ? Uint8Array.from(existing) : new Uint8Array(0);
			this.writeFileHandles.set(fd, {
				path,
				contents,
				position: 0,
				size: contents.length
			});
			this.readFileHandles.delete(fd);
			this.trace(
				`path_open_write(fd=${fd}, path=${JSON.stringify(path)}, size=${contents.length})`
			);
			return result;
		}
		if (!this.shouldUseJsReadForPath(path) || (rights & WASI_RIGHT_FD_READ) === 0) {
			return result;
		}

		const contents = overlayReadContents || this.readMemfsFile(path);
		if (!contents) return result;

		this.readFileHandles.set(fd, { path, contents, position: 0 });
		this.trace(
			`path_open_read(fd=${fd}, path=${JSON.stringify(path)}, size=${contents.length})`
		);
		return result;
	}

	path_filestat_get(
		dirfd: number,
		flags: number,
		pathPtr: number,
		pathLen: number,
		statPtr: number
	) {
		this.mem.check();
		const path = this.mem.readStr(pathPtr, pathLen);
		if (!this.shouldUseJsReadForPath(path)) {
			return this.memfs.exports.path_filestat_get(dirfd, flags, pathPtr, pathLen, statPtr);
		}

		const contents = this.readMemfsFile(path);
		if (!contents) {
			return this.memfs.exports.path_filestat_get(dirfd, flags, pathPtr, pathLen, statPtr);
		}
		this.writeRegularFileStat(statPtr, contents.length, path);
		this.trace(`path_filestat_get(path=${JSON.stringify(path)}, size=${contents.length})`);
		return ESUCCESS;
	}

	fd_fdstat_get(fd: number, fdstatPtr: number) {
		const handle = this.readFileHandles.get(fd) || this.writeFileHandles.get(fd);
		if (!handle) return this.memfs.exports.fd_fdstat_get(fd, fdstatPtr);
		const rights = this.writeFileHandles.has(fd)
			? WASI_RIGHT_FD_WRITE |
				WASI_RIGHT_FD_SEEK |
				WASI_RIGHT_FD_TELL |
				WASI_RIGHT_FD_SYNC |
				WASI_RIGHT_FD_FILESTAT_GET |
				WASI_RIGHT_FD_FILESTAT_SET_SIZE
			: WASI_RIGHT_FD_READ |
				WASI_RIGHT_FD_SEEK |
				WASI_RIGHT_FD_TELL |
				WASI_RIGHT_FD_FILESTAT_GET;

		this.mem.check();
		this.mem.write8(fdstatPtr, WASI_FILETYPE_REGULAR_FILE);
		this.mem.write8(fdstatPtr + 1, 0);
		this.mem.write8(fdstatPtr + 2, 0);
		this.mem.write8(fdstatPtr + 3, 0);
		this.writeU64(fdstatPtr + 8, rights);
		this.writeU64(fdstatPtr + 16, 0);
		this.trace(`fd_fdstat_get(fd=${fd}, path=${JSON.stringify(handle.path)})`);
		return ESUCCESS;
	}

	fd_filestat_get(fd: number, statPtr: number) {
		const writeHandle = this.writeFileHandles.get(fd);
		const readHandle = this.readFileHandles.get(fd);
		const handle = writeHandle || readHandle;
		if (!handle) return this.memfs.exports.fd_filestat_get(fd, statPtr);

		const size = writeHandle ? writeHandle.size : readHandle?.contents.length || 0;
		this.writeRegularFileStat(statPtr, size, handle.path);
		this.trace(`fd_filestat_get(fd=${fd}, path=${JSON.stringify(handle.path)}, size=${size})`);
		return ESUCCESS;
	}

	fd_filestat_set_size(fd: number, size: number | bigint) {
		const handle = this.writeFileHandles.get(fd);
		if (!handle) return this.memfs.exports.fd_filestat_set_size(fd, size);

		const nextSize = this.toNumber(size);
		this.ensureWriteCapacity(handle, nextSize);
		if (nextSize > handle.size) handle.contents.fill(0, handle.size, nextSize);
		handle.size = nextSize;
		if (handle.position > nextSize) handle.position = nextSize;
		this.trace(`fd_filestat_set_size(fd=${fd}, size=${nextSize})`);
		return ESUCCESS;
	}

	fd_read(fd: number, iovs: number, iovsLen: number, nread: number) {
		const handle = this.readFileHandles.get(fd);
		if (!handle) return this.memfs.exports.fd_read(fd, iovs, iovsLen, nread);
		const result = this.copyFileToIovs(handle.contents, handle.position, iovs, iovsLen, nread);
		handle.position = result.position;
		this.trace(`fd_read(fd=${fd}, bytes=${result.copied})`);
		return ESUCCESS;
	}

	fd_pread(fd: number, iovs: number, iovsLen: number, offset: number | bigint, nread: number) {
		const handle = this.readFileHandles.get(fd);
		if (!handle) return this.memfs.exports.fd_pread(fd, iovs, iovsLen, offset, nread);
		const result = this.copyFileToIovs(
			handle.contents,
			this.toNumber(offset),
			iovs,
			iovsLen,
			nread
		);
		this.trace(`fd_pread(fd=${fd}, offset=${this.toNumber(offset)}, bytes=${result.copied})`);
		return ESUCCESS;
	}

	fd_seek(fd: number, offset: number | bigint, whence: number, newOffset: number) {
		const writeHandle = this.writeFileHandles.get(fd);
		if (writeHandle) {
			const position = this.seekPosition(
				writeHandle.position,
				writeHandle.size,
				offset,
				whence
			);
			if (position == null) {
				return this.memfs.exports.fd_seek(fd, offset, whence, newOffset);
			}
			writeHandle.position = position;
			this.mem.check();
			this.writeU64(newOffset, writeHandle.position);
			this.trace(
				`fd_seek_write(fd=${fd}, offset=${this.toNumber(offset)}, whence=${whence})`
			);
			return ESUCCESS;
		}

		const handle = this.readFileHandles.get(fd);
		if (!handle) {
			return this.memfs.exports.fd_seek(fd, offset, whence, newOffset);
		}

		const position = this.seekPosition(handle.position, handle.contents.length, offset, whence);
		if (position == null) {
			return this.memfs.exports.fd_seek(fd, offset, whence, newOffset);
		}
		handle.position = position;
		this.mem.check();
		this.writeU64(newOffset, handle.position);
		this.trace(`fd_seek(fd=${fd}, offset=${this.toNumber(offset)}, whence=${whence})`);
		return ESUCCESS;
	}

	fd_tell(fd: number, newOffset: number) {
		const position =
			this.writeFileHandles.get(fd)?.position ?? this.readFileHandles.get(fd)?.position;
		if (position == null) {
			const fallback = this.memfs.exports.fd_tell;
			return typeof fallback === 'function' ? fallback(fd, newOffset) : ENOENT;
		}
		this.mem.check();
		this.writeU64(newOffset, position);
		this.trace(`fd_tell(fd=${fd}, offset=${position})`);
		return ESUCCESS;
	}

	fd_datasync(fd: number) {
		if (this.writeFileHandles.has(fd) || this.readFileHandles.has(fd)) return ESUCCESS;
		const fallback = this.memfs.exports.fd_datasync;
		return typeof fallback === 'function' ? fallback(fd) : ESUCCESS;
	}

	fd_fdstat_set_flags(fd: number, flags: number) {
		if (this.writeFileHandles.has(fd) || this.readFileHandles.has(fd)) return ESUCCESS;
		const fallback = this.memfs.exports.fd_fdstat_set_flags;
		return typeof fallback === 'function' ? fallback(fd, flags) : ESUCCESS;
	}

	path_readlink(
		_fd: number,
		pathPointer: number,
		pathLength: number,
		_buffer: number,
		_bufferLength: number,
		bytesUsed: number
	) {
		this.mem.check();
		this.writeU32(bytesUsed, 0);
		this.trace(
			`path_readlink(path=${JSON.stringify(this.mem.readStr(pathPointer, pathLength))})`
		);
		return ENOENT;
	}

	path_unlink_file(_fd: number, pathPointer: number, pathLength: number) {
		this.mem.check();
		const path = this.mem.readStr(pathPointer, pathLength);
		this.trace(`path_unlink_file(path=${JSON.stringify(path)})`);
		// The in-memory filesystem has no remove primitive. Build directories are unique, so
		// retaining a compiler temporary is harmless and reporting success preserves cleanup flow.
		return ESUCCESS;
	}

	fd_write(fd: number, iovs: number, iovsLen: number, nwritten: number) {
		const handle = this.writeFileHandles.get(fd);
		if (!handle) {
			return this.memfs.exports.fd_write(fd, iovs, iovsLen, nwritten);
		}

		this.mem.check();
		let copied = 0;
		for (let index = 0; index < iovsLen; index += 1) {
			const buffer = this.mem.read32(iovs);
			iovs += 4;
			const length = this.mem.read32(iovs);
			iovs += 4;
			if (length <= 0) continue;
			this.ensureWriteCapacity(handle, handle.position + length);
			handle.contents.set(new Uint8Array(this.mem.buffer, buffer, length), handle.position);
			handle.position += length;
			handle.size = Math.max(handle.size, handle.position);
			copied += length;
		}
		this.writeU32(nwritten, copied);
		this.trace(`fd_write(fd=${fd}, bytes=${copied})`);
		return ESUCCESS;
	}

	fd_close(fd: number) {
		const synthetic = this.syntheticFileHandles.delete(fd);
		if (this.readFileHandles.has(fd)) {
			this.readFileHandles.delete(fd);
			const closeResult = synthetic ? ESUCCESS : this.memfs.exports.fd_close(fd);
			this.trace(`fd_close_read(fd=${fd}, close=${closeResult})`);
			return closeResult;
		}
		const writeHandle = this.writeFileHandles.get(fd);
		if (writeHandle) {
			this.writeFileHandles.delete(fd);
			const closeResult = synthetic ? ESUCCESS : this.memfs.exports.fd_close(fd);
			const contents = writeHandle.contents.subarray(0, writeHandle.size);
			this.storeFileContents(writeHandle.path, contents);
			const target = this.atomicOutputTarget(writeHandle.path);
			if (target) this.storeFileContents(target, contents);
			this.trace(
				`fd_close_write(fd=${fd}, path=${JSON.stringify(writeHandle.path)}, size=${writeHandle.size}, close=${closeResult}, target=${JSON.stringify(target)})`
			);
			return ESUCCESS;
		}
		if (synthetic) return ESUCCESS;
		return this.memfs.exports.fd_close(fd);
	}

	debugEvaluate(expression: string) {
		const session = this.debugSession;
		if (!session) throw new Error('unavailable');
		const frame = [...session.frames]
			.reverse()
			.find((candidate) => candidate.functionId === session.currentFunctionId);
		const activeLine = session.currentLine;
		const activeLocals = [...(session.variableMetadata[session.currentFunctionId] || [])]
			.reverse()
			.filter((variable) => activeLine >= variable.fromLine && activeLine <= variable.toLine);
		const activeGlobals = [...(session.globalVariableMetadata || [])]
			.reverse()
			.filter((variable) => activeLine >= variable.fromLine && activeLine <= variable.toLine);

		return evaluateDebugExpressionWithResolver(expression, (name) => {
			const resolveArrayValue = (
				variable: DebugVariableMetadata,
				addressValue: string
			): DebugExpressionValue => {
				const dimensions = variable.dimensions?.length
					? variable.dimensions
					: variable.length
						? [variable.length]
						: [];
				const address = Number(addressValue);
				if (
					!Number.isFinite(address) ||
					address <= 0 ||
					!dimensions.length ||
					(!variable.elementKind && !variable.structFields?.length)
				) {
					throw new Error('unavailable');
				}
				this.mem?.check?.();
				const scalarSize =
					variable.structFields?.length && variable.structSize
						? variable.structSize
						: variable.elementKind === 'double'
							? 8
							: variable.elementKind === 'bool' || variable.elementKind === 'char'
								? 1
								: 4;
				const readScalar = (
					kind: NonNullable<DebugVariableMetadata['elementKind']>,
					offset: number
				): DebugExpressionValue => {
					if (kind === 'bool') return !!this.mem.read8(offset);
					if (kind === 'char') {
						const charCode = this.mem.read8(offset);
						return charCode >= 0x20 && charCode <= 0x7e
							? String.fromCharCode(charCode)
							: charCode;
					}
					if (kind === 'float') return this.mem.readFloat32(offset);
					if (kind === 'double') return this.mem.readFloat64(offset);
					return this.mem.readInt32(offset);
				};
				const buildStructValue = (baseAddress: number): DebugExpressionValue => ({
					__debugExpressionKind: 'object',
					has: (fieldName: string) =>
						!!variable.structFields?.some((field) => field.name === fieldName),
					get: (fieldName: string) => {
						const field = variable.structFields?.find(
							(candidate) => candidate.name === fieldName
						);
						if (!field) throw new Error('unavailable');
						return readScalar(field.kind, baseAddress + field.offset);
					},
					keys: () => variable.structFields?.map((field) => field.name) || []
				});
				const buildArrayValue = (
					baseAddress: number,
					remainingDimensions: number[]
				): DebugExpressionValue => ({
					__debugExpressionKind: 'array',
					length: remainingDimensions[0],
					truncated: remainingDimensions[0] > 8,
					get: (index: number) => {
						if (
							!Number.isInteger(index) ||
							index < 0 ||
							index >= remainingDimensions[0]
						) {
							throw new Error('unavailable');
						}
						if (remainingDimensions.length > 1) {
							const nestedStride =
								remainingDimensions
									.slice(1)
									.reduce((total, size) => total * size, 1) * scalarSize;
							return buildArrayValue(
								baseAddress + index * nestedStride,
								remainingDimensions.slice(1)
							);
						}
						if (variable.structFields?.length && variable.structSize) {
							return buildStructValue(baseAddress + index * variable.structSize);
						}
						if (!variable.elementKind) throw new Error('unavailable');
						return readScalar(variable.elementKind, baseAddress + index * scalarSize);
					},
					keys: () =>
						Array.from(
							{ length: Math.min(remainingDimensions[0], 8) },
							(_, index) => index
						)
				});
				return buildArrayValue(address, dimensions);
			};
			const resolveVariableValue = (
				variable: DebugVariableMetadata,
				storedValue: string | undefined
			): DebugExpressionValue => {
				if (storedValue == null || storedValue === '?') throw new Error('unavailable');
				if (variable.kind === 'array') return resolveArrayValue(variable, storedValue);
				return parseStoredDebugValue(storedValue);
			};
			const localVariable = activeLocals.find((variable) => variable.name === name);
			if (localVariable) {
				return resolveVariableValue(localVariable, frame?.values.get(localVariable.slot));
			}
			const globalVariable = activeGlobals.find((variable) => variable.name === name);
			if (globalVariable) {
				return resolveVariableValue(
					globalVariable,
					session.globalValues.get(globalVariable.slot)
				);
			}
			throw new Error('unavailable');
		});
	}

	private pauseDebugSession(
		session: DebugSession,
		functionId: number,
		line: number,
		reason: DebugPauseReason
	) {
		const buffer = session.buffer;
		if (!buffer) return ESUCCESS;
		session.currentFunctionId = functionId;
		session.currentLine = line;
		const frame = [...session.frames]
			.reverse()
			.find((candidate) => candidate.functionId === functionId);
		if (frame) frame.line = line;
		session.pauseOnEntry = false;
		session.stepArmed = false;
		session.nextLineArmed = false;
		session.stepOutArmed = false;
		this.trace(`pause(function=${functionId}, line=${line}, reason=${reason})`);
		const locals =
			session.variableMetadata[functionId]?.flatMap((variable) => {
				if (line < variable.fromLine || line > variable.toLine) return [];
				if (variable.kind === 'array') {
					this.mem?.check?.();
					const address = Number(frame?.values.get(variable.slot) ?? Number.NaN);
					const dimensions = variable.dimensions?.length
						? variable.dimensions
						: variable.length
							? [variable.length]
							: [];
					if (
						!Number.isFinite(address) ||
						address <= 0 ||
						!dimensions.length ||
						(!variable.elementKind && !variable.structFields?.length)
					) {
						return [{ name: variable.name, value: '?' }];
					}
					if (variable.structFields?.length && variable.structSize) {
						const previewLength = Math.min(dimensions[0], 8);
						const values: string[] = [];
						for (let index = 0; index < previewLength; index += 1) {
							const fieldValues: string[] = [];
							for (const field of variable.structFields) {
								const offset = address + index * variable.structSize + field.offset;
								if (field.kind === 'bool') {
									fieldValues.push(
										`${field.name}: ${this.mem.read8(offset) ? 'true' : 'false'}`
									);
									continue;
								}
								if (field.kind === 'char') {
									const charCode = this.mem.read8(offset);
									fieldValues.push(
										`${field.name}: ${charCode >= 0x20 && charCode <= 0x7e ? `'${String.fromCharCode(charCode)}'` : `${charCode}`}`
									);
									continue;
								}
								if (field.kind === 'float') {
									fieldValues.push(
										`${field.name}: ${this.mem.readFloat32(offset)}`
									);
									continue;
								}
								if (field.kind === 'double') {
									fieldValues.push(
										`${field.name}: ${this.mem.readFloat64(offset)}`
									);
									continue;
								}
								fieldValues.push(`${field.name}: ${this.mem.readInt32(offset)}`);
							}
							values.push(`{${fieldValues.join(', ')}}`);
						}
						return [
							{
								name: variable.name,
								value: `[${values.join(', ')}${dimensions[0] > previewLength ? ', ...' : ''}]`
							}
						];
					}
					if (!variable.elementKind) return [{ name: variable.name, value: '?' }];
					const elementStride =
						variable.elementKind === 'double'
							? 8
							: variable.elementKind === 'bool' || variable.elementKind === 'char'
								? 1
								: 4;
					if (dimensions.length === 2) {
						const previewRows = Math.min(dimensions[0], 4);
						const previewCols = Math.min(dimensions[1], 8);
						const rows: string[] = [];
						for (let row = 0; row < previewRows; row += 1) {
							const values: string[] = [];
							for (let col = 0; col < previewCols; col += 1) {
								const offset =
									address + (row * dimensions[1] + col) * elementStride;
								if (variable.elementKind === 'bool') {
									values.push(this.mem.read8(offset) ? 'true' : 'false');
									continue;
								}
								if (variable.elementKind === 'char') {
									const charCode = this.mem.read8(offset);
									values.push(
										charCode >= 0x20 && charCode <= 0x7e
											? `'${String.fromCharCode(charCode)}'`
											: `${charCode}`
									);
									continue;
								}
								if (variable.elementKind === 'float') {
									values.push(`${this.mem.readFloat32(offset)}`);
									continue;
								}
								if (variable.elementKind === 'double') {
									values.push(`${this.mem.readFloat64(offset)}`);
									continue;
								}
								values.push(`${this.mem.readInt32(offset)}`);
							}
							rows.push(
								`[${values.join(', ')}${dimensions[1] > previewCols ? ', ...' : ''}]`
							);
						}
						return [
							{
								name: variable.name,
								value: `[${rows.join(', ')}${dimensions[0] > previewRows ? ', ...' : ''}]`
							}
						];
					}
					const previewLength = Math.min(dimensions[0], 8);
					const values: string[] = [];
					for (let index = 0; index < previewLength; index += 1) {
						const offset = address + index * elementStride;
						if (variable.elementKind === 'bool') {
							values.push(this.mem.read8(offset) ? 'true' : 'false');
							continue;
						}
						if (variable.elementKind === 'char') {
							const charCode = this.mem.read8(offset);
							values.push(
								charCode >= 0x20 && charCode <= 0x7e
									? `'${String.fromCharCode(charCode)}'`
									: `${charCode}`
							);
							continue;
						}
						if (variable.elementKind === 'float') {
							values.push(`${this.mem.readFloat32(offset)}`);
							continue;
						}
						if (variable.elementKind === 'double') {
							values.push(`${this.mem.readFloat64(offset)}`);
							continue;
						}
						values.push(`${this.mem.readInt32(offset)}`);
					}
					return [
						{
							name: variable.name,
							value: `[${values.join(', ')}${dimensions[0] > previewLength ? ', ...' : ''}]`
						}
					];
				}
				const value = frame?.values.get(variable.slot) ?? '?';
				return [{ name: variable.name, value }];
			}) || [];
		const localNames = new Set(locals.map((variable) => variable.name));
		const globals =
			(session.globalVariableMetadata || []).flatMap((variable) => {
				if (localNames.has(variable.name)) return [];
				if (line < variable.fromLine || line > variable.toLine) return [];
				if (variable.kind === 'array') {
					this.mem?.check?.();
					const address = Number(session.globalValues?.get(variable.slot) ?? Number.NaN);
					const dimensions = variable.dimensions?.length
						? variable.dimensions
						: variable.length
							? [variable.length]
							: [];
					if (
						!Number.isFinite(address) ||
						address <= 0 ||
						!dimensions.length ||
						(!variable.elementKind && !variable.structFields?.length)
					) {
						return [{ name: variable.name, value: '?' }];
					}
					if (variable.structFields?.length && variable.structSize) {
						const previewLength = Math.min(dimensions[0], 8);
						const values: string[] = [];
						for (let index = 0; index < previewLength; index += 1) {
							const fieldValues: string[] = [];
							for (const field of variable.structFields) {
								const offset = address + index * variable.structSize + field.offset;
								if (field.kind === 'bool') {
									fieldValues.push(
										`${field.name}: ${this.mem.read8(offset) ? 'true' : 'false'}`
									);
									continue;
								}
								if (field.kind === 'char') {
									const charCode = this.mem.read8(offset);
									fieldValues.push(
										`${field.name}: ${charCode >= 0x20 && charCode <= 0x7e ? `'${String.fromCharCode(charCode)}'` : `${charCode}`}`
									);
									continue;
								}
								if (field.kind === 'float') {
									fieldValues.push(
										`${field.name}: ${this.mem.readFloat32(offset)}`
									);
									continue;
								}
								if (field.kind === 'double') {
									fieldValues.push(
										`${field.name}: ${this.mem.readFloat64(offset)}`
									);
									continue;
								}
								fieldValues.push(`${field.name}: ${this.mem.readInt32(offset)}`);
							}
							values.push(`{${fieldValues.join(', ')}}`);
						}
						return [
							{
								name: variable.name,
								value: `[${values.join(', ')}${dimensions[0] > previewLength ? ', ...' : ''}]`
							}
						];
					}
					if (!variable.elementKind) return [{ name: variable.name, value: '?' }];
					const elementStride =
						variable.elementKind === 'double'
							? 8
							: variable.elementKind === 'bool' || variable.elementKind === 'char'
								? 1
								: 4;
					if (dimensions.length === 2) {
						const previewRows = Math.min(dimensions[0], 4);
						const previewCols = Math.min(dimensions[1], 8);
						const rows: string[] = [];
						for (let row = 0; row < previewRows; row += 1) {
							const values: string[] = [];
							for (let col = 0; col < previewCols; col += 1) {
								const offset =
									address + (row * dimensions[1] + col) * elementStride;
								if (variable.elementKind === 'bool') {
									values.push(this.mem.read8(offset) ? 'true' : 'false');
									continue;
								}
								if (variable.elementKind === 'char') {
									const charCode = this.mem.read8(offset);
									values.push(
										charCode >= 0x20 && charCode <= 0x7e
											? `'${String.fromCharCode(charCode)}'`
											: `${charCode}`
									);
									continue;
								}
								if (variable.elementKind === 'float') {
									values.push(`${this.mem.readFloat32(offset)}`);
									continue;
								}
								if (variable.elementKind === 'double') {
									values.push(`${this.mem.readFloat64(offset)}`);
									continue;
								}
								values.push(`${this.mem.readInt32(offset)}`);
							}
							rows.push(
								`[${values.join(', ')}${dimensions[1] > previewCols ? ', ...' : ''}]`
							);
						}
						return [
							{
								name: variable.name,
								value: `[${rows.join(', ')}${dimensions[0] > previewRows ? ', ...' : ''}]`
							}
						];
					}
					const previewLength = Math.min(dimensions[0], 8);
					const values: string[] = [];
					for (let index = 0; index < previewLength; index += 1) {
						const offset = address + index * elementStride;
						if (variable.elementKind === 'bool') {
							values.push(this.mem.read8(offset) ? 'true' : 'false');
							continue;
						}
						if (variable.elementKind === 'char') {
							const charCode = this.mem.read8(offset);
							values.push(
								charCode >= 0x20 && charCode <= 0x7e
									? `'${String.fromCharCode(charCode)}'`
									: `${charCode}`
							);
							continue;
						}
						if (variable.elementKind === 'float') {
							values.push(`${this.mem.readFloat32(offset)}`);
							continue;
						}
						if (variable.elementKind === 'double') {
							values.push(`${this.mem.readFloat64(offset)}`);
							continue;
						}
						values.push(`${this.mem.readInt32(offset)}`);
					}
					return [
						{
							name: variable.name,
							value: `[${values.join(', ')}${dimensions[0] > previewLength ? ', ...' : ''}]`
						}
					];
				}
				const value = session.globalValues?.get(variable.slot) ?? '?';
				return [{ name: variable.name, value }];
			}) || [];
		session.onPause?.({
			type: 'pause',
			line,
			reason,
			locals: [...locals, ...globals],
			callStack: [...session.frames].reverse().map((stackFrame) => ({
				functionName: stackFrame.functionName,
				line: stackFrame.line
			}))
		});
		const sequence = Atomics.load(buffer, 0);
		while (true) {
			if (session.interruptBuffer?.[0] === 2) throw new AbortError();
			Atomics.wait(buffer, 0, sequence, 100);
			if (session.interruptBuffer?.[0] === 2) throw new AbortError();
			const command = Atomics.exchange(buffer, 1, 0);
			if (command === 1) {
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
			if (command === 2) {
				session.stepArmed = true;
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
			if (command === 3) {
				session.nextLineArmed = true;
				session.nextLineFunctionId = session.currentFunctionId;
				session.nextLineLine = session.currentLine;
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
			if (command === 4) {
				session.stepOutArmed = true;
				session.stepOutDepth = Math.max(0, session.callDepth - 1);
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
			if (command === 5) {
				const expression = session.watchBuffer
					? readBufferedStdin(session.watchBuffer)
					: '';
				let result = '?';
				try {
					result = expression ? this.debugEvaluate(expression) : '?';
				} catch (error) {
					result =
						error instanceof Error && error.message === 'unavailable' ? '?' : 'error';
				}
				if (session.watchResultBuffer)
					flushQueuedStdin([result], session.watchResultBuffer);
			}
		}
	}

	__wasm_idle_debug_enter(functionId: number, line: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		session.callDepth += 1;
		session.currentFunctionId = functionId;
		session.currentLine = line;
		session.frames.push({
			functionId,
			functionName: session.functionMetadata[functionId] || `fn_${functionId}`,
			line,
			values: new Map()
		});
		this.trace(`enter(function=${functionId}, line=${line}, depth=${session.callDepth})`);
		if (session.pauseOnEntry) {
			return this.pauseDebugSession(session, functionId, line, 'entry');
		}
		if (session.stepArmed) {
			return this.pauseDebugSession(session, functionId, line, 'step');
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_leave(functionId: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		this.trace(`leave(function=${functionId}, depth=${session.callDepth})`);
		if (session.nextLineArmed && functionId === session.nextLineFunctionId) {
			session.nextLineArmed = false;
			session.stepArmed = true;
		}
		session.callDepth = Math.max(0, session.callDepth - 1);
		if (session.currentFunctionId === functionId) session.currentFunctionId = 0;
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			if (session.frames[index]?.functionId === functionId) {
				session.frames.splice(index, 1);
				break;
			}
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_num(functionId: number, slot: number, value: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		if (functionId === 0) {
			session.globalValues.set(slot, Number.isInteger(value) ? String(value) : `${value}`);
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, Number.isInteger(value) ? String(value) : `${value}`);
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_bool(functionId: number, slot: number, value: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		if (functionId === 0) {
			session.globalValues.set(slot, value ? 'true' : 'false');
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, value ? 'true' : 'false');
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_addr(functionId: number, slot: number, value: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		if (functionId === 0) {
			session.globalValues.set(slot, String(value >>> 0));
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, String(value >>> 0));
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_text(functionId: number, slot: number, ptr: number, len: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		this.mem?.check?.();
		const text = this.mem?.readStr ? this.mem.readStr(ptr, len) : '?';
		if (functionId === 0) {
			session.globalValues.set(slot, text);
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, text);
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_line(functionId: number, line: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		const sharedBreakpointVersion = Atomics.load(session.buffer, 2);
		if (sharedBreakpointVersion !== session.breakpointVersion) {
			const count = Math.max(0, Atomics.load(session.buffer, 3));
			const nextBreakpoints = new Set<number>();
			for (let index = 0; index < count && index + 4 < session.buffer.length; index += 1) {
				const breakpoint = Atomics.load(session.buffer, index + 4);
				if (breakpoint > 0) nextBreakpoints.add(breakpoint);
			}
			session.breakpoints = nextBreakpoints;
			session.breakpointVersion = sharedBreakpointVersion;
		}
		if (session.resumeSkipActive) {
			if (functionId === session.resumeSkipFunctionId && line === session.resumeSkipLine) {
				return ESUCCESS;
			}
			session.resumeSkipActive = false;
			session.resumeSkipFunctionId = 0;
			session.resumeSkipLine = 0;
		}
		let reason: DebugPauseReason | '' = '';
		if (session.pauseOnEntry) reason = 'entry';
		else if (session.breakpoints.has(line)) reason = 'breakpoint';
		else if (session.stepArmed) reason = 'step';
		else if (
			session.nextLineArmed &&
			functionId === session.nextLineFunctionId &&
			line !== session.nextLineLine
		) {
			reason = 'nextLine';
		} else if (session.stepOutArmed && session.callDepth <= session.stepOutDepth) {
			reason = 'stepOut';
		}
		if (!reason) return ESUCCESS;
		return this.pauseDebugSession(session, functionId, line, reason);
	}

	environ_sizes_get(environ_count_out: number, environ_buf_size_out: number) {
		this.mem.check();
		let size = 0;
		const names = Object.getOwnPropertyNames(this.environ);
		for (const name of names) {
			const value = this.environ[name];
			// +2 to account for = and \0 in "name=value\0".
			size += name.length + value.length + 2;
		}
		this.mem.write32(environ_count_out, names.length);
		this.mem.write32(environ_buf_size_out, size);
		this.trace(`environ_sizes_get(count=${names.length}, bytes=${size})`);
		return ESUCCESS;
	}

	environ_get(environ_ptrs: number, environ_buf: number) {
		this.mem.check();
		const names = Object.getOwnPropertyNames(this.environ);
		this.trace(`environ_get(entries=${JSON.stringify(names)})`);
		for (const name of names) {
			this.mem.write32(environ_ptrs, environ_buf);
			environ_ptrs += 4;
			environ_buf += this.mem.writeStr(environ_buf, `${name}=${this.environ[name]}`);
		}
		return ESUCCESS;
	}

	args_sizes_get(argc_out: number, argv_buf_size_out: number) {
		this.mem.check();
		let size = 0;
		for (let arg of this.argv) {
			size += arg.length + 1; // "arg\0".
		}
		this.mem.write32(argc_out, this.argv.length);
		this.mem.write32(argv_buf_size_out, size);
		this.trace(`args_sizes_get(count=${this.argv.length}, bytes=${size})`);
		return ESUCCESS;
	}

	args_get(argv_ptrs: number, argv_buf: number) {
		this.mem.check();
		this.trace(`args_get(argv=${JSON.stringify(this.argv)})`);
		for (let arg of this.argv) {
			this.mem.write32(argv_ptrs, argv_buf);
			argv_ptrs += 4;
			argv_buf += this.mem.writeStr(argv_buf, arg);
		}
		return ESUCCESS;
	}

	random_get(buf: number, buf_len: number) {
		const data = new Uint8Array(this.mem.buffer, buf, buf_len);
		for (let i = 0; i < buf_len; ++i) data[i] = (Math.random() * 256) | 0;
	}

	clock_time_get(clockId: number, _precision: bigint | number, timeOut: number) {
		this.mem.check();
		const milliseconds =
			clockId === 1 && typeof performance !== 'undefined' ? performance.now() : Date.now();
		const nanoseconds = BigInt(Math.floor(milliseconds * 1_000_000));
		this.mem.view.setBigUint64(timeOut, nanoseconds, true);
		this.trace(`clock_time_get(clock=${clockId}, ns=${nanoseconds})`);
		return ESUCCESS;
	}

	poll_oneoff() {
		throw new NotImplemented('wasi_unstable', 'poll_oneoff');
	}

	fd_filestat_set_times() {
		this.trace('fd_filestat_set_times()');
		return ESUCCESS;
	}

	path_filestat_set_times() {
		this.trace('path_filestat_set_times()');
		return ESUCCESS;
	}

	sock_accept() {
		this.trace('sock_accept() unsupported');
		return ENOTSUP;
	}

	sock_recv() {
		this.trace('sock_recv() unsupported');
		return ENOTSUP;
	}

	sock_send() {
		this.trace('sock_send() unsupported');
		return ENOTSUP;
	}

	sock_shutdown() {
		this.trace('sock_shutdown() unsupported');
		return ENOTSUP;
	}

	path_link(
		_oldFd: number,
		_oldFlags: number,
		oldPath: number,
		oldPathLen: number,
		_newFd: number,
		newPath: number,
		newPathLen: number
	) {
		this.mem.check();
		const source = this.mem.readStr(oldPath, oldPathLen).replace(/^\/+/, '');
		const target = this.mem.readStr(newPath, newPathLen).replace(/^\/+/, '');
		this.trace(`path_link(source=${JSON.stringify(source)}, target=${JSON.stringify(target)})`);
		this.storeFileContents(target, new Uint8Array(this.memfs.getFileContents(source)));
		return ESUCCESS;
	}

	path_rename(
		_oldFd: number,
		oldPath: number,
		oldPathLen: number,
		_newFd: number,
		newPath: number,
		newPathLen: number
	) {
		this.mem.check();
		const source = this.mem.readStr(oldPath, oldPathLen).replace(/^\/+/, '');
		const target = this.mem.readStr(newPath, newPathLen).replace(/^\/+/, '');
		this.trace(
			`path_rename(source=${JSON.stringify(source)}, target=${JSON.stringify(target)})`
		);
		this.storeFileContents(target, new Uint8Array(this.memfs.getFileContents(source)));
		return ESUCCESS;
	}
}
