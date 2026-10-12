import { Unzip, UnzipInflate, Zip, ZipDeflate } from 'fflate';

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

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

export function extractWorkspaceArchive(source: Uint8Array) {
	const files: WorkspaceArchiveFile[] = [];
	let totalBytes = 0;
	let archiveError: unknown;
	const paths = new Set<string>();
	const unzip = new Unzip((file) => {
		const path = normalizeArchivePath(file.name);
		if (paths.has(path)) throw new Error(`ZIP contains duplicate entry path: ${path}`);
		paths.add(path);
		if (file.name.replaceAll('\\', '/').endsWith('/')) return;
		if (file.compression !== 0 && file.compression !== 8) {
			throw new Error(`Unsupported ZIP compression method ${file.compression}: ${file.name}`);
		}
		if (files.length >= MAX_FILES) {
			throw new Error(`ZIP cannot contain more than ${MAX_FILES} files`);
		}
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
			files.push(workspaceFileFromBytes(path, contents));
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
