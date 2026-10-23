import { gunzipSync } from 'fflate';

interface VModule {
	HEAPU8: Uint8Array;
	FS: {
		mkdirTree(path: string): void;
		writeFile(path: string, contents: string): void;
		analyzePath(path: string): { exists: boolean };
	};
	ccall(
		name: string,
		result: null,
		types: string[],
		values: number[],
		options: { async: true }
	): Promise<void>;
	_malloc(bytes: number): number;
	_free(pointer: number): void;
	_lsp_response_ptr(): number;
	_lsp_response_len(): number;
}

export interface VLspHostAssets {
	moduleBytes: Uint8Array;
	wasmBytes: Uint8Array;
	stdlibBytes: Uint8Array;
}

function documentPath(uri: unknown): string | undefined {
	if (typeof uri !== 'string') return;
	const url = new URL(uri);
	if (url.protocol !== 'file:') return;
	const filename = decodeURIComponent(url.pathname);
	if (filename.includes('\0')) throw new Error('Invalid V document path');
	return filename;
}

/** All parsing and semantics run in the original v-analyzer; this host supplies its filesystem and transport. */
export async function createVLspHost(assets: VLspHostAssets) {
	const moduleUrl = URL.createObjectURL(
		new Blob([Uint8Array.from(assets.moduleBytes).buffer], { type: 'text/javascript' })
	);
	let factory;
	try {
		factory = (await import(/* @vite-ignore */ moduleUrl)).default;
	} finally {
		URL.revokeObjectURL(moduleUrl);
	}
	if (typeof factory !== 'function') throw new Error('V LSP loader has no factory');
	const module = (await factory({
		wasmBinary: assets.wasmBytes,
		noInitialRun: true,
		locateFile: (name: string) => new URL(name, 'https://wasm-idle.invalid/v-lsp/').href,
		print: (line: string) => console.debug(`[V LSP stdout] ${line}`),
		printErr: (line: string) => console.debug(`[V LSP stderr] ${line}`)
	})) as VModule;
	// BDWGC can unwind through Asyncify during startup; await it before initializing V globals.
	await module.ccall('lsp_gc_init', null, [], [], { async: true });
	await module.ccall('main', null, ['number', 'number'], [0, 0], { async: true });
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const stdlib = JSON.parse(decoder.decode(gunzipSync(assets.stdlibBytes)));
	for (const [relative, content] of Object.entries(stdlib)) {
		if (
			typeof content !== 'string' ||
			!/^.*\.v(?:sh)?$/.test(relative) ||
			relative.split('/').some((part) => !part || part === '.' || part === '..')
		)
			throw new Error('Invalid V standard library path');
		const filename = `/v/vlib/${relative}`;
		module.FS.mkdirTree(filename.slice(0, filename.lastIndexOf('/')));
		module.FS.writeFile(filename, content);
	}
	await module.ccall('lsp_init', null, [], [], { async: true });
	const encoder = new TextEncoder();
	async function dispatchOriginal(message: unknown): Promise<unknown[]> {
		const payload = encoder.encode(JSON.stringify(message));
		const pointer = module._malloc(payload.length);
		try {
			module.HEAPU8.set(payload, pointer);
			await module.ccall(
				'lsp_handle',
				null,
				['number', 'number'],
				[pointer, payload.length],
				{ async: true }
			);
		} finally {
			module._free(pointer);
		}
		const start = module._lsp_response_ptr(),
			length = module._lsp_response_len();
		if (start < 0 || length < 0 || start + length > module.HEAPU8.length)
			throw new Error('Invalid V LSP response buffer');
		const bytes = module.HEAPU8.slice(start, start + length);
		const messages: unknown[] = [];
		for (let offset = 0; offset < bytes.length;) {
			let split = offset;
			while (
				split + 3 < bytes.length &&
				!(
					bytes[split] === 13 &&
					bytes[split + 1] === 10 &&
					bytes[split + 2] === 13 &&
					bytes[split + 3] === 10
				)
			)
				split++;
			const count = Number(
				/^Content-Length:\s*(\d+)\s*$/im.exec(
					decoder.decode(bytes.subarray(offset, split))
				)?.[1]
			);
			const end = split + 4 + count;
			if (
				!Number.isSafeInteger(count) ||
				count < 0 ||
				split + 3 >= bytes.length ||
				end > bytes.length
			)
				throw new Error('Invalid V LSP response frame');
			messages.push(JSON.parse(decoder.decode(bytes.subarray(split + 4, end))));
			offset = end;
		}
		return messages;
	}
	return {
		async dispatch(message: {
			method?: string;
			params?: {
				rootUri?: unknown;
				textDocument?: { uri?: unknown; text?: unknown };
				contentChanges?: Array<{ text?: unknown }>;
			};
		}): Promise<unknown[]> {
			if (message.method === 'initialize') {
				const root = documentPath(message.params?.rootUri);
				if (root) module.FS.mkdirTree(root);
			}
			const uri = message.params?.textDocument?.uri;
			const filename = documentPath(uri);
			const text =
				message.method === 'textDocument/didOpen'
					? message.params?.textDocument?.text
					: message.method === 'textDocument/didChange'
						? message.params?.contentChanges?.[0]?.text
						: undefined;
			let created = false;
			if (filename && typeof text === 'string') {
				created = !module.FS.analyzePath(filename).exists;
				module.FS.mkdirTree(filename.slice(0, filename.lastIndexOf('/')) || '/');
				module.FS.writeFile(filename, text);
			}
			const responses = await dispatchOriginal(message);
			// The browser filesystem has no watcher. Deliver its create event to upstream's existing index handler.
			if (created)
				responses.push(
					...(await dispatchOriginal({
						jsonrpc: '2.0',
						method: 'workspace/didChangeWatchedFiles',
						params: { changes: [{ uri, type: 1 }] }
					}))
				);
			return responses;
		}
	};
}
