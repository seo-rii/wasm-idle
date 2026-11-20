import { UnzipInflate, UnzipPassThrough, Zip, ZipDeflate } from 'fflate';

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
// Bound each inflate step even when an entry understates its expanded size.
const INFLATE_CHUNK_BYTES = 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	return value >>> 0;
});

function crc32(bytes: Uint8Array, previous = 0) {
	let value = previous ^ 0xffffffff;
	for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
	return (value ^ 0xffffffff) >>> 0;
}

import { workspaceFileBytes, workspaceFileFromBytes, type WorkspaceFile } from './workspaceCodec';
import { normalizeWorkspacePath } from './workspacePath';

export type WorkspaceArchiveFile = WorkspaceFile;

type WorkspaceArchiveRequest =
	{ type: 'create'; files: WorkspaceArchiveFile[] } | { type: 'extract'; archive: ArrayBuffer };

type WorkspaceArchiveResponse =
	| { type: 'created'; archive: ArrayBuffer }
	| { type: 'extracted'; files: WorkspaceArchiveFile[] }
	| { type: 'error'; message: string };

function normalizeArchivePath(value: string, directory = false) {
	const safePath = normalizeWorkspacePath(value);
	if (!safePath && !directory) throw new Error('ZIP entry path cannot be empty');
	return safePath;
}

const utf8Names = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
// The upper 128 bytes of IBM code page 437, the legacy ZIP filename encoding.
const cp437High =
	'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
	'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
	'└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
	'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

function tryUtf8Name(bytes: Uint8Array) {
	try {
		return utf8Names.decode(bytes);
	} catch {
		return undefined;
	}
}

function unicodePathExtra(extra: Uint8Array, nameCrc: number) {
	const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
	let name: string | undefined;
	for (let offset = 0; offset + 4 <= extra.length;) {
		const id = view.getUint16(offset, true);
		const size = view.getUint16(offset + 2, true);
		const start = offset + 4;
		offset = start + size;
		if (offset > extra.length) break;
		// Info-ZIP Unicode Path v1 ties the UTF-8 spelling to the CRC of the stored name.
		if (
			id !== 0x7075 ||
			size < 5 ||
			extra[start] !== 1 ||
			view.getUint32(start + 1, true) !== nameCrc
		)
			continue;
		const decoded = tryUtf8Name(extra.subarray(start + 5, offset));
		if (decoded === undefined) continue;
		if (name !== undefined && name !== decoded)
			throw new Error('Conflicting ZIP Unicode paths');
		name = decoded;
	}
	return name;
}

function decodeArchivePath(
	raw: Uint8Array,
	flags: number,
	os: number,
	localExtra: Uint8Array,
	centralExtra: Uint8Array
) {
	const utf8 = Boolean(flags & 0x0800);
	// Info-ZIP on Unix/macOS can write a UTF-8 name without setting the language flag.
	const decoded = utf8 || os === 3 || os === 19 ? tryUtf8Name(raw) : undefined;
	if (utf8 && decoded === undefined) throw new Error('Invalid UTF-8 ZIP entry name');
	const rawName =
		decoded ??
		Array.from(raw, (byte) =>
			byte < 128 ? String.fromCharCode(byte) : cp437High[byte - 128]
		).join('');
	const directory = /[/\\]$/u.test(rawName);
	const rawPath = normalizeArchivePath(rawName, directory);
	if (utf8 || (!localExtra.length && !centralExtra.length))
		return { path: rawPath, rawPath, directory };
	const nameCrc = crc32(raw);
	const localName = unicodePathExtra(localExtra, nameCrc);
	const centralName = unicodePathExtra(centralExtra, nameCrc);
	if (localName !== undefined && centralName !== undefined && localName !== centralName) {
		throw new Error('Conflicting ZIP Unicode paths');
	}
	const name = centralName ?? localName;
	if (name === undefined) return { path: rawPath, rawPath, directory };
	if (/[/\\]$/u.test(name) !== directory) throw new Error('Inconsistent ZIP directory name');
	return { path: normalizeArchivePath(name, directory), rawPath, directory };
}

export function createWorkspaceArchive(files: WorkspaceArchiveFile[]) {
	if (files.length > MAX_FILES)
		throw new Error(`ZIP cannot contain more than ${MAX_FILES} files`);
	let totalBytes = 0;
	const entries = new Map<string, Uint8Array>();
	const paths = new Set<string>();
	for (const file of files) {
		const path = normalizeArchivePath(file.path);
		if (paths.has(path)) throw new Error(`ZIP contains duplicate entry path: ${path}`);
		paths.add(path);
		const contents = workspaceFileBytes(file);
		if (contents.byteLength > MAX_FILE_BYTES) {
			throw new Error(`ZIP entry exceeds the ${MAX_FILE_BYTES} byte limit: ${path}`);
		}
		totalBytes += contents.byteLength;
		if (totalBytes > MAX_TOTAL_BYTES) {
			throw new Error(`ZIP contents exceed the ${MAX_TOTAL_BYTES} byte limit`);
		}
		entries.set(path, contents);
	}
	// zipSync also flattens its input through ordinary objects internally. The
	// streaming API keeps entry names as strings and supports names like __proto__.
	const chunks: Uint8Array[] = [];
	let archiveBytes = 0;
	const zip = new Zip((error, data) => {
		if (error) throw error;
		chunks.push(data);
		archiveBytes += data.byteLength;
	});
	for (const [path, contents] of entries) {
		const entry = new ZipDeflate(path, { level: 6 });
		zip.add(entry);
		entry.push(contents, true);
	}
	zip.end();
	const archive = new Uint8Array(archiveBytes);
	let offset = 0;
	for (const chunk of chunks) {
		archive.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return archive;
}

interface ArchiveEntry {
	path: string;
	directory: boolean;
	flags: number;
	compression: number;
	checksum: number;
	compressedSize: number;
	originalSize: number;
	localOffset: number;
	payload: number;
	payloadEnd: number;
}

/** Validate the complete container before exposing any of its file contents. */
function readArchiveEntries(source: Uint8Array): ArchiveEntry[] {
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	const u16 = (offset: number) => view.getUint16(offset, true);
	const u32 = (offset: number) => view.getUint32(offset, true);
	let end = -1;
	for (let offset = source.length - 22; offset >= Math.max(0, source.length - 65557); offset--) {
		if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === source.length) {
			end = offset;
			break;
		}
	}
	if (end < 0) throw new Error('ZIP archive has no complete ZIP directory');
	const entryCount = u16(end + 10);
	const directorySize = u32(end + 12);
	const directory = u32(end + 16);
	if (
		u16(end + 4) !== 0 ||
		u16(end + 6) !== 0 ||
		u16(end + 8) !== entryCount ||
		entryCount === 0xffff ||
		directorySize === 0xffffffff ||
		directory === 0xffffffff
	) {
		throw new Error('Multipart and ZIP64 workspace archives are unsupported');
	}
	if (directory + directorySize !== end) throw new Error('Invalid ZIP directory bounds');
	const entries: ArchiveEntry[] = [];
	const rawPaths = new Set<string>();
	const resolvedPaths = new Set<string>();
	let offset = directory;
	let fileCount = 0;
	let totalBytes = 0;
	for (let index = 0; index < entryCount; index++) {
		if (offset + 46 > end || u32(offset) !== 0x02014b50) {
			throw new Error('Invalid ZIP directory entry');
		}
		const flags = u16(offset + 8);
		const compression = u16(offset + 10);
		const checksum = u32(offset + 16);
		const compressedSize = u32(offset + 20);
		const originalSize = u32(offset + 24);
		const nameLength = u16(offset + 28);
		const nameEnd = offset + 46 + nameLength;
		const extraEnd = nameEnd + u16(offset + 30);
		const next = extraEnd + u16(offset + 32);
		const localOffset = u32(offset + 42);
		if (next > end || u16(offset + 34) !== 0) throw new Error('Invalid ZIP directory entry');
		if ([compressedSize, originalSize, localOffset].includes(0xffffffff)) {
			throw new Error('ZIP64 workspace archives are unsupported');
		}
		if ((flags & ~0x080e) !== 0 || (compression === 0 && (flags & 6) !== 0)) {
			throw new Error('Unsupported ZIP entry flags');
		}
		if (compression !== 0 && compression !== 8) {
			throw new Error(`Unsupported ZIP compression method ${compression}`);
		}
		const name = source.subarray(offset + 46, nameEnd);
		const localNameEnd = localOffset + 30 + nameLength;
		if (
			localNameEnd > directory ||
			u32(localOffset) !== 0x04034b50 ||
			u16(localOffset + 6) !== flags ||
			u16(localOffset + 8) !== compression ||
			u16(localOffset + 26) !== nameLength ||
			!name.every((byte, index) => source[localOffset + 30 + index] === byte)
		) {
			throw new Error('Inconsistent ZIP entry metadata');
		}
		const payload = localNameEnd + u16(localOffset + 28);
		const payloadEnd = payload + compressedSize;
		if (payloadEnd > directory) throw new Error('Truncated ZIP entry payload');
		const {
			path,
			rawPath,
			directory: isDirectory
		} = decodeArchivePath(
			name,
			flags,
			source[offset + 5],
			source.subarray(localNameEnd, payload),
			source.subarray(nameEnd, extraEnd)
		);
		// Unix and macOS producers place the POSIX file type in the upper mode bits.
		const creator = source[offset + 5];
		if ((creator === 3 || creator === 19) && u32(offset + 38) >>> 28 === 0xa)
			throw new Error(`Workspace ZIP cannot import symbolic link: ${path}`);
		if (rawPaths.has(rawPath)) throw new Error(`ZIP contains duplicate entry path: ${rawPath}`);
		if (resolvedPaths.has(path)) throw new Error(`ZIP contains duplicate entry path: ${path}`);
		rawPaths.add(rawPath);
		resolvedPaths.add(path);
		if (!isDirectory && ++fileCount > MAX_FILES) {
			throw new Error(`ZIP cannot contain more than ${MAX_FILES} files`);
		}
		if (originalSize > MAX_FILE_BYTES) {
			throw new Error(`ZIP entry exceeds the ${MAX_FILE_BYTES} byte limit: ${path}`);
		}
		totalBytes += originalSize;
		if (totalBytes > MAX_TOTAL_BYTES) {
			throw new Error(`ZIP contents exceed the ${MAX_TOTAL_BYTES} byte limit`);
		}
		for (const [field, expected] of [
			[14, checksum],
			[18, compressedSize],
			[22, originalSize]
		]) {
			const local = u32(localOffset + field);
			if (local !== expected && (!(flags & 8) || local !== 0)) {
				throw new Error(`Inconsistent ZIP entry metadata: ${path}`);
			}
		}
		entries.push({
			path,
			directory: isDirectory,
			flags,
			compression,
			checksum,
			compressedSize,
			originalSize,
			localOffset,
			payload,
			payloadEnd
		});
		offset = next;
	}
	if (offset !== end) throw new Error('ZIP directory entry count does not match its size');
	entries.sort((left, right) => left.localOffset - right.localOffset);
	let expectedOffset = 0;
	for (const [index, entry] of entries.entries()) {
		if (entry.localOffset !== expectedOffset) throw new Error('Inconsistent ZIP entry offsets');
		const nextOffset = entries[index + 1]?.localOffset ?? directory;
		let descriptor = entry.payloadEnd;
		if (entry.flags & 8) {
			if (nextOffset - descriptor === 16 && u32(descriptor) === 0x08074b50) descriptor += 4;
			if (
				descriptor + 12 !== nextOffset ||
				u32(descriptor) !== entry.checksum ||
				u32(descriptor + 4) !== entry.compressedSize ||
				u32(descriptor + 8) !== entry.originalSize
			) {
				throw new Error(`Invalid ZIP data descriptor: ${entry.path}`);
			}
		} else if (descriptor !== nextOffset) {
			throw new Error(`Inconsistent ZIP entry size: ${entry.path}`);
		}
		expectedOffset = nextOffset;
	}
	if (expectedOffset !== directory) throw new Error('Inconsistent ZIP entry offsets');
	return entries;
}

export function extractWorkspaceArchive(source: Uint8Array) {
	const entries = readArchiveEntries(source);
	const files: WorkspaceArchiveFile[] = [];
	let totalBytes = 0;
	for (const entry of entries) {
		const { path } = entry;
		const chunks: Uint8Array[] = [];
		let fileBytes = 0;
		let checksum = 0;
		let completed = false;
		let archiveError: unknown;
		const file = entry.compression === 8 ? new UnzipInflate() : new UnzipPassThrough();
		file.ondata = (error, data, final) => {
			if (error) {
				archiveError = error;
				return;
			}
			fileBytes += data.byteLength;
			if (fileBytes > MAX_FILE_BYTES) {
				throw new Error(`ZIP entry exceeds the ${MAX_FILE_BYTES} byte limit: ${path}`);
			}
			if (fileBytes > entry.originalSize) throw new Error(`Invalid ZIP entry size: ${path}`);
			totalBytes += data.byteLength;
			if (totalBytes > MAX_TOTAL_BYTES) {
				throw new Error(`ZIP contents exceed the ${MAX_TOTAL_BYTES} byte limit`);
			}
			checksum = crc32(data, checksum);
			if (data.byteLength > 0) chunks.push(data);
			if (!final) return;
			if (fileBytes !== entry.originalSize)
				throw new Error(`Invalid ZIP entry size: ${path}`);
			if (checksum !== entry.checksum) {
				throw new Error(`Invalid ZIP CRC checksum: ${path}`);
			}
			completed = true;
			if (entry.directory) return;
			const contents = new Uint8Array(fileBytes);
			let offset = 0;
			for (const chunk of chunks) {
				contents.set(chunk, offset);
				offset += chunk.byteLength;
			}
			files.push(workspaceFileFromBytes(path, contents));
		};
		// Feed only the validated payload; descriptors and ZIP signatures in stored
		// contents must never be mistaken for another entry by a streaming scanner.
		let offset = entry.payload;
		do {
			const next = Math.min(entry.payloadEnd, offset + INFLATE_CHUNK_BYTES);
			file.push(source.subarray(offset, next), next === entry.payloadEnd);
			if (archiveError) throw archiveError;
			offset = next;
		} while (offset < entry.payloadEnd);
		if (!completed) throw new Error(`Unfinished ZIP entry: ${path}`);
	}
	// The workspace can represent an empty root, but cannot retain named empty directories.
	if (!files.length && entries.some((entry) => entry.path !== '' || entry.originalSize !== 0))
		throw new Error('ZIP archive contains no files');
	return files;
}

const workerGlobal = globalThis as typeof globalThis & {
	document?: unknown;
	onmessage?: (event: MessageEvent<WorkspaceArchiveRequest>) => void;
	postMessage?: (message: WorkspaceArchiveResponse, transfer?: Transferable[]) => void;
};

if (!workerGlobal.document && workerGlobal.postMessage) {
	workerGlobal.onmessage = ({ data }) => {
		try {
			if (data.type === 'create') {
				const archive = createWorkspaceArchive(data.files);
				const buffer = archive.slice().buffer;
				workerGlobal.postMessage?.({ type: 'created', archive: buffer }, [buffer]);
				return;
			}
			const files = extractWorkspaceArchive(new Uint8Array(data.archive));
			workerGlobal.postMessage?.({ type: 'extracted', files });
		} catch (error) {
			workerGlobal.postMessage?.({
				type: 'error',
				message: error instanceof Error ? error.message : String(error)
			});
		}
	};
}
