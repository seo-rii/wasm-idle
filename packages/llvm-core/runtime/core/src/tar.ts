import { readOct, readStr } from './encode.js';

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
	addDirectory(path: string): void;
	addFile(path: string, contents: Uint8Array): void;
}

function* readEntry(buffer: Uint8Array | ArrayBufferLike) {
	const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let offset = 0;
	let nextFilename = '';

	const str = (len: number) => {
			offset += len;
			return readStr(u8, offset - len, len);
		},
		oct = (len: number) => {
			offset += len;
			return readOct(u8, offset - len, len);
		},
		align = () => (offset = (offset + 511) & ~511);

	while (offset + 512 <= u8.length) {
		const entryInit: EntryInit = {
			filename: str(100),
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
			filenamePrefix: str(155)
		};

		align();

		if (entry.size > 0 || entry.type === '0' || entry.type === '' || entry.type === 'L') {
			const contents = u8.subarray(offset, offset + entry.size);
			entry.contents = contents;
			offset += entry.size;
			align();
		}

		if (entry.type === 'L') {
			if (entry.contents) nextFilename = readStr(entry.contents, 0, entry.size);
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
	for (const entry of readEntry(buffer)) {
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
