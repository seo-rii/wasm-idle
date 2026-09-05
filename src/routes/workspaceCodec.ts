/** Serializable editor files. Missing encoding is accepted for older snapshots. */
export interface WorkspaceFile {
	path: string;
	content: string;
	encoding?: 'utf-8' | 'data-url';
}

const wasmDataUrl = /^data:application\/wasm;base64,/;
const binaryExtensions = /\.(wasm|bin|parquet|png|jpe?g|gif|webp|ico|pdf|zip|gz|br|woff2?|ttf)$/i;

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

export function workspaceFileFromBytes(path: string, bytes: Uint8Array): WorkspaceFile {
	if (!binaryExtensions.test(path) && !bytes.includes(0)) {
		try {
			// Preserve a UTF-8 BOM as a character so encoding restores the same bytes.
			const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
				bytes
			);
			return { path, content, encoding: 'utf-8' };
		} catch {
			// Non-UTF-8 input is binary; never replace undecodable bytes.
		}
	}
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	const mime = /\.wasm$/i.test(path) ? 'application/wasm' : 'application/octet-stream';
	return { path, content: `data:${mime};base64,${btoa(binary)}`, encoding: 'data-url' };
}

export function workspaceFileBlob(file: WorkspaceFile) {
	return new Blob([workspaceFileBytes(file)], {
		type: isBinaryWorkspaceFile(file)
			? /\.wasm$/i.test(file.path)
				? 'application/wasm'
				: 'application/octet-stream'
			: 'text/plain;charset=utf-8'
	});
}
