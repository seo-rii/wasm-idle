import { ConsoleStdout, File, OpenFile, WASI } from '@bjorn3/browser_wasi_shim';

interface ForthLspExports extends WebAssembly.Exports {
	memory: WebAssembly.Memory;
	lsp_alloc: (length: number) => number;
	lsp_dealloc: (pointer: number, length: number) => void;
	lsp_handle: (pointer: number, length: number) => number;
	lsp_response_len: () => number;
}

/** Only the WASI and allocation ABI are hosted here; upstream dispatches every LSP message. */
export async function createForthLspHost(bytes: Uint8Array) {
	const wasi = new WASI(
		[],
		[],
		[
			new OpenFile(new File([])),
			ConsoleStdout.lineBuffered((line) => console.debug(`[Forth LSP stdout] ${line}`)),
			ConsoleStdout.lineBuffered((line) => console.debug(`[Forth LSP stderr] ${line}`))
		]
	);
	const module = await WebAssembly.compile(Uint8Array.from(bytes));
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasi.wasiImport
	});
	const exports = instance.exports as ForthLspExports;
	if (!(exports.memory instanceof WebAssembly.Memory)) {
		throw new Error('Forth LSP reactor is missing exported memory');
	}
	for (const name of ['lsp_alloc', 'lsp_dealloc', 'lsp_handle', 'lsp_response_len']) {
		if (typeof exports[name] !== 'function') {
			throw new Error(`Forth LSP reactor is missing ${name}`);
		}
	}
	wasi.initialize({ exports });
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	return {
		dispatch(message: unknown): unknown[] {
			const payload = encoder.encode(JSON.stringify(message));
			const input = exports.lsp_alloc(payload.length);
			let output: number;
			try {
				new Uint8Array(exports.memory.buffer, input, payload.length).set(payload);
				output = exports.lsp_handle(input, payload.length);
			} finally {
				exports.lsp_dealloc(input, payload.length);
			}
			if (output === 0) return [];
			const length = exports.lsp_response_len();
			let response: Uint8Array;
			try {
				// Memory growth during the next wasm call can detach this buffer.
				response = new Uint8Array(exports.memory.buffer, output, length).slice();
			} finally {
				exports.lsp_dealloc(output, length);
			}
			const messages = JSON.parse(decoder.decode(response));
			if (!Array.isArray(messages))
				throw new Error('Forth LSP reactor returned invalid messages');
			return messages;
		}
	};
}
