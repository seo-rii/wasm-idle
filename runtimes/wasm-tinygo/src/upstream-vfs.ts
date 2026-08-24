import { Directory, File } from '@bjorn3/browser_wasi_shim';

export type TinyGoWasiDirectoryContents = Map<string, File | Directory>;

export const DEFAULT_MAX_TINYGO_ROOT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_TINYGO_ROOT_FILES = 65_536;
const TAR_BLOCK_BYTES = 512;
const MAX_VFS_PATH_BYTES = 4_096;

const textDecoder = new TextDecoder();

function assertSafeLimit(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative safe integer`);
	}
}

export function normalizeTinyGoVfsPath(path: string) {
	if (
		path.length === 0 ||
		path.length > MAX_VFS_PATH_BYTES ||
		path.startsWith('/') ||
		path.includes('\\') ||
		path.includes('\0')
	) {
		throw new Error(`unsafe TinyGo VFS path: ${JSON.stringify(path)}`);
	}
	const parts = path.replace(/\/$/u, '').split('/');
	if (
		parts.some(
			(part, index) =>
				part.length === 0 ||
				part === '.' ||
				part === '..' ||
				(index === 0 && part.includes(':'))
		)
	) {
		throw new Error(`unsafe TinyGo VFS path: ${JSON.stringify(path)}`);
	}
	return parts.join('/');
}

function ensureDirectory(
	root: TinyGoWasiDirectoryContents,
	relativePath: string
): TinyGoWasiDirectoryContents {
	const normalized = normalizeTinyGoVfsPath(relativePath);
	let contents = root;
	for (const part of normalized.split('/')) {
		const current = contents.get(part);
		if (current instanceof File) {
			throw new Error(`TinyGo VFS path crosses a file: ${normalized}`);
		}
		if (current instanceof Directory) {
			contents = current.contents as TinyGoWasiDirectoryContents;
			continue;
		}
		const directory = new Directory(new Map());
		contents.set(part, directory);
		contents = directory.contents as TinyGoWasiDirectoryContents;
	}
	return contents;
}

export function addTinyGoVfsDirectory(root: TinyGoWasiDirectoryContents, relativePath: string) {
	ensureDirectory(root, relativePath);
}

export function addTinyGoVfsFile(
	root: TinyGoWasiDirectoryContents,
	relativePath: string,
	bytes: Uint8Array,
	options: { readonly?: boolean } = {}
) {
	const normalized = normalizeTinyGoVfsPath(relativePath);
	const parts = normalized.split('/');
	const name = parts.pop();
	if (!name) throw new Error(`invalid TinyGo VFS file path: ${relativePath}`);
	const parent = parts.length ? ensureDirectory(root, parts.join('/')) : root;
	if (parent.has(name)) {
		throw new Error(`duplicate TinyGo VFS path: ${normalized}`);
	}
	parent.set(name, new File(bytes, { readonly: options.readonly ?? true }));
}

export function readTinyGoVfsFile(root: TinyGoWasiDirectoryContents, relativePath: string) {
	const normalized = normalizeTinyGoVfsPath(relativePath);
	let entry: File | Directory | undefined;
	let contents = root;
	for (const [index, part] of normalized.split('/').entries()) {
		entry = contents.get(part);
		if (!entry) throw new Error(`missing TinyGo VFS path: ${normalized}`);
		if (index === normalized.split('/').length - 1) break;
		if (!(entry instanceof Directory)) {
			throw new Error(`TinyGo VFS path crosses a file: ${normalized}`);
		}
		contents = entry.contents as TinyGoWasiDirectoryContents;
	}
	if (!(entry instanceof File)) throw new Error(`TinyGo VFS path is not a file: ${normalized}`);
	return Uint8Array.from(entry.data);
}

export function hasTinyGoVfsPath(
	root: TinyGoWasiDirectoryContents,
	relativePath: string,
	type: 'file' | 'directory' | 'either' = 'either'
) {
	let normalized: string;
	try {
		normalized = normalizeTinyGoVfsPath(relativePath);
	} catch {
		return false;
	}
	let entry: File | Directory | undefined;
	let contents = root;
	const parts = normalized.split('/');
	for (const [index, part] of parts.entries()) {
		entry = contents.get(part);
		if (!entry) return false;
		if (index === parts.length - 1) break;
		if (!(entry instanceof Directory)) return false;
		contents = entry.contents as TinyGoWasiDirectoryContents;
	}
	return (
		type === 'either' ||
		(type === 'file' && entry instanceof File) ||
		(type === 'directory' && entry instanceof Directory)
	);
}

function readTarString(bytes: Uint8Array, offset: number, length: number) {
	const field = bytes.subarray(offset, offset + length);
	const zero = field.indexOf(0);
	return textDecoder.decode(zero === -1 ? field : field.subarray(0, zero));
}

function readTarOctal(bytes: Uint8Array, offset: number, length: number, label: string) {
	const source = readTarString(bytes, offset, length).trim();
	if (!/^[0-7]*$/u.test(source)) throw new Error(`invalid tar ${label}`);
	const value = source.length ? Number.parseInt(source, 8) : 0;
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid tar ${label}`);
	return value;
}

function verifyTarChecksum(bytes: Uint8Array, offset: number) {
	const expected = readTarOctal(bytes, offset + 148, 8, 'checksum');
	let actual = 0;
	for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
		actual += index >= 148 && index < 156 ? 0x20 : (bytes[offset + index] ?? 0);
	}
	if (actual !== expected) throw new Error('invalid tar header checksum');
}

function isZeroTarBlock(bytes: Uint8Array, offset: number) {
	for (let index = offset; index < offset + TAR_BLOCK_BYTES; index += 1) {
		if (bytes[index] !== 0) return false;
	}
	return true;
}

export function extractTinyGoRootTar(
	tarBytes: Uint8Array,
	options: { maxBytes?: number; maxFiles?: number } = {}
) {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_TINYGO_ROOT_BYTES;
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_TINYGO_ROOT_FILES;
	assertSafeLimit(maxBytes, 'max TinyGo root bytes');
	assertSafeLimit(maxFiles, 'max TinyGo root files');
	if (tarBytes.byteLength > maxBytes) {
		throw new Error(`TinyGo root tar exceeds the ${maxBytes} byte extraction limit`);
	}

	const root: TinyGoWasiDirectoryContents = new Map();
	let offset = 0;
	let entries = 0;
	let pendingLongName: string | null = null;
	while (offset + TAR_BLOCK_BYTES <= tarBytes.byteLength) {
		if (isZeroTarBlock(tarBytes, offset)) return root;
		verifyTarChecksum(tarBytes, offset);
		const magic = readTarString(tarBytes, offset + 257, 6);
		if (magic.trimEnd() !== 'ustar') {
			throw new Error('TinyGo root archive is not a ustar archive');
		}
		const size = readTarOctal(tarBytes, offset + 124, 12, 'entry size');
		const type = readTarString(tarBytes, offset + 156, 1);
		const name = readTarString(tarBytes, offset, 100);
		const prefix = readTarString(tarBytes, offset + 345, 155);
		const dataOffset = offset + TAR_BLOCK_BYTES;
		const dataEnd = dataOffset + size;
		if (dataEnd > tarBytes.byteLength) throw new Error('truncated TinyGo root tar entry');
		const payload = tarBytes.subarray(dataOffset, dataEnd);
		offset = dataOffset + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;

		if (type === 'L') {
			if (pendingLongName !== null)
				throw new Error('nested GNU tar long-name entries are invalid');
			pendingLongName = textDecoder.decode(payload).replace(/[\0\n]+$/u, '');
			continue;
		}
		const entryName = pendingLongName ?? (prefix ? `${prefix}/${name}` : name);
		pendingLongName = null;
		entries += 1;
		if (entries > maxFiles) {
			throw new Error(`TinyGo root tar exceeds the ${maxFiles} entry extraction limit`);
		}
		if (type === '5') {
			addTinyGoVfsDirectory(root, entryName);
		} else if (type === '' || type === '0') {
			addTinyGoVfsFile(root, entryName, payload);
		} else {
			throw new Error(`unsupported TinyGo root tar entry type: ${JSON.stringify(type)}`);
		}
	}
	throw new Error('TinyGo root tar is truncated or lacks an end marker');
}

export async function decompressTinyGoRootArchive(
	archive: Uint8Array,
	options: { maxBytes?: number } = {}
) {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_TINYGO_ROOT_BYTES;
	assertSafeLimit(maxBytes, 'max TinyGo root bytes');
	if (typeof DecompressionStream !== 'function') {
		throw new Error("upstream TinyGo root extraction requires DecompressionStream('gzip')");
	}
	const blobBytes =
		archive.buffer instanceof ArrayBuffer
			? (archive as Uint8Array<ArrayBuffer>)
			: Uint8Array.from(archive);
	const body = new Blob([blobBytes])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error(`TinyGo root archive exceeds the ${maxBytes} byte extraction limit`);
		}
		chunks.push(value);
	}
	const tar = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		tar.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return tar;
}

export async function extractTinyGoRootArchive(
	archive: Uint8Array,
	options: { maxBytes?: number; maxFiles?: number } = {}
) {
	const tar = await decompressTinyGoRootArchive(archive, options);
	return extractTinyGoRootTar(tar, options);
}
