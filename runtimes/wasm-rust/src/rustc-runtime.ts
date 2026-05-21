import {
	Directory,
	Fd,
	File,
	Inode,
	OpenFile,
	OpenDirectory,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';

import type { NormalizedRuntimeManifest } from './runtime-manifest.js';
import type { SharedRuntimeAssetFile } from './worker-protocol.js';

const BITCODE_LENGTH_INDEX = 0;
const BITCODE_OVERFLOW_INDEX = 1;
const BITCODE_WRITE_SEQUENCE_INDEX = 2;
const BITCODE_HEADER_LENGTH = 16;
const RUSTC_STRING_GROW_BY_IMPORT =
	'_ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE9__grow_byEmmmmmm';

export const DEFAULT_RUSTC_ENV = ['RUST_MIN_STACK=8388608'];

export class CaptureFd extends Fd {
	ino!: bigint;
	private readonly decoder = new TextDecoder();
	private readonly chunks: string[] = [];
	private readonly output: ((chunk: string) => void) | null;

	constructor(output: ((chunk: string) => void) | null = null) {
		super();
		this.ino = Inode.issue_ino();
		this.output = output;
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_write(data: Uint8Array) {
		const chunk = this.decoder.decode(data, { stream: true });
		this.chunks.push(chunk);
		this.output?.(chunk);
		return {
			ret: wasi.ERRNO_SUCCESS,
			nwritten: data.byteLength
		};
	}

	getText() {
		const trailing = this.decoder.decode();
		if (trailing) {
			this.chunks.push(trailing);
			this.output?.(trailing);
		}
		return this.chunks.join('');
	}
}

class OpenMirroredBitcodeFile extends Fd {
	private position = 0n;
	private readonly file: MirroredBitcodeFile;

	constructor(file: MirroredBitcodeFile) {
		super();
		this.file = file;
	}

	fd_allocate(offset: bigint, len: bigint) {
		if (Number(offset + len) > this.file.capacity) {
			Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
			return wasi.ERRNO_NOSPC;
		}
		return wasi.ERRNO_SUCCESS;
	}

	fd_fdstat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat: new wasi.Fdstat(wasi.FILETYPE_REGULAR_FILE, 0)
		};
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: this.file.stat()
		};
	}

	fd_filestat_set_size(size: bigint) {
		if (Number(size) > this.file.capacity) {
			Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
			return wasi.ERRNO_NOSPC;
		}
		if (Number(size) < Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) {
			this.file.bytes.fill(0, Number(size), Atomics.load(this.file.state, BITCODE_LENGTH_INDEX));
		}
		Atomics.store(this.file.state, BITCODE_LENGTH_INDEX, Number(size));
		Atomics.add(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
		Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
		return wasi.ERRNO_SUCCESS;
	}

	fd_read(size: number) {
		const end = Math.min(
			Atomics.load(this.file.state, BITCODE_LENGTH_INDEX),
			Number(this.position) + size
		);
		const data = this.file.bytes.slice(Number(this.position), end);
		this.position = BigInt(end);
		return {
			ret: wasi.ERRNO_SUCCESS,
			data
		};
	}

	fd_pread(size: number, offset: bigint) {
		const end = Math.min(Atomics.load(this.file.state, BITCODE_LENGTH_INDEX), Number(offset) + size);
		return {
			ret: wasi.ERRNO_SUCCESS,
			data: this.file.bytes.slice(Number(offset), end)
		};
	}

	fd_seek(offset: bigint, whence: number) {
		let nextPosition = this.position;
		if (whence === wasi.WHENCE_SET) {
			nextPosition = offset;
		} else if (whence === wasi.WHENCE_CUR) {
			nextPosition = this.position + offset;
		} else if (whence === wasi.WHENCE_END) {
			nextPosition = BigInt(Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) + offset;
		}
		if (nextPosition < 0n) {
			return {
				ret: wasi.ERRNO_INVAL,
				offset: 0n
			};
		}
		this.position = nextPosition;
		return {
			ret: wasi.ERRNO_SUCCESS,
			offset: this.position
		};
	}

	fd_tell() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			offset: this.position
		};
	}

	fd_write(data: Uint8Array) {
		const nextLength = Number(this.position) + data.byteLength;
		if (nextLength > this.file.capacity) {
			Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
			return {
				ret: wasi.ERRNO_NOSPC,
				nwritten: 0
			};
		}
		this.file.bytes.set(data, Number(this.position));
		this.position = BigInt(nextLength);
		if (nextLength > Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) {
			Atomics.store(this.file.state, BITCODE_LENGTH_INDEX, nextLength);
		}
		Atomics.add(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
		Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
		return {
			ret: wasi.ERRNO_SUCCESS,
			nwritten: data.byteLength
		};
	}

	fd_pwrite(data: Uint8Array, offset: bigint) {
		const nextLength = Number(offset) + data.byteLength;
		if (nextLength > this.file.capacity) {
			Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
			return {
				ret: wasi.ERRNO_NOSPC,
				nwritten: 0
			};
		}
		this.file.bytes.set(data, Number(offset));
		if (nextLength > Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) {
			Atomics.store(this.file.state, BITCODE_LENGTH_INDEX, nextLength);
		}
		Atomics.add(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
		Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
		return {
			ret: wasi.ERRNO_SUCCESS,
			nwritten: data.byteLength
		};
	}

	fd_sync() {
		Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
		return wasi.ERRNO_SUCCESS;
	}
}

export class MirroredBitcodeFile extends Inode {
	readonly state: Int32Array;
	readonly bytes: Uint8Array;
	readonly capacity: number;

	constructor(sharedBuffer: SharedArrayBuffer) {
		super();
		this.state = new Int32Array(sharedBuffer, 0, BITCODE_HEADER_LENGTH / 4);
		this.bytes = new Uint8Array(sharedBuffer, BITCODE_HEADER_LENGTH);
		this.capacity = this.bytes.byteLength;
	}

	replaceWith(data: Uint8Array) {
		if (data.byteLength > this.capacity) {
			Atomics.store(this.state, BITCODE_OVERFLOW_INDEX, 1);
			return wasi.ERRNO_NOSPC;
		}
		this.bytes.fill(0, 0, Atomics.load(this.state, BITCODE_LENGTH_INDEX));
		this.bytes.set(data, 0);
		Atomics.store(this.state, BITCODE_LENGTH_INDEX, data.byteLength);
		Atomics.store(this.state, BITCODE_OVERFLOW_INDEX, 0);
		Atomics.add(this.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
		Atomics.notify(this.state, BITCODE_WRITE_SEQUENCE_INDEX);
		return wasi.ERRNO_SUCCESS;
	}

	path_open(oflags: number) {
		if ((oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC) {
			this.bytes.fill(0, 0, Atomics.load(this.state, BITCODE_LENGTH_INDEX));
			Atomics.store(this.state, BITCODE_LENGTH_INDEX, 0);
			Atomics.store(this.state, BITCODE_OVERFLOW_INDEX, 0);
			Atomics.add(this.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
			Atomics.notify(this.state, BITCODE_WRITE_SEQUENCE_INDEX);
		}
		return {
			ret: wasi.ERRNO_SUCCESS,
			fd_obj: new OpenMirroredBitcodeFile(this)
		};
	}

	stat() {
		return new wasi.Filestat(
			this.ino,
			wasi.FILETYPE_REGULAR_FILE,
			BigInt(Atomics.load(this.state, BITCODE_LENGTH_INDEX))
		);
	}
}

export function readMirroredBitcode(sharedBuffer: SharedArrayBuffer) {
	const state = new Int32Array(sharedBuffer, 0, BITCODE_HEADER_LENGTH / 4);
	const bytes = new Uint8Array(sharedBuffer, BITCODE_HEADER_LENGTH);
	const length = Atomics.load(state, BITCODE_LENGTH_INDEX);
	return {
		length,
		overflowed: Atomics.load(state, BITCODE_OVERFLOW_INDEX) === 1,
		writeSequence: Atomics.load(state, BITCODE_WRITE_SEQUENCE_INDEX),
		bytes: bytes.slice(0, length)
	};
}

export function createSharedSafeRandomGet(memory: WebAssembly.Memory) {
	return (pointer: number, length: number) => {
		const target = new Uint8Array(memory.buffer, pointer, length);
		const randomBytes = new Uint8Array(length);
		crypto.getRandomValues(randomBytes);
		target.set(randomBytes);
		return wasi.ERRNO_SUCCESS;
	};
}

class MirroredBitcodeOpenDirectory extends OpenDirectory {
	private readonly mirroredBitcodePath: string;

	constructor(dir: Directory, mirroredBitcodePath: string) {
		super(dir);
		this.mirroredBitcodePath = mirroredBitcodePath;
	}

	private resolveMirroredBitcodeFile(pathStr: string) {
		if (pathStr !== this.mirroredBitcodePath) {
			return null;
		}
		const segments = pathStr.split('/').filter(Boolean);
		let entry: Inode | undefined = this.dir;
		for (const segment of segments) {
			if (!(entry instanceof Directory)) {
				return null;
			}
			entry = entry.contents.get(segment);
		}
		return entry instanceof MirroredBitcodeFile ? entry : null;
	}

	path_link(pathStr: string, inode: Inode, allowDir: boolean) {
		const mirrored = this.resolveMirroredBitcodeFile(pathStr);
		if (mirrored instanceof MirroredBitcodeFile && inode instanceof File) {
			return mirrored.replaceWith(inode.data);
		}
		return super.path_link(pathStr, inode, allowDir);
	}

	path_unlink(pathStr: string) {
		const mirrored = this.resolveMirroredBitcodeFile(pathStr);
		if (mirrored instanceof MirroredBitcodeFile) {
			return {
				ret: wasi.ERRNO_SUCCESS,
				inode_obj: mirrored
			};
		}
		return super.path_unlink(pathStr);
	}

	path_unlink_file(pathStr: string) {
		if (this.resolveMirroredBitcodeFile(pathStr) instanceof MirroredBitcodeFile) {
			return wasi.ERRNO_SUCCESS;
		}
		return super.path_unlink_file(pathStr);
	}
}

class MirroredBitcodePreopenDirectory extends MirroredBitcodeOpenDirectory {
	private readonly prestatName: string;

	constructor(name: string, dir: Directory, mirroredBitcodePath: string) {
		super(dir, mirroredBitcodePath);
		this.prestatName = name;
	}

	fd_prestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			prestat: wasi.Prestat.dir(this.prestatName)
		};
	}
}

class MirroredBitcodeDirectory extends Directory {
	private readonly mirroredBitcodePath: string;

	constructor(contents: Map<string, Inode>, mirroredBitcodePath: string) {
		super(contents);
		this.mirroredBitcodePath = mirroredBitcodePath;
	}

	path_open(oflags: number) {
		return {
			ret: wasi.ERRNO_SUCCESS,
			fd_obj: new MirroredBitcodeOpenDirectory(this, this.mirroredBitcodePath)
		};
	}
}

export async function buildPreopenedDirectories(
	manifest: NormalizedRuntimeManifest,
	sysrootAssets: SharedRuntimeAssetFile[],
	sourceCode: string,
	sharedBitcodeBuffer: SharedArrayBuffer
) {
	const sysrootRoot = new Directory(new Map());
	for (const entry of sysrootAssets) {
		const runtimeSegments = entry.runtimePath.replace(/^\/+/, '').split('/');
		let directory = sysrootRoot;
		for (const segment of runtimeSegments.slice(0, -1)) {
			const existing = directory.contents.get(segment);
			if (existing instanceof Directory) {
				directory = existing;
				continue;
			}
			const nextDirectory = new Directory(new Map());
			directory.contents.set(segment, nextDirectory);
			directory = nextDirectory;
		}
		directory.contents.set(
			runtimeSegments.at(-1)!,
			new File(new Uint8Array(entry.buffer), { readonly: true })
		);
	}

	const workRoot = new MirroredBitcodeDirectory(
		new Map<string, Inode>([
			['main.rs', new File(new TextEncoder().encode(sourceCode))],
			[manifest.compiler.workerBitcodeFile, new MirroredBitcodeFile(sharedBitcodeBuffer)]
		]),
		manifest.compiler.workerBitcodeFile
	);
	const rootDirectory = new Directory(
		new Map<string, Inode>([
			['sysroot', sysrootRoot],
			['work', workRoot]
		])
	);
	const stdout = new CaptureFd();
	const stderr = new CaptureFd();
	const workDirectory = new MirroredBitcodePreopenDirectory(
		'/work',
		workRoot,
		manifest.compiler.workerBitcodeFile
	);
	const rootPreopenDirectory = new MirroredBitcodePreopenDirectory(
		'/',
		rootDirectory,
		`work/${manifest.compiler.workerBitcodeFile}`
	);

	return {
		stdout,
		stderr,
		fds: [
			new OpenFile(new File(new Uint8Array(), { readonly: true })),
			stdout,
			stderr,
			new PreopenDirectory('/tmp', new Map()),
			new PreopenDirectory('/sysroot', sysrootRoot.contents),
			workDirectory,
			rootPreopenDirectory
		]
	};
}

export async function instantiateRustcInstance({
	rustcModule,
	memory,
	args,
	env = DEFAULT_RUSTC_ENV,
	fds,
	threadSpawner
}: {
	rustcModule: WebAssembly.Module;
	memory: WebAssembly.Memory;
	args: string[];
	env?: string[];
	fds: Fd[];
	threadSpawner: (startArg: number) => number;
}) {
	const wasiInstance = new WASI(args, env, fds, { debug: false });
	wasiInstance.wasiImport.random_get = createSharedSafeRandomGet(memory);
	const instance = await WebAssembly.instantiate(rustcModule, {
		env: {
			memory,
			[RUSTC_STRING_GROW_BY_IMPORT]: () => {}
		},
		wasi: {
			'thread-spawn': threadSpawner
		},
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	wasiInstance.inst = instance as any;
	return { instance, wasiInstance };
}
