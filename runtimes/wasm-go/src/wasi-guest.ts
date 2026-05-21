import { Directory, Fd, File, Inode, wasi } from '@bjorn3/browser_wasi_shim';

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

export function normalizeGuestPath(path: string) {
	const normalized = path.replace(/\\/g, '/');
	const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
	const segments: string[] = [];
	for (const segment of absolute.split('/')) {
		if (!segment || segment === '.') {
			continue;
		}
		if (segment === '..') {
			throw new Error(`wasm-go does not allow guest path traversal: ${path}`);
		}
		segments.push(segment);
	}
	return `/${segments.join('/')}`;
}

export function toStandaloneBytes(value: string | Uint8Array | ArrayBuffer) {
	if (typeof value === 'string') {
		return new TextEncoder().encode(value);
	}
	if (value instanceof Uint8Array) {
		const bytes = new Uint8Array(value.byteLength);
		bytes.set(value);
		return bytes;
	}
	return new Uint8Array(value);
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
	parent.contents.set(
		segments.at(-1)!,
		new File(toStandaloneBytes(contents), {
			readonly
		})
	);
}

export function readGuestFile(root: Directory, guestPath: string) {
	const normalized = normalizeGuestPath(guestPath);
	const segments = normalized.slice(1).split('/');
	let entry: Inode | undefined = root;
	for (const segment of segments) {
		if (!(entry instanceof Directory)) {
			return null;
		}
		entry = entry.contents.get(segment);
	}
	if (!(entry instanceof File)) {
		return null;
	}
	return new Uint8Array(entry.data);
}
