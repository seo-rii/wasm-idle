import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate';

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export interface WorkspaceArchiveFile {
	path: string;
	content: string;
}

type WorkspaceArchiveRequest =
	| { type: 'create'; files: WorkspaceArchiveFile[] }
	| { type: 'extract'; archive: ArrayBuffer };

type WorkspaceArchiveResponse =
	| { type: 'created'; archive: ArrayBuffer }
	| { type: 'extracted'; files: WorkspaceArchiveFile[] }
	| { type: 'error'; message: string };

function normalizeArchivePath(value: string) {
	const normalized = value.replaceAll('\\', '/');
	if (normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized)) {
		throw new Error(`ZIP entry must use a relative path: ${value}`);
	}
	const parts = normalized.split('/');
	if (parts.includes('..')) throw new Error(`ZIP entry cannot traverse directories: ${value}`);
	const safePath = parts.filter((part) => part && part !== '.').join('/');
	if (!safePath) throw new Error('ZIP entry path cannot be empty');
	return safePath;
}

export function createWorkspaceArchive(files: WorkspaceArchiveFile[]) {
	if (files.length > MAX_FILES)
		throw new Error(`ZIP cannot contain more than ${MAX_FILES} files`);
	let totalBytes = 0;
	const entries: Record<string, Uint8Array> = {};
	for (const file of files) {
		const path = normalizeArchivePath(file.path);
		const contents = strToU8(file.content);
		if (contents.byteLength > MAX_FILE_BYTES) {
			throw new Error(`ZIP entry exceeds the ${MAX_FILE_BYTES} byte limit: ${path}`);
		}
		totalBytes += contents.byteLength;
		if (totalBytes > MAX_TOTAL_BYTES) {
			throw new Error(`ZIP contents exceed the ${MAX_TOTAL_BYTES} byte limit`);
		}
		entries[path] = contents;
	}
	return zipSync(entries, { level: 6 });
}

export function extractWorkspaceArchive(source: Uint8Array) {
	const files: WorkspaceArchiveFile[] = [];
	let totalBytes = 0;
	let archiveError: unknown;
	const unzip = new Unzip((file) => {
		if (!file.name || file.name.endsWith('/')) return;
		if (file.compression !== 0 && file.compression !== 8) {
			throw new Error(`Unsupported ZIP compression method ${file.compression}: ${file.name}`);
		}
		if (files.length >= MAX_FILES) {
			throw new Error(`ZIP cannot contain more than ${MAX_FILES} files`);
		}
		const path = normalizeArchivePath(file.name);
		if (file.originalSize !== undefined && file.originalSize > MAX_FILE_BYTES) {
			throw new Error(`ZIP entry exceeds the ${MAX_FILE_BYTES} byte limit: ${path}`);
		}
		const chunks: Uint8Array[] = [];
		let fileBytes = 0;
		file.ondata = (error, data, final) => {
			if (error) {
				archiveError = error;
				return;
			}
			fileBytes += data.byteLength;
			if (fileBytes > MAX_FILE_BYTES) {
				throw new Error(`ZIP entry exceeds the ${MAX_FILE_BYTES} byte limit: ${path}`);
			}
			if (data.byteLength > 0) chunks.push(data);
			if (!final) return;
			totalBytes += fileBytes;
			if (totalBytes > MAX_TOTAL_BYTES) {
				throw new Error(`ZIP contents exceed the ${MAX_TOTAL_BYTES} byte limit`);
			}
			const contents = new Uint8Array(fileBytes);
			let offset = 0;
			for (const chunk of chunks) {
				contents.set(chunk, offset);
				offset += chunk.byteLength;
			}
			files.push({ path, content: strFromU8(contents) });
		};
		file.start();
	});
	unzip.register(UnzipInflate);
	unzip.push(source, true);
	if (archiveError) throw archiveError;
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
