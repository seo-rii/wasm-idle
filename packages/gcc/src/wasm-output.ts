import type { GccWasmInspection } from './types.js';

/** Checks the binary container and executable ABI; this is not a source compiler. */
export async function inspectGccWasm(
	bytes: Uint8Array,
	emit: 'object' | 'executable'
): Promise<GccWasmInspection> {
	if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((byte, i) => bytes[i] === byte))
		throw new Error('GCC did not produce a WebAssembly 1 binary');
	const module = await WebAssembly.compile(Uint8Array.from(bytes));
	const imports = WebAssembly.Module.imports(module);
	const exports = WebAssembly.Module.exports(module);
	const hasLinkingMetadata = WebAssembly.Module.customSections(module, 'linking').length !== 0;
	let position = 8;
	function unsigned(end: number) {
		let value = 0;
		for (let shift = 0; shift <= 28 && position < end; shift += 7) {
			const byte = bytes[position++];
			if (shift === 28 && byte > 15) break;
			value += (byte & 127) * 2 ** shift;
			if (byte < 128) return value;
		}
		throw new Error('Invalid GCC WebAssembly section encoding');
	}
	let memory: GccWasmInspection['memory'];
	while (position < bytes.length) {
		const id = bytes[position++];
		const length = unsigned(bytes.length),
			end = position + length;
		if (end > bytes.length) throw new Error('Truncated GCC WebAssembly section');
		if (id === 5) {
			if (unsigned(end) !== 1) throw new Error('GCC WASI requires exactly one memory');
			const flags = unsigned(end);
			if (flags !== 0 && flags !== 1)
				throw new Error('GCC WASI does not support shared memory, threads or memory64');
			const initialPages = unsigned(end);
			const maximumPages = flags === 1 ? unsigned(end) : undefined;
			memory = Object.freeze({
				initialPages,
				...(maximumPages === undefined ? {} : { maximumPages }),
				shared: false
			});
		}
		position = end;
	}
	if (emit === 'object') {
		if (!hasLinkingMetadata)
			throw new Error('GCC Wasm object is missing relocatable linking metadata');
	} else {
		if (
			!memory ||
			!exports.some((entry) => entry.name === 'memory' && entry.kind === 'memory') ||
			!exports.some((entry) => entry.name === '_start' && entry.kind === 'function')
		)
			throw new Error('GCC WASI executable must export memory and _start');
		for (const entry of imports)
			if (entry.module !== 'wasi_snapshot_preview1' || entry.kind !== 'function')
				throw new Error(
					`Unsupported GCC WASI import: ${entry.module}.${entry.name} (${entry.kind})`
				);
	}
	return Object.freeze({
		imports: Object.freeze(imports.map((entry) => Object.freeze(entry))),
		exports: Object.freeze(exports.map((entry) => Object.freeze(entry))),
		hasLinkingMetadata,
		...(memory ? { memory } : {})
	});
}
