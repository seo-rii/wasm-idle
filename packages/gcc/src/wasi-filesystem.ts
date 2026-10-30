import {
	Directory,
	File,
	OpenDirectory,
	OpenFile,
	wasi,
	type Fd,
	type Inode
} from '@bjorn3/browser_wasi_shim';
import type { WasiGccFilesystemLimits, WasiGccPreopen, WasiGccResultFile } from './types.js';

const encoder = new TextEncoder();
const defaults = {
	maxEntries: 1024,
	maxFileBytes: 16 * 1024 * 1024,
	maxTotalBytes: 64 * 1024 * 1024,
	maxPathBytes: 4096,
	maxOpenFiles: 256
};
type Limits = typeof defaults;
const fileRights = BigInt(
	wasi.RIGHTS_FD_READ |
		wasi.RIGHTS_FD_WRITE |
		wasi.RIGHTS_FD_SEEK |
		wasi.RIGHTS_FD_TELL |
		wasi.RIGHTS_FD_FDSTAT_SET_FLAGS |
		wasi.RIGHTS_FD_ALLOCATE |
		wasi.RIGHTS_FD_FILESTAT_GET |
		wasi.RIGHTS_FD_FILESTAT_SET_SIZE
);
const directoryRights = BigInt(
	wasi.RIGHTS_PATH_OPEN |
		wasi.RIGHTS_PATH_CREATE_FILE |
		wasi.RIGHTS_PATH_CREATE_DIRECTORY |
		wasi.RIGHTS_FD_READDIR |
		wasi.RIGHTS_PATH_FILESTAT_GET |
		wasi.RIGHTS_FD_FILESTAT_GET |
		wasi.RIGHTS_PATH_REMOVE_DIRECTORY |
		wasi.RIGHTS_PATH_UNLINK_FILE
);
// In-memory operations never block; wasi-libc opens directories with NONBLOCK.
const supportedFdFlags = wasi.FDFLAGS_APPEND | wasi.FDFLAGS_NONBLOCK;
const invalidText = (path: string) => /[\\\0\ud800-\udfff]/u.test(path);
const join = (base: string, relative: string) => `${base === '/' ? '' : base}/${relative}`;

function record(
	value: unknown,
	keys: readonly string[],
	label: string
): asserts value is Record<string, unknown> {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error(`Invalid GCC WASI ${label}`);
}

function inputPath(value: unknown, absolute: boolean, limits: Limits): asserts value is string {
	if (
		typeof value !== 'string' ||
		!value ||
		invalidText(value) ||
		value.startsWith('/') !== absolute ||
		(value !== '/' &&
			value
				.split('/')
				.slice(absolute ? 1 : 0)
				.some((part) => !part || part === '.' || part === '..'))
	)
		throw new Error('Invalid GCC WASI filesystem path');
	if (encoder.encode(value).length > limits.maxPathBytes)
		throw new Error('GCC WASI filesystem path exceeds maxPathBytes');
}

/** Account for live inodes, including files unlinked while a guest still holds an fd. */
class Budget {
	readonly nodes = new Map<Inode, { linked: boolean; opens: number }>();
	bytes = 0;
	opens = 0;
	constructor(readonly limits: Limits) {}
	add(node: Inode) {
		if (this.nodes.size >= this.limits.maxEntries) return wasi.ERRNO_NOSPC;
		if (
			node instanceof File &&
			(node.data.length > this.limits.maxFileBytes ||
				this.bytes + node.data.length > this.limits.maxTotalBytes)
		)
			return wasi.ERRNO_NOSPC;
		this.nodes.set(node, { linked: true, opens: 0 });
		if (node instanceof File) this.bytes += node.data.length;
		return 0;
	}
	open(node: Inode) {
		if (this.opens >= this.limits.maxOpenFiles) return wasi.ERRNO_MFILE;
		this.nodes.get(node)!.opens++;
		this.opens++;
		return 0;
	}
	close(node: Inode) {
		this.nodes.get(node)!.opens--;
		this.opens--;
		this.collect(node);
	}
	unlink(node: Inode) {
		this.nodes.get(node)!.linked = false;
		this.collect(node);
	}
	private collect(node: Inode) {
		const state = this.nodes.get(node)!;
		if (!state.linked && !state.opens) {
			this.nodes.delete(node);
			if (node instanceof File) this.bytes -= node.data.length;
		}
	}
	resize(file: File, size: bigint) {
		if (size < 0n) return wasi.ERRNO_INVAL;
		if (
			size > BigInt(this.limits.maxFileBytes) ||
			BigInt(this.bytes - file.data.length) + size > BigInt(this.limits.maxTotalBytes)
		)
			return wasi.ERRNO_NOSPC;
		return 0;
	}
}

class MemoryFileFd extends OpenFile {
	private closed = false;
	constructor(
		file: File,
		private readonly budget: Budget,
		private readonly readOnly: boolean,
		private readonly rights: bigint,
		private flags: number
	) {
		super(file);
	}
	private writeError() {
		return this.closed
			? wasi.ERRNO_BADF
			: this.readOnly
				? wasi.ERRNO_ROFS
				: !(this.rights & BigInt(wasi.RIGHTS_FD_WRITE))
					? wasi.ERRNO_BADF
					: 0;
	}
	override fd_close() {
		if (this.closed) return wasi.ERRNO_BADF;
		this.closed = true;
		this.budget.close(this.file);
		return 0;
	}
	override fd_fdstat_get() {
		const result = super.fd_fdstat_get();
		if (result.fdstat) {
			result.fdstat.fs_rights_base = this.rights;
			result.fdstat.fs_flags = this.flags;
		}
		return result;
	}
	override fd_fdstat_set_flags(flags: number) {
		if (flags & ~supportedFdFlags) return wasi.ERRNO_NOTSUP;
		this.flags = flags;
		return 0;
	}
	override fd_read(size: number) {
		if (this.closed || !(this.rights & BigInt(wasi.RIGHTS_FD_READ)))
			return { ret: wasi.ERRNO_BADF, data: new Uint8Array() };
		return super.fd_read(size);
	}
	override fd_pread(size: number, offset: bigint) {
		if (this.closed || !(this.rights & BigInt(wasi.RIGHTS_FD_READ)))
			return { ret: wasi.ERRNO_BADF, data: new Uint8Array() };
		if (offset < 0n) return { ret: wasi.ERRNO_INVAL, data: new Uint8Array() };
		return super.fd_pread(size, offset);
	}
	override fd_filestat_set_size(size: bigint) {
		const ret = this.writeError() || this.budget.resize(this.file, size);
		if (ret) return ret;
		const before = this.file.data.length;
		const result = super.fd_filestat_set_size(size);
		this.budget.bytes += this.file.data.length - before;
		return result;
	}
	override fd_allocate(offset: bigint, len: bigint) {
		const ret = this.writeError();
		if (ret) return ret;
		if (offset < 0n || len < 0n) return wasi.ERRNO_INVAL;
		return this.fd_filestat_set_size(
			offset + len > this.file.size ? offset + len : this.file.size
		);
	}
	override fd_pwrite(data: Uint8Array, offset: bigint) {
		const end = offset + BigInt(data.length);
		const ret =
			this.writeError() ||
			(offset < 0n
				? wasi.ERRNO_INVAL
				: this.budget.resize(this.file, end > this.file.size ? end : this.file.size));
		if (ret) return { ret, nwritten: 0 };
		if (!data.length) return { ret: 0, nwritten: 0 };
		const before = this.file.data.length;
		const result = super.fd_pwrite(data, offset);
		this.budget.bytes += this.file.data.length - before;
		return result;
	}
	override fd_write(data: Uint8Array) {
		const offset = this.flags & wasi.FDFLAGS_APPEND ? this.file.size : this.file_pos;
		const result = this.fd_pwrite(data, offset);
		if (!result.ret) this.file_pos = offset + BigInt(result.nwritten);
		return result;
	}
}

class MemoryDirectoryFd extends OpenDirectory {
	private closed = false;
	constructor(
		dir: Directory,
		private readonly budget: Budget,
		private readonly readOnly: boolean,
		private readonly absolutePath: string,
		private readonly preopen = false
	) {
		super(dir);
	}
	override fd_close() {
		if (this.closed) return wasi.ERRNO_BADF;
		this.closed = true;
		this.budget.close(this.dir);
		return 0;
	}
	override fd_fdstat_get() {
		const result = super.fd_fdstat_get();
		if (result.fdstat) {
			// wasi-libc intersects requested file rights with the parent's inherited
			// rights. The shim advertises zero, which would turn fopen("r") unreadable.
			result.fdstat.fs_rights_base = directoryRights;
			result.fdstat.fs_rights_inherited = directoryRights | fileRights;
		}
		return result;
	}
	override fd_prestat_get() {
		return this.preopen
			? { ret: 0, prestat: wasi.Prestat.dir(this.absolutePath) }
			: super.fd_prestat_get();
	}
	override fd_readdir_single(cookie: bigint) {
		if (this.closed) return { ret: wasi.ERRNO_BADF, dirent: null };
		// Wasm i64 arguments arrive signed; Preview 1 directory cookies are u64.
		return super.fd_readdir_single(BigInt.asUintN(64, cookie));
	}
	private locate(path: string) {
		const fail = (ret: number) => ({
			ret,
			parent: undefined,
			name: '',
			entry: undefined,
			absolute: '',
			directory: false
		});
		if (this.closed) return fail(wasi.ERRNO_BADF);
		if (!path) return fail(wasi.ERRNO_NOENT);
		if (invalidText(path)) return fail(wasi.ERRNO_INVAL);
		if (path.startsWith('/')) return fail(wasi.ERRNO_NOTCAPABLE);
		// Bound lookup text separately: './' does not make the resulting path longer.
		if (path.length > Math.max(4096, this.budget.limits.maxPathBytes))
			return fail(wasi.ERRNO_NAMETOOLONG);
		const parts: string[] = [];
		const components = path.split('/').filter(Boolean);
		const traversed = [this.dir];
		for (const [index, part] of components.entries()) {
			if (!part || part === '.') continue;
			if (part === '..') {
				if (!parts.length) return fail(wasi.ERRNO_NOTCAPABLE);
				parts.pop();
				traversed.pop();
			} else {
				parts.push(part);
				if (index < components.length - 1) {
					const child = traversed.at(-1)!.contents.get(part);
					if (!child) return fail(wasi.ERRNO_NOENT);
					if (!(child instanceof Directory)) return fail(wasi.ERRNO_NOTDIR);
					traversed.push(child);
				}
			}
		}
		const absolute = parts.length
			? join(this.absolutePath, parts.join('/'))
			: this.absolutePath;
		if (encoder.encode(absolute).length > this.budget.limits.maxPathBytes)
			return fail(wasi.ERRNO_NAMETOOLONG);
		let parent = this.dir;
		for (const part of parts.slice(0, -1)) {
			const next = parent.contents.get(part);
			if (!next) return fail(wasi.ERRNO_NOENT);
			if (!(next instanceof Directory)) return fail(wasi.ERRNO_NOTDIR);
			parent = next;
		}
		const name = parts.at(-1) ?? '';
		const entry = name ? parent.contents.get(name) : this.dir;
		const directory =
			path.endsWith('/') || path.endsWith('/.') || path.endsWith('/..') || path === '.';
		if (directory && entry && !(entry instanceof Directory)) return fail(wasi.ERRNO_NOTDIR);
		return {
			ret: 0,
			parent,
			name,
			entry,
			absolute,
			directory
		};
	}
	private mutate() {
		return this.closed
			? wasi.ERRNO_BADF
			: this.readOnly
				? wasi.ERRNO_ROFS
				: !this.budget.nodes.get(this.dir)?.linked
					? wasi.ERRNO_NOENT
					: 0;
	}
	override path_lookup(path: string, _flags: number) {
		const found = this.locate(path);
		return {
			ret: found.ret || (!found.entry ? wasi.ERRNO_NOENT : 0),
			inode_obj: found.entry ?? null
		};
	}
	override path_filestat_get(flags: number, path: string) {
		const result = this.path_lookup(path, flags);
		return { ret: result.ret, filestat: result.inode_obj?.stat() ?? null };
	}
	override path_open(
		_dirflags: number,
		path: string,
		oflags: number,
		rights: bigint,
		_inheriting: bigint,
		fdflags: number
	): { ret: number; fd_obj: Fd | null } {
		const failure = (ret: number) => ({ ret, fd_obj: null });
		const found = this.locate(path);
		if (found.ret) return failure(found.ret);
		const writing = Boolean(rights & BigInt(wasi.RIGHTS_FD_WRITE));
		if (oflags & (wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC) || writing) {
			const ret = this.mutate();
			if (ret) return failure(ret);
		}
		if (fdflags & ~supportedFdFlags) return failure(wasi.ERRNO_NOTSUP);
		if (oflags & wasi.OFLAGS_TRUNC && !writing) return failure(wasi.ERRNO_BADF);
		if (oflags & wasi.OFLAGS_DIRECTORY && (writing || oflags & wasi.OFLAGS_TRUNC))
			return failure(wasi.ERRNO_ISDIR);
		if (this.budget.opens >= this.budget.limits.maxOpenFiles) return failure(wasi.ERRNO_MFILE);
		let entry = found.entry;
		if (!entry) {
			if (!(oflags & wasi.OFLAGS_CREAT)) return failure(wasi.ERRNO_NOENT);
			if (found.directory && !(oflags & wasi.OFLAGS_DIRECTORY))
				return failure(wasi.ERRNO_NOTDIR);
			entry =
				oflags & wasi.OFLAGS_DIRECTORY
					? new Directory(new Map())
					: new File(new Uint8Array());
			const ret = this.budget.add(entry);
			if (ret) return failure(ret);
			found.parent!.contents.set(found.name, entry);
		} else if (oflags & wasi.OFLAGS_CREAT && oflags & wasi.OFLAGS_EXCL)
			return failure(wasi.ERRNO_EXIST);
		if (entry instanceof Directory) {
			if (oflags & wasi.OFLAGS_TRUNC || writing) return failure(wasi.ERRNO_ISDIR);
			this.budget.open(entry);
			return {
				ret: 0,
				fd_obj: new MemoryDirectoryFd(entry, this.budget, this.readOnly, found.absolute)
			};
		}
		if (!(entry instanceof File)) return failure(wasi.ERRNO_NOTSUP);
		if (oflags & wasi.OFLAGS_DIRECTORY) return failure(wasi.ERRNO_NOTDIR);
		this.budget.open(entry);
		const fd = new MemoryFileFd(entry, this.budget, this.readOnly, rights, fdflags);
		if (oflags & wasi.OFLAGS_TRUNC) fd.fd_filestat_set_size(0n);
		return { ret: 0, fd_obj: fd };
	}
	override path_create_directory(path: string) {
		const error = this.mutate();
		if (error) return error;
		const found = this.locate(path);
		if (found.ret) return found.ret;
		if (found.entry) return wasi.ERRNO_EXIST;
		const node = new Directory(new Map());
		const ret = this.budget.add(node);
		if (!ret) found.parent!.contents.set(found.name, node);
		return ret;
	}
	private remove(path: string, directory: boolean) {
		const error = this.mutate();
		if (error) return error;
		const found = this.locate(path);
		if (found.ret) return found.ret;
		if (!found.entry) return wasi.ERRNO_NOENT;
		if (!found.name) return wasi.ERRNO_NOTCAPABLE;
		if (directory && !(found.entry instanceof Directory)) return wasi.ERRNO_NOTDIR;
		if (!directory && found.entry instanceof Directory) return wasi.ERRNO_ISDIR;
		if (found.entry instanceof Directory && found.entry.contents.size)
			return wasi.ERRNO_NOTEMPTY;
		found.parent!.contents.delete(found.name);
		this.budget.unlink(found.entry);
		return 0;
	}
	override path_unlink_file(path: string) {
		return this.remove(path, false);
	}
	override path_remove_directory(path: string) {
		return this.remove(path, true);
	}
	// The shim implements rename using link/unlink. Disable both together: partial
	// renames and cross-mount aliases would bypass mount permissions and accounting.
	override path_link(_path: string, _inode: Inode, _allowDir: boolean) {
		return this.mutate() || wasi.ERRNO_NOTSUP;
	}
	override path_unlink(_path: string) {
		return { ret: this.mutate() || wasi.ERRNO_NOTSUP, inode_obj: null };
	}
}

export function createGccWasiFilesystem(
	preopens: readonly WasiGccPreopen[] = [],
	requested: WasiGccFilesystemLimits = {}
) {
	record(requested, Object.keys(defaults), 'filesystem limits');
	const limits = { ...defaults, ...requested };
	for (const [key, value] of Object.entries(limits))
		if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff)
			throw new Error(`Invalid GCC WASI filesystem ${key}`);
	if (
		!Array.isArray(preopens) ||
		preopens.length > limits.maxEntries ||
		preopens.length > limits.maxOpenFiles
	)
		throw new Error('Invalid GCC WASI preopens or filesystem limit');
	const budget = new Budget(limits);
	const mounts: { path: string; dir: Directory; readonly: boolean }[] = [];
	const ensure = (ret: number) => {
		if (ret) throw new Error('GCC WASI filesystem exceeds its entry or byte limit');
	};
	for (const mount of preopens) {
		record(mount, ['path', 'readonly', 'files', 'directories'], 'preopen');
		inputPath(mount.path, true, limits);
		const mountPath = mount.path;
		if (mount.readonly !== undefined && typeof mount.readonly !== 'boolean')
			throw new Error('Invalid GCC WASI preopen readonly flag');
		if (
			mounts.some(
				({ path }) =>
					path === '/' ||
					mountPath === '/' ||
					path === mountPath ||
					path.startsWith(`${mountPath}/`) ||
					mountPath.startsWith(`${path}/`)
			)
		)
			throw new Error('GCC WASI preopen paths overlap');
		const files = mount.files ?? [];
		const directories = mount.directories ?? [];
		if (
			!Array.isArray(files) ||
			!Array.isArray(directories) ||
			files.length + directories.length > limits.maxEntries
		)
			throw new Error('Invalid GCC WASI preopen entries');
		const root = new Directory(new Map());
		ensure(budget.add(root));
		const directory = (parts: string[]) => {
			let current = root;
			for (const part of parts) {
				let child = current.contents.get(part);
				if (!child) {
					child = new Directory(new Map());
					ensure(budget.add(child));
					current.contents.set(part, child);
				}
				if (!(child instanceof Directory))
					throw new Error('GCC WASI file/directory collision');
				current = child;
			}
			return current;
		};
		const paths = new Set<string>();
		const validate = (path: unknown) => {
			inputPath(path, false, limits);
			inputPath(join(mountPath, path), true, limits);
			if (paths.has(path)) throw new Error('Duplicate GCC WASI filesystem path');
			paths.add(path);
			return path.split('/');
		};
		for (const path of directories) directory(validate(path));
		for (const file of files) {
			record(file, ['path', 'contents'], 'input file');
			const parts = validate(file.path);
			const parent = directory(parts.slice(0, -1));
			const name = parts.at(-1)!;
			if (parent.contents.has(name)) throw new Error('GCC WASI file/directory collision');
			if (typeof file.contents !== 'string' && !(file.contents instanceof Uint8Array))
				throw new Error('Invalid GCC WASI input file contents');
			if (
				file.contents.length > limits.maxFileBytes ||
				budget.bytes + file.contents.length > limits.maxTotalBytes
			)
				throw new Error('GCC WASI input file exceeds its byte limit');
			const data =
				typeof file.contents === 'string' ? encoder.encode(file.contents) : file.contents;
			if (
				data.length > limits.maxFileBytes ||
				budget.bytes + data.length > limits.maxTotalBytes
			)
				throw new Error('GCC WASI input file exceeds its byte limit');
			const node = new File(Uint8Array.from(data), { readonly: mount.readonly ?? false });
			ensure(budget.add(node));
			parent.contents.set(name, node);
		}
		mounts.push({ path: mount.path, dir: root, readonly: mount.readonly ?? false });
	}
	const fds: Fd[] = mounts.map((mount) => {
		budget.open(mount.dir);
		return new MemoryDirectoryFd(mount.dir, budget, mount.readonly, mount.path, true);
	});
	return {
		fds,
		files(): WasiGccResultFile[] {
			const files: WasiGccResultFile[] = [];
			const pending = mounts.map(({ path, dir }) => ({ path, node: dir as Inode }));
			while (pending.length) {
				const { path, node } = pending.pop()!;
				if (node instanceof File)
					files.push({ path, contents: Uint8Array.from(node.data) });
				else if (node instanceof Directory)
					for (const [name, child] of node.contents)
						pending.push({ path: join(path, name), node: child });
			}
			return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		}
	};
}
