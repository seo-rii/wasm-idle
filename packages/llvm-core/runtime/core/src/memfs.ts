import { bindNew } from './apply.js';
import { AbortError, assert } from './error.js';
import Memory from './memory.js';
import { compile, type ProgressSink } from './wasm.js';

const ESUCCESS = 0;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const emptyBytes = new Uint8Array(0);
const noopTrace = () => {};

export interface MemFsOptions {
	stdin: () => string;
	stdout: (str: string) => void;
	stdinStr?: string;
	moduleUrl: string;
	progress?: ProgressSink;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	maxAssetBytes?: number;
	trace?: (message: string) => void;
	/** Check before decoding or formatting diagnostics, including forwarding callbacks. */
	isTraceEnabled?: () => boolean;
}

const previewText = (text: string) =>
	JSON.stringify(text.length > 96 ? text.slice(0, 93) + '...' : text);

export default class MemFS {
	ready: Promise<void>;
	mem: Memory = <any>null;
	hostMem_: Memory = <any>null;
	stdinStr: string;
	private stdinBytes = emptyBytes;
	private stdinOffset = 0;
	stdin: () => string;
	stdout: (str: string) => void;
	trace: (message: string) => void;
	private readonly isTraceEnabled?: () => boolean;
	instance: WebAssembly.Instance = <any>null;
	exports: any;
	out = true;
	private readonly filePaths = new Set<string>();
	private readonly nativeFilePaths = new Set<string>();
	private readonly deletedFilePaths = new Set<string>();
	private readonly fileOverlays = new Map<string, Uint8Array>();
	private readonly directoryPaths = new Set<string>();
	private readonly outputDecoders = new Map<number, TextDecoder>();

	constructor(options: MemFsOptions) {
		this.stdin = options.stdin;
		this.stdout = options.stdout;
		this.stdinStr = options.stdinStr || '';
		this.trace = options.trace || noopTrace;
		this.isTraceEnabled = options.isTraceEnabled;

		const env = bindNew(
			this,
			'abort',
			'host_write',
			'host_read',
			'memfs_log',
			'copy_in',
			'copy_out'
		);

		this.ready = (
			options.fetchImpl
				? compile(
						options.moduleUrl,
						options.progress,
						options.signal,
						options.maxAssetBytes,
						options.fetchImpl
					)
				: options.maxAssetBytes !== undefined
					? compile(
							options.moduleUrl,
							options.progress,
							options.signal,
							options.maxAssetBytes
						)
					: options.signal
						? compile(options.moduleUrl, options.progress, options.signal)
						: compile(options.moduleUrl, options.progress)
		)
			.then(
				(module) =>
					WebAssembly.instantiate(module, {
						env
					}) as unknown as Promise<WebAssembly.Instance>
			)
			.then((instance) => {
				this.instance = instance;
				this.exports = instance.exports;
				this.mem = new Memory(this.exports.memory);
				this.exports.init();
			});
	}

	set hostMem(mem: Memory) {
		// A newly instantiated guest must never inherit a previous guest's partial character.
		this.outputDecoders.clear();
		this.hostMem_ = mem;
	}

	setStdinStr(str: string) {
		this.stdinStr = str;
		this.stdinBytes = emptyBytes;
		this.stdinOffset = 0;
	}

	addDirectory(path: string) {
		const normalizedPath = this.normalizePath(path);
		if (this.directoryPaths.has(normalizedPath)) return;
		this.mem.check();
		this.mem.write(this.exports.GetPathBuf(), path);
		this.exports.AddDirectoryNode(path.length);
		this.directoryPaths.add(normalizedPath);
	}

	addFile(path: string, contents: string | ArrayBuffer | Uint8Array) {
		const length = contents instanceof ArrayBuffer ? contents.byteLength : contents.length;
		this.mem.check();
		this.mem.write(this.exports.GetPathBuf(), path);
		const inode = this.exports.AddFileNode(path.length, length);
		const addr = this.exports.GetFileNodeAddress(inode);
		this.mem.check();
		this.mem.write(addr, contents);
		this.fileOverlays.delete(this.normalizePath(path));
		this.deletedFilePaths.delete(this.normalizePath(path));
		this.filePaths.add(this.normalizePath(path));
		this.nativeFilePaths.add(this.normalizePath(path));
	}

	setFile(path: string, contents: Uint8Array) {
		const normalizedPath = this.normalizePath(path);
		this.filePaths.add(normalizedPath);
		this.deletedFilePaths.delete(normalizedPath);
		this.fileOverlays.set(normalizedPath, Uint8Array.from(contents));
	}

	hasFile(path: string) {
		return this.filePaths.has(this.normalizePath(path));
	}

	/** Metadata lookup does not copy a file (notably large archives and PCHs). */
	getFileSize(path: string): number | undefined {
		const normalizedPath = this.normalizePath(path);
		if (!this.filePaths.has(normalizedPath)) return undefined;
		const overlay = this.fileOverlays.get(normalizedPath);
		if (overlay) return overlay.byteLength;
		this.mem.check();
		this.mem.write(this.exports.GetPathBuf(), normalizedPath);
		return this.exports.GetFileNodeSize(this.exports.FindNode(normalizedPath.length));
	}

	/** Compiler output lives in owned JS buffers; unlink releases those buffers. */
	removeFile(path: string): boolean {
		const normalizedPath = this.normalizePath(path);
		this.fileOverlays.delete(normalizedPath);
		// Also hide an older native node. Compiler handles preserve their own read snapshot.
		const existed = this.filePaths.delete(normalizedPath);
		if (existed && this.nativeFilePaths.has(normalizedPath)) {
			this.deletedFilePaths.add(normalizedPath);
		}
		return existed;
	}

	isFileDeleted(path: string) {
		return this.deletedFilePaths.has(this.normalizePath(path));
	}

	renameFile(source: string, target: string): boolean {
		const from = this.normalizePath(source);
		const to = this.normalizePath(target);
		if (!this.filePaths.has(from)) return false;
		if (from === to) return true;
		// Move an owned compiler buffer without allocating another full object copy.
		const contents = this.fileOverlays.get(from) ?? Uint8Array.from(this.getFileContents(from));
		this.fileOverlays.set(to, contents);
		this.filePaths.add(to);
		this.deletedFilePaths.delete(to);
		this.removeFile(from);
		return true;
	}

	private tracingEnabled() {
		return this.trace !== noopTrace && this.isTraceEnabled?.() !== false;
	}

	private normalizePath(path: string) {
		return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
	}

	getFileContents(path: string) {
		if (!this.hasFile(path)) throw new Error(`File not found: ${path}`);
		const overlay = this.fileOverlays.get(this.normalizePath(path));
		if (overlay) return overlay;
		this.mem.check();
		this.mem.write(this.exports.GetPathBuf(), path);
		const inode = this.exports.FindNode(path.length);
		const addr = this.exports.GetFileNodeAddress(inode);
		const size = this.exports.GetFileNodeSize(inode);
		return new Uint8Array(this.mem.buffer, addr, size);
	}

	abort() {
		this.trace('abort()');
		throw new AbortError();
	}

	host_write(fd: number, iovs: number, iovs_len: number, nwritten_out: number) {
		this.hostMem_.check();
		assert(fd <= 2);
		let size = 0;
		let str = '';
		let decoder = this.outputDecoders.get(fd);
		if (!decoder) {
			decoder = new TextDecoder('utf-8', { ignoreBOM: true });
			this.outputDecoders.set(fd, decoder);
		}
		for (let i = 0; i < iovs_len; ++i) {
			const buf = this.hostMem_.read32(iovs);
			iovs += 4;
			const len = this.hostMem_.read32(iovs);
			iovs += 4;
			str += decoder.decode(this.hostMem_.u8.subarray(buf, buf + len), { stream: true });
			size += len;
		}
		this.hostMem_.write32(nwritten_out, size);
		if (this.tracingEnabled()) {
			this.trace(`host_write(fd=${fd}, bytes=${size}, data=${previewText(str)})`);
		}
		if (this.out && str) this.stdout(str);
		return ESUCCESS;
	}

	/** Finish an fd on close, or all guest streams when execution settles. */
	flushOutput(fd?: number) {
		const streams = fd === undefined ? [...this.outputDecoders.keys()] : [fd];
		for (const stream of streams) {
			const decoder = this.outputDecoders.get(stream);
			if (!decoder) continue;
			this.outputDecoders.delete(stream);
			const tail = decoder.decode();
			if (this.out && tail) this.stdout(tail);
		}
	}

	host_read(fd: number, iovs: number, iovs_len: number, nread: number) {
		this.hostMem_.check();
		assert(fd === 0);
		let size = 0;
		for (let i = 0; i < iovs_len; ++i) {
			const buf = this.hostMem_.read32(iovs);
			iovs += 4;
			const len = this.hostMem_.read32(iovs);
			iovs += 4;
			// A zero-length iovec must not consume input or request interactive input.
			if (len === 0) continue;
			if (this.stdinOffset === this.stdinBytes.length) {
				const input = this.stdinStr.length ? this.stdinStr : this.stdin();
				this.stdinStr = '';
				this.stdinBytes = textEncoder.encode(input);
				this.stdinOffset = 0;
			}
			const lenToWrite = Math.min(len, this.stdinBytes.length - this.stdinOffset);
			if (lenToWrite === 0) break;
			const chunk = this.stdinBytes.subarray(this.stdinOffset, this.stdinOffset + lenToWrite);
			this.hostMem_.write(buf, chunk);
			this.stdinOffset += lenToWrite;
			if (this.stdinOffset === this.stdinBytes.length) {
				// Release the consumed input without copying the unread suffix on each read.
				this.stdinBytes = emptyBytes;
				this.stdinOffset = 0;
			}
			size += lenToWrite;
			if (this.tracingEnabled()) {
				this.trace(
					`host_read(fd=${fd}, bytes=${lenToWrite}, data=${previewText(textDecoder.decode(chunk))})`
				);
			}
			if (lenToWrite !== len) break;
		}
		this.hostMem_.write32(nread, size);
		if (size === 0 && this.tracingEnabled()) this.trace(`host_read(fd=${fd}, bytes=0)`);
		return ESUCCESS;
	}

	memfs_log(buf: number, len: number) {
		if (!this.tracingEnabled()) return;
		this.mem.check();
		const message = this.mem.readStr(buf, len);
		this.trace(`memfs_log(${previewText(message)})`);
	}

	copy_out(clang_dst: number, memfs_src: number, size: number) {
		this.hostMem_.check();
		const dst = new Uint8Array(this.hostMem_.buffer, clang_dst, size);
		this.mem.check();
		const src = new Uint8Array(this.mem.buffer, memfs_src, size);
		dst.set(src);
	}

	copy_in(memfs_dst: number, clang_src: number, size: number) {
		this.mem.check();
		const dst = new Uint8Array(this.mem.buffer, memfs_dst, size);
		this.hostMem_.check();
		const src = new Uint8Array(this.hostMem_.buffer, clang_src, size);
		dst.set(src);
	}
}
