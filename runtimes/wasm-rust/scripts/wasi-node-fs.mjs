import fs from 'node:fs';
import path from 'node:path';

import { Fd, Inode, wasi } from '@bjorn3/browser_wasi_shim';

const FS_TRACE = process.env.WASM_RUST_FS_TRACE === '1';

function traceFs(message) {
	if (FS_TRACE) {
		console.error(`[wasm-rust-fs] ${message}`);
	}
}

function errnoToWasi(error, fallback = wasi.ERRNO_IO) {
	switch (error?.code) {
		case 'ENOENT':
			return wasi.ERRNO_NOENT;
		case 'EEXIST':
			return wasi.ERRNO_EXIST;
		case 'ENOTDIR':
			return wasi.ERRNO_NOTDIR;
		case 'EISDIR':
			return wasi.ERRNO_ISDIR;
		case 'ENOTEMPTY':
			return wasi.ERRNO_NOTEMPTY;
		case 'EACCES':
		case 'EPERM':
			return wasi.ERRNO_PERM;
		case 'EBADF':
			return wasi.ERRNO_BADF;
		case 'EINVAL':
			return wasi.ERRNO_INVAL;
		default:
			return fallback;
	}
}

function fileTypeFromStat(stat) {
	if (stat.isDirectory()) {
		return wasi.FILETYPE_DIRECTORY;
	}
	if (stat.isFile()) {
		return wasi.FILETYPE_REGULAR_FILE;
	}
	if (stat.isSymbolicLink()) {
		return wasi.FILETYPE_SYMBOLIC_LINK;
	}
	return wasi.FILETYPE_UNKNOWN;
}

function hostFilestat(hostPath) {
	const stat = fs.statSync(hostPath, { bigint: true });
	const ino = typeof stat.ino === 'bigint' ? stat.ino : BigInt(stat.ino);
	const size = typeof stat.size === 'bigint' ? stat.size : BigInt(stat.size);
	return new wasi.Filestat(ino, fileTypeFromStat(stat), size);
}

function parseRelativePath(pathStr) {
	if (pathStr.startsWith('/')) {
		return { ret: wasi.ERRNO_NOTCAPABLE, parts: null, isDir: false };
	}
	if (pathStr.includes('\0')) {
		return { ret: wasi.ERRNO_INVAL, parts: null, isDir: false };
	}
	const isDir = pathStr.endsWith('/');
	const parts = [];
	for (const part of pathStr.split('/')) {
		if (part === '' || part === '.') {
			continue;
		}
		if (part === '..') {
			if (parts.length === 0) {
				return { ret: wasi.ERRNO_NOTCAPABLE, parts: null, isDir: false };
			}
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return { ret: wasi.ERRNO_SUCCESS, parts, isDir };
}

function resolveInside(rootPath, pathStr) {
	const parsed = parseRelativePath(pathStr);
	if (!parsed.parts) {
		return { ret: parsed.ret, hostPath: null, isDir: parsed.isDir };
	}
	return {
		ret: wasi.ERRNO_SUCCESS,
		hostPath: path.join(rootPath, ...parsed.parts),
		isDir: parsed.isDir
	};
}

class DetachedFileInode extends Inode {
	constructor(data) {
		super();
		this.data = data;
	}

	path_open() {
		return { ret: wasi.ERRNO_NOTSUP, fd_obj: null };
	}

	stat() {
		return new wasi.Filestat(this.ino, wasi.FILETYPE_REGULAR_FILE, BigInt(this.data.byteLength));
	}
}

class NodeFileInode extends Inode {
	constructor(hostPath, readonly) {
		super();
		this.hostPath = hostPath;
		this.readonly = readonly;
	}

	path_open(oflags, fsRightsBase, fdFlags) {
		const wantsWrite =
			(fsRightsBase & BigInt(wasi.RIGHTS_FD_WRITE)) === BigInt(wasi.RIGHTS_FD_WRITE) ||
			(oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT ||
			(oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC ||
			(fdFlags & wasi.FDFLAGS_APPEND) === wasi.FDFLAGS_APPEND;
		if (wantsWrite) {
			traceFs(`inode:path_open write ${this.hostPath}`);
		}
		if (this.readonly && wantsWrite) {
			return { ret: wasi.ERRNO_PERM, fd_obj: null };
		}
		try {
			return {
				ret: wasi.ERRNO_SUCCESS,
				fd_obj: new NodeOpenFile(this.hostPath, this.readonly, oflags, fsRightsBase, fdFlags)
			};
		} catch (error) {
			return { ret: errnoToWasi(error), fd_obj: null };
		}
	}

	stat() {
		return hostFilestat(this.hostPath);
	}
}

class NodeDirectoryInode extends Inode {
	constructor(hostPath, readonly) {
		super();
		this.hostPath = hostPath;
		this.readonly = readonly;
	}

	path_open(oflags, fsRightsBase, fdFlags) {
		return {
			ret: wasi.ERRNO_SUCCESS,
			fd_obj: new NodeOpenDirectory(this.hostPath, this.readonly, oflags, fsRightsBase, fdFlags)
		};
	}

	stat() {
		return hostFilestat(this.hostPath);
	}
}

function inodeForHostPath(hostPath, readonly) {
	const stat = fs.statSync(hostPath);
	if (stat.isDirectory()) {
		return new NodeDirectoryInode(hostPath, readonly);
	}
	return new NodeFileInode(hostPath, readonly);
}

function openFlags(oflags, fsRightsBase, fdFlags) {
	let flags = 0;
	const wantsWrite =
		(fsRightsBase & BigInt(wasi.RIGHTS_FD_WRITE)) === BigInt(wasi.RIGHTS_FD_WRITE) ||
		(oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT ||
		(oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC ||
		(fdFlags & wasi.FDFLAGS_APPEND) === wasi.FDFLAGS_APPEND;
	flags |= wantsWrite ? fs.constants.O_RDWR : fs.constants.O_RDONLY;
	if ((oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT) {
		flags |= fs.constants.O_CREAT;
	}
	if ((oflags & wasi.OFLAGS_EXCL) === wasi.OFLAGS_EXCL) {
		flags |= fs.constants.O_EXCL;
	}
	if ((oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC) {
		flags |= fs.constants.O_TRUNC;
	}
	if ((fdFlags & wasi.FDFLAGS_APPEND) === wasi.FDFLAGS_APPEND) {
		flags |= fs.constants.O_APPEND;
	}
	return { flags, wantsWrite };
}

export class NodeOpenFile extends Fd {
	constructor(hostPath, readonly, oflags, fsRightsBase, fdFlags) {
		super();
		this.hostPath = hostPath;
		this.readonly = readonly;
		this.fdFlags = fdFlags;
		const { flags } = openFlags(oflags, fsRightsBase, fdFlags);
		this.fd = fs.openSync(hostPath, flags, 0o666);
		this.filePos = 0n;
		if ((fdFlags & wasi.FDFLAGS_APPEND) === wasi.FDFLAGS_APPEND) {
			this.filePos = BigInt(fs.fstatSync(this.fd).size);
		}
	}

	fd_allocate(offset, len) {
		if (this.readonly) {
			return wasi.ERRNO_PERM;
		}
		traceFs(`fd_allocate ${this.hostPath} offset=${offset} len=${len}`);
		const required = Number(offset + len);
		const current = fs.fstatSync(this.fd).size;
		if (required > current) {
			fs.ftruncateSync(this.fd, required);
		}
		return wasi.ERRNO_SUCCESS;
	}

	fd_close() {
		traceFs(`fd_close ${this.hostPath}`);
		fs.closeSync(this.fd);
		return wasi.ERRNO_SUCCESS;
	}

	fd_fdstat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat: new wasi.Fdstat(wasi.FILETYPE_REGULAR_FILE, this.fdFlags)
		};
	}

	fd_filestat_get() {
		const stat = fs.fstatSync(this.fd, { bigint: true });
		const ino = typeof stat.ino === 'bigint' ? stat.ino : BigInt(stat.ino);
		const size = typeof stat.size === 'bigint' ? stat.size : BigInt(stat.size);
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(ino, wasi.FILETYPE_REGULAR_FILE, size)
		};
	}

	fd_filestat_set_size(size) {
		if (this.readonly) {
			return wasi.ERRNO_PERM;
		}
		traceFs(`fd_set_size ${this.hostPath} size=${size}`);
		fs.ftruncateSync(this.fd, Number(size));
		return wasi.ERRNO_SUCCESS;
	}

	fd_pread(size, offset) {
		const buffer = Buffer.allocUnsafe(size);
		const bytesRead = fs.readSync(this.fd, buffer, 0, size, Number(offset));
		return { ret: wasi.ERRNO_SUCCESS, data: buffer.subarray(0, bytesRead) };
	}

	fd_pwrite(data, offset) {
		if (this.readonly) {
			return { ret: wasi.ERRNO_PERM, nwritten: 0 };
		}
		traceFs(`fd_pwrite ${this.hostPath} bytes=${data.byteLength} offset=${offset}`);
		const bytesWritten = fs.writeSync(this.fd, data, 0, data.byteLength, Number(offset));
		return { ret: wasi.ERRNO_SUCCESS, nwritten: bytesWritten };
	}

	fd_read(size) {
		const buffer = Buffer.allocUnsafe(size);
		const bytesRead = fs.readSync(this.fd, buffer, 0, size, Number(this.filePos));
		this.filePos += BigInt(bytesRead);
		return { ret: wasi.ERRNO_SUCCESS, data: buffer.subarray(0, bytesRead) };
	}

	fd_seek(offset, whence) {
		let next;
		switch (whence) {
			case wasi.WHENCE_SET:
				next = offset;
				break;
			case wasi.WHENCE_CUR:
				next = this.filePos + offset;
				break;
			case wasi.WHENCE_END:
				next = BigInt(fs.fstatSync(this.fd).size) + offset;
				break;
			default:
				return { ret: wasi.ERRNO_INVAL, offset: 0n };
		}
		if (next < 0n) {
			return { ret: wasi.ERRNO_INVAL, offset: 0n };
		}
		this.filePos = next;
		return { ret: wasi.ERRNO_SUCCESS, offset: this.filePos };
	}

	fd_sync() {
		traceFs(`fd_sync ${this.hostPath}`);
		fs.fsyncSync(this.fd);
		return wasi.ERRNO_SUCCESS;
	}

	fd_tell() {
		return { ret: wasi.ERRNO_SUCCESS, offset: this.filePos };
	}

	fd_write(data) {
		if (this.readonly) {
			return { ret: wasi.ERRNO_PERM, nwritten: 0 };
		}
		traceFs(`fd_write ${this.hostPath} bytes=${data.byteLength}`);
		const position =
			(this.fdFlags & wasi.FDFLAGS_APPEND) === wasi.FDFLAGS_APPEND ? null : Number(this.filePos);
		const bytesWritten = fs.writeSync(this.fd, data, 0, data.byteLength, position);
		this.filePos += BigInt(bytesWritten);
		return { ret: wasi.ERRNO_SUCCESS, nwritten: bytesWritten };
	}
}

export class NodeOpenDirectory extends Fd {
	constructor(hostPath, readonly) {
		super();
		this.hostPath = hostPath;
		this.readonly = readonly;
	}

	fd_fdstat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat: new wasi.Fdstat(wasi.FILETYPE_DIRECTORY, 0)
		};
	}

	fd_filestat_get() {
		return { ret: wasi.ERRNO_SUCCESS, filestat: hostFilestat(this.hostPath) };
	}

	fd_readdir_single(cookie) {
		const entries = fs.readdirSync(this.hostPath, { withFileTypes: true });
		if (cookie === 0n) {
			return {
				ret: wasi.ERRNO_SUCCESS,
				dirent: new wasi.Dirent(1n, hostFilestat(this.hostPath).ino, '.', wasi.FILETYPE_DIRECTORY)
			};
		}
		if (cookie === 1n) {
			const parent = path.dirname(this.hostPath);
			return {
				ret: wasi.ERRNO_SUCCESS,
				dirent: new wasi.Dirent(2n, hostFilestat(parent).ino, '..', wasi.FILETYPE_DIRECTORY)
			};
		}
		const index = Number(cookie - 2n);
		if (index < 0 || index >= entries.length) {
			return { ret: wasi.ERRNO_SUCCESS, dirent: null };
		}
		const entry = entries[index];
		const entryPath = path.join(this.hostPath, entry.name);
		const filestat = hostFilestat(entryPath);
		return {
			ret: wasi.ERRNO_SUCCESS,
			dirent: new wasi.Dirent(cookie + 1n, filestat.ino, entry.name, filestat.filetype)
		};
	}

	path_create_directory(pathStr) {
		if (this.readonly) {
			return wasi.ERRNO_PERM;
		}
		traceFs(`mkdir ${path.join(this.hostPath, pathStr)}`);
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return resolved.ret;
		}
		try {
			fs.mkdirSync(resolved.hostPath);
			return wasi.ERRNO_SUCCESS;
		} catch (error) {
			return errnoToWasi(error);
		}
	}

	path_filestat_get(_flags, pathStr) {
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return { ret: resolved.ret, filestat: null };
		}
		try {
			return { ret: wasi.ERRNO_SUCCESS, filestat: hostFilestat(resolved.hostPath) };
		} catch (error) {
			return { ret: errnoToWasi(error), filestat: null };
		}
	}

	path_link(pathStr, inode, allowDir) {
		if (this.readonly) {
			return wasi.ERRNO_PERM;
		}
		traceFs(`link ${path.join(this.hostPath, pathStr)} allowDir=${allowDir ? '1' : '0'}`);
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return resolved.ret;
		}
		try {
			if (inode instanceof DetachedFileInode) {
				fs.writeFileSync(resolved.hostPath, inode.data);
				return wasi.ERRNO_SUCCESS;
			}
			if (inode instanceof NodeFileInode) {
				fs.copyFileSync(inode.hostPath, resolved.hostPath);
				return wasi.ERRNO_SUCCESS;
			}
			if (inode instanceof NodeDirectoryInode) {
				if (!allowDir) {
					return wasi.ERRNO_PERM;
				}
				fs.mkdirSync(resolved.hostPath);
				return wasi.ERRNO_SUCCESS;
			}
			return wasi.ERRNO_NOTSUP;
		} catch (error) {
			return errnoToWasi(error);
		}
	}

	path_lookup(pathStr) {
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return { ret: resolved.ret, inode_obj: null };
		}
		try {
			return {
				ret: wasi.ERRNO_SUCCESS,
				inode_obj: inodeForHostPath(resolved.hostPath, this.readonly)
			};
		} catch (error) {
			return { ret: errnoToWasi(error), inode_obj: null };
		}
	}

	path_open(_dirflags, pathStr, oflags, fsRightsBase, _fsRightsInheriting, fdFlags) {
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return { ret: resolved.ret, fd_obj: null };
		}
		const wantsWrite =
			(fsRightsBase & BigInt(wasi.RIGHTS_FD_WRITE)) === BigInt(wasi.RIGHTS_FD_WRITE) ||
			(oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT ||
			(oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC ||
			(fdFlags & wasi.FDFLAGS_APPEND) === wasi.FDFLAGS_APPEND;
		if (wantsWrite || (oflags & wasi.OFLAGS_DIRECTORY) === wasi.OFLAGS_DIRECTORY) {
			traceFs(
				`path_open ${resolved.hostPath} dir=${(oflags & wasi.OFLAGS_DIRECTORY) === wasi.OFLAGS_DIRECTORY ? '1' : '0'} create=${(oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT ? '1' : '0'} trunc=${(oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC ? '1' : '0'}`
			);
		}
		try {
			if ((oflags & wasi.OFLAGS_DIRECTORY) === wasi.OFLAGS_DIRECTORY) {
				if (!fs.existsSync(resolved.hostPath) && (oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT) {
					if (this.readonly) {
						return { ret: wasi.ERRNO_PERM, fd_obj: null };
					}
					fs.mkdirSync(resolved.hostPath);
				}
				if (!fs.statSync(resolved.hostPath).isDirectory()) {
					return { ret: wasi.ERRNO_NOTDIR, fd_obj: null };
				}
				return {
					ret: wasi.ERRNO_SUCCESS,
					fd_obj: new NodeOpenDirectory(resolved.hostPath, this.readonly)
				};
			}
			if (
				!fs.existsSync(resolved.hostPath) &&
				(oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT
			) {
				if (this.readonly) {
					return { ret: wasi.ERRNO_PERM, fd_obj: null };
				}
				fs.closeSync(fs.openSync(resolved.hostPath, fs.constants.O_CREAT | fs.constants.O_RDWR, 0o666));
			}
			return inodeForHostPath(resolved.hostPath, this.readonly).path_open(
				oflags,
				fsRightsBase,
				fdFlags
			);
		} catch (error) {
			return { ret: errnoToWasi(error), fd_obj: null };
		}
	}

	path_readlink(pathStr) {
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return { ret: resolved.ret, data: null };
		}
		try {
			return { ret: wasi.ERRNO_SUCCESS, data: fs.readlinkSync(resolved.hostPath) };
		} catch (error) {
			return { ret: errnoToWasi(error), data: null };
		}
	}

	path_remove_directory(pathStr) {
		if (this.readonly) {
			return wasi.ERRNO_PERM;
		}
		traceFs(`rmdir ${path.join(this.hostPath, pathStr)}`);
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return resolved.ret;
		}
		try {
			fs.rmdirSync(resolved.hostPath);
			return wasi.ERRNO_SUCCESS;
		} catch (error) {
			return errnoToWasi(error);
		}
	}

	path_unlink(pathStr) {
		if (this.readonly) {
			return { ret: wasi.ERRNO_PERM, inode_obj: null };
		}
		traceFs(`unlink-any ${path.join(this.hostPath, pathStr)}`);
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return { ret: resolved.ret, inode_obj: null };
		}
		try {
			const stat = fs.statSync(resolved.hostPath);
			if (stat.isDirectory()) {
				fs.rmdirSync(resolved.hostPath);
				return {
					ret: wasi.ERRNO_SUCCESS,
					inode_obj: new NodeDirectoryInode(resolved.hostPath, this.readonly)
				};
			}
			const data = fs.readFileSync(resolved.hostPath);
			fs.unlinkSync(resolved.hostPath);
			return { ret: wasi.ERRNO_SUCCESS, inode_obj: new DetachedFileInode(data) };
		} catch (error) {
			return { ret: errnoToWasi(error), inode_obj: null };
		}
	}

	path_unlink_file(pathStr) {
		if (this.readonly) {
			return wasi.ERRNO_PERM;
		}
		traceFs(`unlink-file ${path.join(this.hostPath, pathStr)}`);
		const resolved = resolveInside(this.hostPath, pathStr);
		if (!resolved.hostPath) {
			return resolved.ret;
		}
		try {
			fs.unlinkSync(resolved.hostPath);
			return wasi.ERRNO_SUCCESS;
		} catch (error) {
			return errnoToWasi(error);
		}
	}
}

export class NodePreopenDirectory extends NodeOpenDirectory {
	constructor(prestatName, hostPath, readonly) {
		super(hostPath, readonly);
		this.prestatName = prestatName;
	}

	fd_prestat_get() {
		return { ret: wasi.ERRNO_SUCCESS, prestat: wasi.Prestat.dir(this.prestatName) };
	}
}
