import { strFromU8, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate } from 'fflate';

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

import { workspaceFileBytes, workspaceFileFromBytes, type WorkspaceFile } from './workspaceCodec';
import { normalizeWorkspacePath } from './workspacePath';

export type WorkspaceArchiveFile = WorkspaceFile;

type WorkspaceArchiveRequest =
	{ type: 'create'; files: WorkspaceArchiveFile[] } | { type: 'extract'; archive: ArrayBuffer };

type WorkspaceArchiveResponse =
	| { type: 'created'; archive: ArrayBuffer }
	| { type: 'extracted'; files: WorkspaceArchiveFile[] }
	| { type: 'error'; message: string };

function normalizeArchivePath(value: string) {
	const safePath = normalizeWorkspacePath(value);
	if (!safePath) throw new Error('ZIP entry path cannot be empty');
	return safePath;
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
	const paths = new Set<string>();
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
		const next = offset + 46 + nameLength + u16(offset + 30) + u16(offset + 32);
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
		const name = source.subarray(offset + 46, offset + 46 + nameLength);
		const decodedName = strFromU8(name, !(flags & 0x0800));
		const path = normalizeArchivePath(decodedName);
		if (paths.has(path)) throw new Error(`ZIP contains duplicate entry path: ${path}`);
		paths.add(path);
		const isDirectory = decodedName.replaceAll('\\', '/').endsWith('/');
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
		if (
			localOffset + 30 + nameLength > directory ||
			u32(localOffset) !== 0x04034b50 ||
			u16(localOffset + 6) !== flags ||
			u16(localOffset + 8) !== compression ||
			u16(localOffset + 26) !== nameLength ||
			!name.every((byte, index) => source[localOffset + 30 + index] === byte)
		) {
			throw new Error(`Inconsistent ZIP entry metadata: ${path}`);
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
		const payload = localOffset + 30 + nameLength + u16(localOffset + 28);
		const payloadEnd = payload + compressedSize;
		if (payloadEnd > directory) throw new Error(`Truncated ZIP entry payload: ${path}`);
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
		let checksum = 0xffffffff;
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
			for (const byte of data)
				checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 255];
			if (data.byteLength > 0) chunks.push(data);
			if (!final) return;
			if (fileBytes !== entry.originalSize)
				throw new Error(`Invalid ZIP entry size: ${path}`);
			if ((checksum ^ 0xffffffff) >>> 0 !== entry.checksum) {
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
	if (files.length === 0) throw new Error('ZIP archive contains no files');
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
