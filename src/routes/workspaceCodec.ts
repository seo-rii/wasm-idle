/** Serializable editor files. Missing encoding is accepted for older snapshots. */
export interface WorkspaceFile {
	path: string;
	/** Set when a terminal filename must be interpreted literally on restore. */
	pathStyle?: 'posix';
	content: string;
	encoding?: 'utf-8' | 'data-url';
}

const wasmDataUrl = /^data:application\/wasm;base64,/;

export function isBinaryWorkspaceFile(file: WorkspaceFile) {
	return (
		file.encoding === 'data-url' ||
		(file.encoding === undefined &&
			/\.wasm$/i.test(file.path) &&
			wasmDataUrl.test(file.content))
	);
}

export function workspaceFileBytes(file: WorkspaceFile): Uint8Array<ArrayBuffer> {
	if (!isBinaryWorkspaceFile(file)) return new TextEncoder().encode(file.content);
	const match = /^data:[^;,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(file.content);
	if (!match) throw new Error(`Invalid binary content: ${file.path}`);
	const binary = atob(match[1]);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export { decodeWorkspaceText, workspaceFileFromBytes } from '../lib/container/workspace.js';

export function workspaceFileBlob(file: WorkspaceFile) {
	return new Blob([workspaceFileBytes(file)], {
		type: isBinaryWorkspaceFile(file)
			? /\.wasm$/i.test(file.path)
				? 'application/wasm'
				: 'application/octet-stream'
			: 'text/plain;charset=utf-8'
	});
}
