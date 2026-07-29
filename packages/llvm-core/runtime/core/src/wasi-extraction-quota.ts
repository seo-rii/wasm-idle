import { OpenFile, type File, type WASI, wasi } from '@bjorn3/browser_wasi_shim';

const DEFAULT_MAX_EXPANDED_BYTES = 384 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 4096;
const DEFAULT_MAX_PATH_BYTES = 1024;
const MAX_WRITE_IOVECS = 1024;

export interface WasiExtractionQuotaOptions {
	label?: string;
	maxExpandedBytes?: number;
	maxEntries?: number;
	maxPathBytes?: number;
}

export interface WasiExtractionQuota {
	readonly usage: {
		expandedBytes: number;
		entries: number;
	};
	recordEntry(path: string): string;
	readSymlink(
		runtime: WASI,
		targetPointer: number,
		targetLength: number,
		pathPointer: number,
		pathLength: number
	): {
		target: string;
		resolvedTarget: string;
		path: string;
	};
	resolveSymlinkTarget(target: string, linkPath: string): string;
}

class ExtractionQuota implements WasiExtractionQuota {
	private expandedBytes = 0;
	private entries = 0;
	private readonly knownFiles = new WeakSet<File>();
	private readonly wrappedFiles = new WeakSet<OpenFile>();

	constructor(
		private readonly label: string,
		private readonly maxExpandedBytes: number,
		private readonly maxEntries: number,
		private readonly maxPathBytes: number
	) {}

	get usage() {
		return {
			expandedBytes: this.expandedBytes,
			entries: this.entries
		};
	}

	recordEntry(path: string) {
		const normalizedPath = this.validatePath(path);
		const nextEntries = this.entries + 1;
		if (nextEntries > this.maxEntries) {
			throw new Error(
				`${this.label} exceeds the ${this.maxEntries} entry limit while creating ${path}`
			);
		}
		this.entries = nextEntries;
		return normalizedPath;
	}

	resolveSymlinkTarget(target: string, linkPath: string) {
		const normalizedLinkPath = this.validatePath(linkPath);
		this.validatePathBytes(target, 'symlink target');
		if (!target || target.includes('\\') || /[\u0000-\u001f\u007f]/u.test(target)) {
			throw new Error(`${this.label} has an unsafe symlink target: ${target}`);
		}
		const linkParts = normalizedLinkPath.split('/');
		linkParts.pop();
		const resolvedParts = target.startsWith('/') ? [] : linkParts;
		for (const part of target.split('/')) {
			if (!part || part === '.') continue;
			if (part === '..') {
				if (resolvedParts.length === 0) {
					throw new Error(
						`${this.label} symlink target escapes the extraction root: ${target}`
					);
				}
				resolvedParts.pop();
				continue;
			}
			resolvedParts.push(part);
		}
		return this.validatePath(resolvedParts.join('/'));
	}

	releaseEntry() {
		this.entries -= 1;
	}

	wrapFileDescriptor(fd: unknown) {
		if (!(fd instanceof OpenFile) || this.wrappedFiles.has(fd)) return;
		this.wrappedFiles.add(fd);
		this.recordFile(fd.file);

		const allocate = fd.fd_allocate.bind(fd);
		fd.fd_allocate = (offset, length) => {
			this.reserveFileGrowth(fd.file, offset + length);
			return allocate(offset, length);
		};

		const resize = fd.fd_filestat_set_size.bind(fd);
		fd.fd_filestat_set_size = (size) => {
			this.reserveFileGrowth(fd.file, size);
			return resize(size);
		};

		const write = fd.fd_write.bind(fd);
		fd.fd_write = (data) => {
			this.reserveFileGrowth(fd.file, fd.file_pos + BigInt(data.byteLength));
			return write(data);
		};

		const pwrite = fd.fd_pwrite.bind(fd);
		fd.fd_pwrite = (data, offset) => {
			this.reserveFileGrowth(fd.file, offset + BigInt(data.byteLength));
			return pwrite(data, offset);
		};
	}

	readPath(runtime: WASI, pointer: number, length: number, allowCurrentDirectory = false) {
		const path = this.readUtf8(runtime, pointer, length, 'extraction path');
		if (allowCurrentDirectory && path === '.') return path;
		return this.validatePath(path, length);
	}

	readSymlink(
		runtime: WASI,
		targetPointer: number,
		targetLength: number,
		pathPointer: number,
		pathLength: number
	) {
		const path = this.readPath(runtime, pathPointer, pathLength);
		const target = this.readUtf8(runtime, targetPointer, targetLength, 'symlink target');
		return {
			target,
			resolvedTarget: this.resolveSymlinkTarget(target, path),
			path
		};
	}

	preflightWrite(
		runtime: WASI,
		fd: number,
		iovPointer: number,
		iovLength: number,
		offset?: bigint
	) {
		const descriptor = runtime.fds[fd];
		if (!(descriptor instanceof OpenFile)) return;
		this.wrapFileDescriptor(descriptor);
		if (
			!Number.isSafeInteger(iovPointer) ||
			iovPointer < 0 ||
			!Number.isSafeInteger(iovLength) ||
			iovLength < 0 ||
			iovLength > MAX_WRITE_IOVECS ||
			iovPointer + iovLength * 8 > runtime.inst.exports.memory.buffer.byteLength
		) {
			throw new Error(`${this.label} has an invalid write vector`);
		}
		const view = new DataView(runtime.inst.exports.memory.buffer);
		let byteLength = 0n;
		for (let index = 0; index < iovLength; index += 1) {
			const entryPointer = iovPointer + index * 8;
			const dataPointer = view.getUint32(entryPointer, true);
			const dataLength = view.getUint32(entryPointer + 4, true);
			if (dataPointer + dataLength > runtime.inst.exports.memory.buffer.byteLength) {
				throw new Error(`${this.label} has an invalid write vector`);
			}
			byteLength += BigInt(dataLength);
		}
		this.assertFileGrowth(descriptor.file, (offset ?? descriptor.file_pos) + byteLength);
	}

	private readUtf8(runtime: WASI, pointer: number, length: number, kind: string) {
		if (
			!Number.isSafeInteger(pointer) ||
			pointer < 0 ||
			!Number.isSafeInteger(length) ||
			length <= 0 ||
			length > this.maxPathBytes ||
			pointer + length > runtime.inst.exports.memory.buffer.byteLength
		) {
			throw new Error(`${this.label} has an invalid or oversized ${kind}`);
		}
		const bytes = new Uint8Array(runtime.inst.exports.memory.buffer, pointer, length);
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch (error) {
			throw new Error(`${this.label} has a non-UTF-8 ${kind}`, { cause: error });
		}
	}

	private recordFile(file: File) {
		if (this.knownFiles.has(file)) return;
		this.reserveBytes(file.data.byteLength);
		this.knownFiles.add(file);
	}

	private reserveFileGrowth(file: File, requestedSize: bigint) {
		const byteLength = this.fileGrowth(file, requestedSize);
		this.reserveBytes(byteLength);
	}

	private assertFileGrowth(file: File, requestedSize: bigint) {
		const byteLength = this.fileGrowth(file, requestedSize);
		if (this.expandedBytes + byteLength > this.maxExpandedBytes) {
			throw new Error(
				`${this.label} exceeds the ${this.maxExpandedBytes} byte expanded-size limit`
			);
		}
	}

	private fileGrowth(file: File, requestedSize: bigint) {
		if (requestedSize < 0n || requestedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error(`${this.label} requested an invalid extracted-file size`);
		}
		const currentSize = BigInt(file.data.byteLength);
		return requestedSize <= currentSize ? 0 : Number(requestedSize - currentSize);
	}

	private reserveBytes(byteLength: number) {
		const nextExpandedBytes = this.expandedBytes + byteLength;
		if (nextExpandedBytes > this.maxExpandedBytes) {
			throw new Error(
				`${this.label} exceeds the ${this.maxExpandedBytes} byte expanded-size limit`
			);
		}
		this.expandedBytes = nextExpandedBytes;
	}

	private validatePath(path: string, byteLength?: number) {
		this.validatePathBytes(path, 'path', byteLength);
		const candidate = path.endsWith('/') ? path.slice(0, -1) : path;
		if (
			!candidate ||
			candidate.startsWith('/') ||
			candidate.includes('\\') ||
			/[\u0000-\u001f\u007f]/u.test(candidate)
		) {
			throw new Error(`${this.label} has an unsafe extraction path: ${path}`);
		}
		const parts = candidate.split('/');
		if (parts.some((part) => !part || part === '.' || part === '..')) {
			throw new Error(`${this.label} has an unsafe extraction path: ${path}`);
		}
		return parts.join('/');
	}

	private validatePathBytes(path: string, kind: string, byteLength?: number) {
		const encodedBytes = byteLength ?? new TextEncoder().encode(path).byteLength;
		if (encodedBytes > this.maxPathBytes) {
			throw new Error(
				`${this.label} ${kind} exceeds the ${this.maxPathBytes} byte path limit`
			);
		}
	}
}

function requirePositiveSafeInteger(value: number, name: string) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive safe integer`);
	}
	return value;
}

export function installWasiExtractionQuota(
	runtime: WASI,
	options: WasiExtractionQuotaOptions = {}
): WasiExtractionQuota {
	const quota = new ExtractionQuota(
		options.label?.trim() || 'WASI extraction',
		requirePositiveSafeInteger(
			options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
			'maxExpandedBytes'
		),
		requirePositiveSafeInteger(options.maxEntries ?? DEFAULT_MAX_ENTRIES, 'maxEntries'),
		requirePositiveSafeInteger(options.maxPathBytes ?? DEFAULT_MAX_PATH_BYTES, 'maxPathBytes')
	);

	const fdWrite = runtime.wasiImport.fd_write;
	if (typeof fdWrite === 'function') {
		runtime.wasiImport.fd_write = (
			fd: number,
			iovPointer: number,
			iovLength: number,
			nwrittenPointer: number
		) => {
			quota.preflightWrite(runtime, fd, iovPointer, iovLength);
			return fdWrite(fd, iovPointer, iovLength, nwrittenPointer);
		};
	}

	const fdPwrite = runtime.wasiImport.fd_pwrite;
	if (typeof fdPwrite === 'function') {
		runtime.wasiImport.fd_pwrite = (
			fd: number,
			iovPointer: number,
			iovLength: number,
			offset: bigint,
			nwrittenPointer: number
		) => {
			quota.preflightWrite(runtime, fd, iovPointer, iovLength, offset);
			return fdPwrite(fd, iovPointer, iovLength, offset, nwrittenPointer);
		};
	}

	const pathOpen = runtime.wasiImport.path_open;
	if (typeof pathOpen === 'function') {
		runtime.wasiImport.path_open = (
			fd: number,
			dirFlags: number,
			pathPointer: number,
			pathLength: number,
			ofFlags: number,
			fsRightsBase: bigint,
			fsRightsInheriting: bigint,
			fdFlags: number,
			openedFdPointer: number
		) => {
			const mutatesPath = (ofFlags & (wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC)) !== 0;
			const path = quota.readPath(runtime, pathPointer, pathLength, !mutatesPath);
			const parentFd = runtime.fds[fd];
			const shouldReserve =
				(ofFlags & wasi.OFLAGS_CREAT) !== 0 &&
				parentFd?.path_lookup(path, dirFlags).ret !== wasi.ERRNO_SUCCESS;
			if (shouldReserve) quota.recordEntry(path);
			let result: unknown;
			try {
				result = pathOpen(
					fd,
					dirFlags,
					pathPointer,
					pathLength,
					ofFlags,
					fsRightsBase,
					fsRightsInheriting,
					fdFlags,
					openedFdPointer
				);
			} catch (error) {
				if (shouldReserve) quota.releaseEntry();
				throw error;
			}
			if (result !== wasi.ERRNO_SUCCESS) {
				if (shouldReserve) quota.releaseEntry();
				return result;
			}
			const openedFd = new DataView(runtime.inst.exports.memory.buffer).getUint32(
				openedFdPointer,
				true
			);
			quota.wrapFileDescriptor(runtime.fds[openedFd]);
			return result;
		};
	}

	const createDirectory = runtime.wasiImport.path_create_directory;
	if (typeof createDirectory === 'function') {
		runtime.wasiImport.path_create_directory = (
			fd: number,
			pathPointer: number,
			pathLength: number
		) => {
			const path = quota.readPath(runtime, pathPointer, pathLength);
			const shouldReserve = runtime.fds[fd]?.path_lookup(path, 0).ret !== wasi.ERRNO_SUCCESS;
			if (shouldReserve) quota.recordEntry(path);
			let result: unknown;
			try {
				result = createDirectory(fd, pathPointer, pathLength);
			} catch (error) {
				if (shouldReserve) quota.releaseEntry();
				throw error;
			}
			if (result !== wasi.ERRNO_SUCCESS && shouldReserve) quota.releaseEntry();
			return result;
		};
	}

	const pathLink = runtime.wasiImport.path_link;
	if (typeof pathLink === 'function') {
		runtime.wasiImport.path_link = (
			oldFd: number,
			oldFlags: number,
			oldPathPointer: number,
			oldPathLength: number,
			newFd: number,
			newPathPointer: number,
			newPathLength: number
		) => {
			quota.readPath(runtime, oldPathPointer, oldPathLength);
			const newPath = quota.readPath(runtime, newPathPointer, newPathLength);
			const shouldReserve =
				runtime.fds[newFd]?.path_lookup(newPath, 0).ret !== wasi.ERRNO_SUCCESS;
			if (shouldReserve) quota.recordEntry(newPath);
			let result: unknown;
			try {
				result = pathLink(
					oldFd,
					oldFlags,
					oldPathPointer,
					oldPathLength,
					newFd,
					newPathPointer,
					newPathLength
				);
			} catch (error) {
				if (shouldReserve) quota.releaseEntry();
				throw error;
			}
			if (result !== wasi.ERRNO_SUCCESS && shouldReserve) quota.releaseEntry();
			return result;
		};
	}

	const pathRename = runtime.wasiImport.path_rename;
	if (typeof pathRename === 'function') {
		runtime.wasiImport.path_rename = (
			fd: number,
			oldPathPointer: number,
			oldPathLength: number,
			newFd: number,
			newPathPointer: number,
			newPathLength: number
		) => {
			quota.readPath(runtime, oldPathPointer, oldPathLength);
			quota.readPath(runtime, newPathPointer, newPathLength);
			return pathRename(
				fd,
				oldPathPointer,
				oldPathLength,
				newFd,
				newPathPointer,
				newPathLength
			);
		};
	}

	const unlinkFile = runtime.wasiImport.path_unlink_file;
	if (typeof unlinkFile === 'function') {
		runtime.wasiImport.path_unlink_file = (
			fd: number,
			pathPointer: number,
			pathLength: number
		) => {
			quota.readPath(runtime, pathPointer, pathLength);
			return unlinkFile(fd, pathPointer, pathLength);
		};
	}

	const removeDirectory = runtime.wasiImport.path_remove_directory;
	if (typeof removeDirectory === 'function') {
		runtime.wasiImport.path_remove_directory = (
			fd: number,
			pathPointer: number,
			pathLength: number
		) => {
			quota.readPath(runtime, pathPointer, pathLength);
			return removeDirectory(fd, pathPointer, pathLength);
		};
	}

	const pathSymlink = runtime.wasiImport.path_symlink;
	if (typeof pathSymlink === 'function') {
		runtime.wasiImport.path_symlink = (
			oldPathPointer: number,
			oldPathLength: number,
			fd: number,
			newPathPointer: number,
			newPathLength: number
		) => {
			const { path: newPath } = quota.readSymlink(
				runtime,
				oldPathPointer,
				oldPathLength,
				newPathPointer,
				newPathLength
			);
			const shouldReserve =
				runtime.fds[fd]?.path_lookup(newPath, 0).ret !== wasi.ERRNO_SUCCESS;
			if (shouldReserve) quota.recordEntry(newPath);
			let result: unknown;
			try {
				result = pathSymlink(
					oldPathPointer,
					oldPathLength,
					fd,
					newPathPointer,
					newPathLength
				);
			} catch (error) {
				if (shouldReserve) quota.releaseEntry();
				throw error;
			}
			if (result !== wasi.ERRNO_SUCCESS && shouldReserve) quota.releaseEntry();
			return result;
		};
	}

	return quota;
}
