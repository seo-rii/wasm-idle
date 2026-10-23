export interface NimFileSystem {
	mkdirTree(path: string): void;
	writeFile(path: string, bytes: Uint8Array): void;
	symlink(target: string, path: string): void;
	chdir(path: string): void;
	getStream(fd: number): { stream_ops: Record<string, any> };
}

/** Mirror editor file operations before the original CLI sees their stdio frames.
 * nimsuggest needs an on-disk project file even for a newly opened document.
 * This decodes only JSON-RPC framing and file notifications, never Nim syntax.
 */
export function createNimWorkspaceMirror(fs: NimFileSystem) {
	let header: number[] = [];
	let remaining = 0;
	let chunks: Uint8Array[] = [];
	const opened = new Map<string, string>();
	const write = (uri: unknown, text: unknown) => {
		if (typeof uri !== 'string' || typeof text !== 'string') return;
		const url = new URL(uri);
		if (url.protocol !== 'file:' || url.hostname) return;
		const path = decodeURIComponent(url.pathname);
		if (
			!path.startsWith('/workspace/') ||
			path.includes('\0') ||
			path.includes('\\') ||
			path
				.split('/')
				.slice(1)
				.some((part) => !part || part === '.' || part === '..')
		)
			return;
		const bytes = new TextEncoder().encode(text);
		if (bytes.length > 16 * 1024 * 1024) throw new Error('Nim LSP document exceeds 16 MiB');
		fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
		fs.writeFile(path, bytes);
	};
	const message = (data: any) => {
		const params = data.params;
		if (data.method === 'textDocument/didOpen') {
			opened.set(params.textDocument.uri, params.textDocument.text);
			write(params.textDocument.uri, params.textDocument.text);
		} else if (data.method === 'textDocument/didChange') {
			const change = params.contentChanges?.[0];
			if (change && !change.range && typeof change.text === 'string')
				opened.set(params.textDocument.uri, change.text);
		} else if (data.method === 'textDocument/didSave') {
			write(params.textDocument.uri, params.text ?? opened.get(params.textDocument.uri));
		} else if (data.method === 'textDocument/didClose') {
			opened.delete(params.textDocument.uri);
		}
	};
	return (bytes: Uint8Array) => {
		let offset = 0;
		while (offset < bytes.length) {
			if (!remaining) {
				header.push(bytes[offset++]);
				if (header.length > 8192) throw new Error('Nim LSP stdio header exceeds 8 KiB');
				const length = header.length;
				if (
					length < 4 ||
					header[length - 4] !== 13 ||
					header[length - 3] !== 10 ||
					header[length - 2] !== 13 ||
					header[length - 1] !== 10
				)
					continue;
				const match = /^Content-Length:\s*(\d+)\r$/m.exec(
					new TextDecoder().decode(Uint8Array.from(header))
				);
				remaining = Number(match?.[1]);
				if (
					!Number.isSafeInteger(remaining) ||
					remaining <= 0 ||
					remaining > 32 * 1024 * 1024
				)
					throw new Error('Invalid Nim LSP stdio content length');
				header = [];
			}
			const count = Math.min(remaining, bytes.length - offset);
			chunks.push(bytes.slice(offset, offset + count));
			offset += count;
			remaining -= count;
			if (!remaining) {
				const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
				let cursor = 0;
				for (const chunk of chunks) {
					body.set(chunk, cursor);
					cursor += chunk.length;
				}
				chunks = [];
				message(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
			}
		}
	};
}

export function configureNimFileSystem(options: {
	fs: NimFileSystem;
	wasm: Uint8Array;
	files: Array<{ path: string; data: Uint8Array }>;
	read(buffer: Uint8Array): number;
	stdout(bytes: Uint8Array): void;
	stderr(bytes: Uint8Array): void;
}) {
	const { fs } = options;
	for (const path of ['/nim/bin', '/workspace']) fs.mkdirTree(path);
	for (const file of options.files) {
		fs.mkdirTree(file.path.slice(0, file.path.lastIndexOf('/')));
		fs.writeFile(file.path, file.data);
	}
	// Supply Linux's executable identity for Nim's getAppFilename/configuration lookup.
	fs.writeFile('/nim/bin/nimlsp.wasm', options.wasm);
	fs.symlink('/nim/bin/nimlsp.wasm', '/proc/self/exe');
	fs.chdir('/workspace');
	const mirror = createNimWorkspaceMirror(fs);
	for (const fd of [0, 1, 2]) {
		const stream = fs.getStream(fd);
		stream.stream_ops = {
			...stream.stream_ops,
			read(_stream: unknown, buffer: Uint8Array | Int8Array, offset: number, length: number) {
				const target = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length);
				const count = options.read(target);
				mirror(target.subarray(0, count));
				return count;
			},
			write(
				_stream: unknown,
				buffer: Uint8Array | Int8Array,
				offset: number,
				length: number
			) {
				(fd === 1 ? options.stdout : options.stderr)(
					Uint8Array.from(buffer.subarray(offset, offset + length))
				);
				return length;
			},
			fsync() {
				return 0;
			}
		};
	}
}
