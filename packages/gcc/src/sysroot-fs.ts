import type { GccFileSystem, GccFileSystemNode } from './module-loader.js';

/** Verified sysroot entries. Files are views of the extracted archive bytes. */
export type GccSysrootDirectory = Map<string, GccSysrootDirectory | Uint8Array>;

interface SysrootNode extends GccFileSystemNode {
	contents: GccSysrootDirectory | Uint8Array;
}

interface SysrootStream {
	node: SysrootNode;
	position: number;
}

// Emscripten errno values (wasi-libc numbering), as used by its own MEMFS and WORKERFS.
const EINVAL = 28,
	ENOENT = 44,
	EROFS = 69;
const directoryMode = 0o40555,
	fileMode = 0o100444;

// Emscripten 4 skips directory checks for dot components and trailing slashes.
export function requireGccDirectoryTraversal(fs: GccFileSystem) {
	const lookup = fs.lookupPath?.bind(fs);
	if (!lookup) return;
	fs.lookupPath = (path, options) => {
		if (path?.includes('/.')) {
			for (const dot of path.matchAll(/\/\.{1,2}(?=\/|$)/g)) {
				if (!dot.index) continue;
				// Follow intermediate mount points and links using this stage's own FS.
				const { node } = lookup(path.slice(0, dot.index), { follow: true });
				if (!node || (node.mode & 0o170000) !== 0o040000) throw new fs.ErrnoError(54); // ENOTDIR
			}
		}
		if (path?.endsWith('/') && !options?.parent) {
			// A trailing slash follows a final symlink and requires its target to exist.
			const result = lookup(path, { ...options, follow: true, noent_okay: false });
			if (!result.node || (result.node.mode & 0o170000) !== 0o040000)
				throw new fs.ErrnoError(54); // ENOTDIR
			return result;
		}
		return lookup(path, options);
	};
}

/**
 * GCC accepts a .gch directory of variants. libcpp opens it, enumerates the variants,
 * opens the selected candidate and closes the directory before parsing more source.
 * Publish the candidate only during that scan. Opening a directory as an ordinary
 * header fails in GCC, and a direct request for its child never sees the cache bytes.
 */
export function mountGccPch(fs: GccFileSystem, directory: string, bytes: Uint8Array) {
	fs.mkdirTree(directory);
	const node = fs.lookupPath?.(directory).node;
	if (!node?.node_ops || !node.stream_ops)
		throw new Error('GCC PCH requires a compiler directory');
	const ops = node.node_ops as { readdir(node: GccFileSystemNode): string[] };
	const streams = node.stream_ops as { close?(stream: unknown): void };
	const path = directory + '/cached';
	let visible = false;
	node.node_ops = {
		...ops,
		readdir(dir: GccFileSystemNode) {
			if (!visible) {
				fs.writeFile(path, bytes, { canOwn: true });
				visible = true;
			}
			return ops.readdir(dir);
		}
	};
	node.stream_ops = {
		...streams,
		close(stream: unknown) {
			if (visible) {
				fs.unlink(path);
				visible = false;
			}
			streams.close?.(stream);
		}
	};
}

/** Build once per compiler; `files` and `directories` are already validated absolute paths. */
export function gccSysrootTree(
	files: ReadonlyMap<string, Uint8Array>,
	directories: Iterable<string>,
	root: string
): GccSysrootDirectory {
	const tree: GccSysrootDirectory = new Map();
	function directory(path: string) {
		let current = tree;
		for (const name of path.slice(root.length).split('/').filter(Boolean)) {
			let next = current.get(name);
			if (!next) current.set(name, (next = new Map()));
			current = next as GccSysrootDirectory;
		}
		return current;
	}
	for (const path of directories) directory(path);
	for (const [path, bytes] of files) {
		const slash = path.lastIndexOf('/');
		directory(path.slice(0, slash)).set(path.slice(slash + 1), bytes);
	}
	return tree;
}

/**
 * Expose the shared sysroot read-only in one tool's Emscripten FS. Copying every file into
 * MEMFS dominated the assembler/linker stages; nodes are now created only for paths the tool
 * looks up, and the read-only modes keep one tool from changing bytes seen by the next.
 * No `mmap` operation is provided: GCC maps files only to restore PCH, which the sysroot lacks.
 */
export function mountGccSysroot(
	FS: GccFileSystem,
	tree: GccSysrootDirectory,
	mountpoint: string,
	timestamp: number
) {
	// Include-path probing makes most lookups miss; reuse one error like MEMFS does.
	const missing = new FS.ErrnoError(ENOENT);
	const readOnly = () => {
		throw new FS.ErrnoError(EROFS);
	};
	const size = (node: SysrootNode) =>
		node.contents instanceof Map ? 4096 : node.contents.byteLength;
	const nodeOps = {
		getattr(node: SysrootNode) {
			const bytes = size(node);
			return {
				dev: 1,
				ino: node.id,
				mode: node.mode,
				nlink: 1,
				uid: 0,
				gid: 0,
				rdev: 0,
				size: bytes,
				atime: new Date(node.atime),
				mtime: new Date(node.mtime),
				ctime: new Date(node.ctime),
				blksize: 4096,
				blocks: Math.ceil(bytes / 4096)
			};
		},
		lookup(parent: SysrootNode, name: string) {
			const contents = (parent.contents as GccSysrootDirectory).get(name);
			if (contents === undefined) throw missing;
			return create(parent, name, contents);
		},
		readdir: (node: SysrootNode) => [
			'.',
			'..',
			...(node.contents as GccSysrootDirectory).keys()
		],
		setattr: readOnly,
		mknod: readOnly,
		rename: readOnly,
		unlink: readOnly,
		rmdir: readOnly,
		symlink: readOnly
	};
	const streamOps = {
		read(
			stream: SysrootStream,
			buffer: Uint8Array,
			offset: number,
			length: number,
			position: number
		) {
			const chunk = (stream.node.contents as Uint8Array).subarray(
				position,
				position + length
			);
			buffer.set(chunk, offset);
			return chunk.byteLength;
		},
		llseek(stream: SysrootStream, offset: number, whence: number) {
			// SEEK_SET, SEEK_CUR or SEEK_END.
			const position =
				offset + (whence === 1 ? stream.position : whence === 2 ? size(stream.node) : 0);
			if (position < 0) throw new FS.ErrnoError(EINVAL);
			return position;
		}
	};
	function create(
		parent: SysrootNode | null,
		name: string,
		contents: GccSysrootDirectory | Uint8Array
	) {
		const node = FS.createNode(
			parent,
			name,
			contents instanceof Map ? directoryMode : fileMode,
			0
		) as SysrootNode;
		node.contents = contents;
		node.node_ops = nodeOps;
		node.stream_ops = streamOps;
		node.atime = node.mtime = node.ctime = timestamp;
		return node;
	}
	FS.mkdirTree(mountpoint);
	FS.mount({ mount: () => create(null, '/', tree) }, {}, mountpoint);
}
