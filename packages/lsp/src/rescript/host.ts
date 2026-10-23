import { fetchBoundedExternalAsset } from '../external-asset.js';
import { RESCRIPT_LSP_PROFILE } from './profile.js';

interface WorkspaceFile {
	path: string;
	content: string;
}
interface ReScriptServer {
	receive(message: unknown): Promise<void>;
}

async function decode(bytes: Uint8Array, expected: { bytes: number; sha256: string }) {
	const output = new Uint8Array(expected.bytes);
	const reader = new Blob([Uint8Array.from(bytes).buffer])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'))
		.getReader();
	let offset = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (offset + value.length > output.length) {
			await reader.cancel();
			throw new Error('ReScript asset exceeds its decoded receipt');
		}
		output.set(value, offset);
		offset += value.length;
	}
	const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', output)), (n) =>
		n.toString(16).padStart(2, '0')
	).join('');
	if (offset !== output.length || digest !== expected.sha256)
		throw new Error('ReScript decoded asset failed its receipt');
	return output;
}

function unpack(bytes: Uint8Array) {
	if (bytes.length < 4) throw new Error('Invalid ReScript stdlib pack');
	const size = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
	if (!size || size + 4 > bytes.length) throw new Error('Invalid ReScript stdlib header');
	const header = JSON.parse(
		new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + size))
	);
	if (header.format !== 'wasm-idle-rescript-stdlib-v1' || !Array.isArray(header.files))
		throw new Error('Unsupported ReScript stdlib pack');
	let offset = 4 + size;
	const files = header.files.map((file: { path: string; size: number }) => {
		if (
			typeof file.path !== 'string' ||
			!/^(?:package\.json|lib\/ocaml\/[A-Za-z0-9_.-]+)$/.test(file.path) ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0 ||
			offset + file.size > bytes.length
		)
			throw new Error('Invalid ReScript stdlib entry');
		const data = bytes.subarray(offset, offset + file.size);
		offset += file.size;
		return { path: file.path, bytes: data };
	});
	if (offset !== bytes.length) throw new Error('Trailing ReScript stdlib bytes');
	return files;
}

export async function createReScriptServer(
	options: { baseUrl: string; workspaceFiles: WorkspaceFile[] },
	send: (message: unknown) => void
): Promise<ReScriptServer> {
	const load = (name: 'runtime.mjs.gz.bin' | 'stdlib.pack.gz.bin') =>
		fetchBoundedExternalAsset({
			url: new URL(name, options.baseUrl),
			label: `ReScript LSP ${name}`,
			integrity: RESCRIPT_LSP_PROFILE.assets[name],
			maxBytes: 12 * 1024 * 1024,
			runtimeId: 'rescript-lsp'
		});
	const [runtimeBytes, libraryBytes] = await Promise.all([
		load('runtime.mjs.gz.bin'),
		load('stdlib.pack.gz.bin')
	]);
	const [runtime, library] = await Promise.all([
		decode(runtimeBytes, RESCRIPT_LSP_PROFILE.decoded.runtime),
		decode(libraryBytes, RESCRIPT_LSP_PROFILE.decoded.stdlib)
	]);
	const url = URL.createObjectURL(new Blob([runtime], { type: 'text/javascript' }));
	try {
		const module = await import(/* @vite-ignore */ url);
		return module.start({ files: options.workspaceFiles, stdlib: unpack(library), send });
	} finally {
		URL.revokeObjectURL(url);
	}
}
