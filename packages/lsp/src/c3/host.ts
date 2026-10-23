import { gunzipSync } from 'fflate';

interface C3Module {
	HEAPU8: Uint8Array;
	FS: { mkdirTree(path: string): void; writeFile(path: string, content: string): void };
	_lsp_init(): void;
	_lsp_alloc(length: number): number;
	_lsp_free(pointer: number): void;
	_lsp_handle(pointer: number, length: number): void;
	_lsp_response_ptr(): number;
	_lsp_response_len(): number;
}
export interface C3LspHostAssets {
	moduleBytes: Uint8Array;
	wasmBytes: Uint8Array;
	stdlibBytes: Uint8Array;
}

/** Hosts verified Emscripten bytes and the original standard library; upstream handles every message. */
export async function createC3LspHost(assets: C3LspHostAssets) {
	const moduleUrl = URL.createObjectURL(
		new Blob([Uint8Array.from(assets.moduleBytes).buffer], { type: 'text/javascript' })
	);
	let factory;
	try {
		factory = (await import(/* @vite-ignore */ moduleUrl)).default;
	} finally {
		URL.revokeObjectURL(moduleUrl);
	}
	if (typeof factory !== 'function') throw new Error('C3 LSP loader has no factory');
	const module = (await factory({
		wasmBinary: assets.wasmBytes,
		// wasmBinary supplies the verified bytes; a stable virtual base avoids resolving against a Blob URL.
		locateFile: (name: string) => new URL(name, 'https://wasm-idle.invalid/c3-lsp/').href,
		print: (line: string) => console.debug(`[C3 LSP stdout] ${line}`),
		printErr: (line: string) => console.debug(`[C3 LSP stderr] ${line}`)
	})) as C3Module;
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const stdlib = JSON.parse(decoder.decode(gunzipSync(assets.stdlibBytes)));
	for (const [relative, content] of Object.entries(stdlib)) {
		if (
			typeof content !== 'string' ||
			!/\.c3i?$/.test(relative) ||
			relative.split('/').some((part) => !part || part === '.' || part === '..')
		)
			throw new Error('Invalid C3 standard library path');
		const filename = `/c3/lib/std/${relative}`;
		module.FS.mkdirTree(filename.slice(0, filename.lastIndexOf('/')));
		module.FS.writeFile(filename, content);
	}
	module._lsp_init();
	const encoder = new TextEncoder();
	return {
		dispatch(message: unknown): unknown[] {
			const payload = encoder.encode(JSON.stringify(message));
			const pointer = module._lsp_alloc(payload.length);
			try {
				module.HEAPU8.set(payload, pointer);
				module._lsp_handle(pointer, payload.length);
			} finally {
				module._lsp_free(pointer);
			}
			const start = module._lsp_response_ptr();
			const text = decoder.decode(
				module.HEAPU8.subarray(start, start + module._lsp_response_len())
			);
			return text.trim()
				? text
						.trim()
						.split('\n')
						.map((line) => JSON.parse(line))
				: [];
		}
	};
}
