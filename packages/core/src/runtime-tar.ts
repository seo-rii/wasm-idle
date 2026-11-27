import { readOct, readStr } from './runtime-encode.js';

interface EntryInit {
	filename: string;
	mode: number;
	owner: number;
	group: number;
	size: number;
	mtime: number;
	checksum: number;
	type: string;
	linkname: string;
	ustar: string;
}

type Entry = EntryInit & {
	ownerName: string;
	groupName: string;
	devMajor: string;
	devMinor: string;
	filenamePrefix: string;
	contents?: Uint8Array;
};

type FileEntry = Entry & {
	contents: Uint8Array;
};

export interface TarFileSystem {
	/** Omit for the byte-string paths consumed by MemFS; select UTF-8 for JavaScript paths. */
	pathEncoding?: 'utf-8';
	addDirectory(path: string): void;
	addFile(path: string, contents: Uint8Array): void;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function readUtf8Path(u8: Uint8Array, offset: number, length: number) {
	const field = u8.subarray(offset, offset + length);
	const end = field.indexOf(0);
	return utf8.decode(end < 0 ? field : field.subarray(0, end));
}

function* readEntry(buffer: Uint8Array | ArrayBufferLike, pathEncoding?: 'utf-8') {
	const readPath = pathEncoding === 'utf-8' ? readUtf8Path : readStr;
	const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let offset = 0;
	let nextFilename = '';

	const str = (len: number, read: typeof readUtf8Path = readStr) => {
			offset += len;
			return read(u8, offset - len, len);
		},
		oct = (len: number) => {
			offset += len;
			return readOct(u8, offset - len, len);
		},
		align = () => (offset = Math.ceil(offset / 512) * 512);

	while (offset + 512 <= u8.length) {
		const headerOffset = offset;
		if (u8.subarray(offset, offset + 512).every((byte) => byte === 0)) return;
		const entryInit: EntryInit = {
			filename: str(100, readPath),
			mode: oct(8),
			owner: oct(8),
			group: oct(8),
			size: oct(12),
			mtime: oct(12),
			checksum: oct(8),
			type: str(1),
			linkname: str(100),
			ustar: str(8)
		};

		if (!entryInit.ustar) return;

		const entry: Entry = {
			...entryInit,
			ownerName: str(32),
			groupName: str(32),
			devMajor: str(8),
			devMinor: str(8),
			filenamePrefix: str(155, readPath)
		};

		align();
		const nextOffset = offset + Math.ceil(entry.size / 512) * 512;
		if (
			!Number.isSafeInteger(nextOffset) ||
			nextOffset <= headerOffset ||
			nextOffset > u8.length
		) {
			throw new Error('TAR has a truncated or out-of-range payload');
		}

		if (entry.size > 0 || entry.type === '0' || entry.type === '' || entry.type === 'L') {
			const contents = u8.subarray(offset, offset + entry.size);
			entry.contents = contents;
		}
		offset = nextOffset;

		if (entry.type === 'L') {
			if (entry.contents) nextFilename = readPath(entry.contents, 0, entry.size);
			continue;
		}

		entry.filename =
			nextFilename ||
			(entry.filenamePrefix ? `${entry.filenamePrefix}/${entry.filename}` : entry.filename);
		nextFilename = '';
		yield entry;
	}
}

export default function untar(buffer: Uint8Array | ArrayBufferLike, memfs: TarFileSystem) {
	for (const entry of readEntry(buffer, memfs.pathEncoding)) {
		switch (entry.type) {
			case '': // Regular file.
			case '0': // Regular file.
				memfs.addFile(entry.filename, (entry as FileEntry).contents);
				break;
			case '5': // Folder.
				memfs.addDirectory(entry.filename);
				break;
			default:
				throw new Error(`unsupported tar entry type: ${entry.type}`);
		}
	}
}
