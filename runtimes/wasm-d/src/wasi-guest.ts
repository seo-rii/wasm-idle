import {
	Directory,
	Fd,
	File,
	Inode,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';

export function normalizeGuestPath(value: string) {
	const normalized = value.replace(/\\/g, '/');
	const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
	const segments: string[] = [];
	for (const segment of absolute.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..')
			throw new Error(`wasm-d does not allow guest path traversal: ${value}`);
		segments.push(segment);
	}
	return `/${segments.join('/')}`;
}

export function toStandaloneBytes(value: string | Uint8Array | ArrayBuffer) {
	if (typeof value === 'string') return new TextEncoder().encode(value);
	if (value instanceof Uint8Array) return new Uint8Array(value);
	return new Uint8Array(value);
}

export class CaptureFd extends Fd {
	ino = Inode.issue_ino();
	private readonly decoder = new TextDecoder();
	private readonly chunks: string[] = [];
	private readonly output: ((chunk: string) => void) | undefined;

	constructor(output?: (chunk: string) => void) {
		super();
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

class BufferedExecutionInput {
	private currentChunk = new Uint8Array(0);
	private currentOffset = 0;
	private readonly readInput?: () => string | Uint8Array | ArrayBuffer | null;

	constructor(readInput?: () => string | Uint8Array | ArrayBuffer | null) {
		this.readInput = readInput;
	}

	read(size: number) {
		while (this.currentOffset >= this.currentChunk.length) {
			const nextChunk = this.readInput?.();
			if (nextChunk == null) return new Uint8Array(0);
			this.currentChunk = toStandaloneBytes(nextChunk);
			this.currentOffset = 0;
			if (this.currentChunk.byteLength === 0) continue;
		}
		const data = this.currentChunk.slice(this.currentOffset, this.currentOffset + size);
		this.currentOffset += data.byteLength;
		return data;
	}
}

class StdinFd extends Fd {
	ino = Inode.issue_ino();
	private readonly source: BufferedExecutionInput;

	constructor(source: BufferedExecutionInput) {
		super();
		this.source = source;
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_read(size: number) {
		return {
			ret: wasi.ERRNO_SUCCESS,
			data: this.source.read(size)
		};
	}
}

export function ensureGuestDirectory(root: Directory, guestPath: string) {
	const normalized = normalizeGuestPath(guestPath);
	const segments = normalized.slice(1).split('/').filter(Boolean);
	let directory = root;
	for (const segment of segments) {
		const existing = directory.contents.get(segment);
		if (existing instanceof Directory) {
			directory = existing;
			continue;
		}
		const nextDirectory = new Directory(new Map());
		directory.contents.set(segment, nextDirectory);
		directory = nextDirectory;
	}
	return directory;
}

export function writeGuestFile(
	root: Directory,
	guestPath: string,
	contents: string | Uint8Array | ArrayBuffer,
	readonly = false
) {
	const normalized = normalizeGuestPath(guestPath);
	const segments = normalized.slice(1).split('/');
	const parent = ensureGuestDirectory(root, segments.slice(0, -1).join('/'));
	parent.contents.set(segments.at(-1)!, new File(toStandaloneBytes(contents), { readonly }));
}

export function readGuestFile(root: Directory, guestPath: string) {
	const normalized = normalizeGuestPath(guestPath);
	const segments = normalized.slice(1).split('/');
	let entry: Inode | undefined = root;
	for (const segment of segments) {
		if (!(entry instanceof Directory)) return null;
		entry = entry.contents.get(segment);
	}
	if (!(entry instanceof File)) return null;
	return new Uint8Array(entry.data);
}

export async function runWasiModule(
	moduleBytes: Uint8Array | ArrayBuffer,
	options: {
		root?: Directory;
		args?: string[];
		programName?: string;
		env?: Record<string, string>;
		stdin?: () => string | Uint8Array | ArrayBuffer | null;
		stdout?: (chunk: string) => void;
		stderr?: (chunk: string) => void;
	} = {}
) {
	const root = options.root || new Directory(new Map());
	const stdout = new CaptureFd(options.stdout);
	const stderr = new CaptureFd(options.stderr);
	const env = new Map<string, string>([['PWD', '/'], ...Object.entries(options.env || {})]);
	const wasiInstance = new WASI(
		[options.programName || 'program.wasm', ...(options.args || [])],
		Array.from(env.entries()).map(([key, value]) => `${key}=${value}`),
		[
			new StdinFd(new BufferedExecutionInput(options.stdin)),
			stdout,
			stderr,
			new PreopenDirectory('/', root.contents),
			new PreopenDirectory('/tmp', new Map())
		],
		{ debug: false }
	);
	const bytes = moduleBytes instanceof Uint8Array ? moduleBytes : new Uint8Array(moduleBytes);
	const moduleBuffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer;
	const module = await WebAssembly.compile(moduleBuffer);
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasiInstance.wasiImport,
		wasi_unstable: wasiInstance.wasiImport
	});
	const exitCode = wasiInstance.start(
		instance as unknown as {
			exports: {
				memory: WebAssembly.Memory;
				_start: () => unknown;
			};
		}
	);
	return {
		exitCode,
		stdout: stdout.getText(),
		stderr: stderr.getText()
	};
}
