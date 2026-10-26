import type { GccWasmInspection } from './types.js';

/** Probe actual v128 instructions in the current Wasm engine, independently of host CPU names. */
export function supportsGccWasmSimd(): boolean {
	// () -> (), v128.const followed by drop. No compiler or runtime asset is fetched.
	return WebAssembly.validate(
		Uint8Array.from([
			0,
			97,
			115,
			109,
			1,
			0,
			0,
			0,
			1,
			4,
			1,
			0x60,
			0,
			0,
			3,
			2,
			1,
			0,
			10,
			23,
			1,
			21,
			0,
			0xfd,
			0x0c,
			...Array<number>(16).fill(0),
			0x1a,
			0x0b
		])
	);
}

/** Compile and inspect one private snapshot. Execution must use this same module. */
export async function compileGccWasm(input: Uint8Array, emit: 'object' | 'executable') {
	if (!(input instanceof Uint8Array) || (emit !== 'object' && emit !== 'executable'))
		throw new Error('Invalid GCC WebAssembly inspection request');
	const bytes = Uint8Array.from(input);
	if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((byte, i) => bytes[i] === byte))
		throw new Error('GCC did not produce a WebAssembly 1 binary');
	let position = 8;
	const features = { simd128: false };
	function byte(end: number) {
		if (position >= end) throw new Error('Truncated GCC WebAssembly section');
		return bytes[position++];
	}
	function unsigned(end: number) {
		let value = 0;
		for (let shift = 0; shift <= 28; shift += 7) {
			const next = byte(end);
			if (shift === 28 && next > 15) break;
			value += (next & 127) * 2 ** shift;
			if (next < 128) return value;
		}
		throw new Error('Invalid GCC WebAssembly section encoding');
	}
	function count(end: number) {
		const length = unsigned(end);
		if (length > end - position) throw new Error('Truncated GCC WebAssembly vector');
		return length;
	}
	function name(end: number) {
		const length = count(end);
		const text = new TextDecoder('utf-8', { fatal: true }).decode(
			bytes.subarray(position, position + length)
		);
		position += length;
		return text;
	}
	function valueType(end: number) {
		const type = byte(end);
		if (![0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f].includes(type))
			throw new Error('Unsupported GCC WebAssembly value type');
		if (type === 0x7b) features.simd128 = true;
		return type;
	}
	function skip(length: number, end: number) {
		if (length > end - position)
			throw new Error('Truncated GCC WebAssembly instruction immediate');
		position += length;
	}
	function signed(end: number, maximumBytes: number) {
		for (let remaining = maximumBytes; remaining > 0; remaining--) if (byte(end) < 128) return;
		throw new Error('Invalid GCC WebAssembly signed instruction immediate');
	}
	function memoryArgument(end: number) {
		const alignment = unsigned(end);
		if (alignment & 0x40) unsigned(end); // Explicit memory index in the multi-memory encoding.
		unsigned(end); // The profile rejects memory64 before accepting the module.
	}
	// Decode immediates to find actual instructions, never arbitrary 0xfd data bytes.
	// The engine remains the authority for full Wasm syntax and type validation.
	// https://webassembly.github.io/spec/core/binary/instructions.html
	function instruction(end: number) {
		const opcode = byte(end);
		if (
			[0x00, 0x01, 0x05, 0x0b, 0x0f, 0x1a, 0x1b, 0xd1, 0xd3, 0xd4].includes(opcode) ||
			(opcode >= 0x45 && opcode <= 0xc4)
		)
			return opcode;
		if (opcode >= 0x02 && opcode <= 0x04) {
			if (bytes[position] === 0x7b) features.simd128 = true;
			signed(end, 5); // s33: a value type, empty block, or function type index.
		} else if (
			[0x0c, 0x0d, 0x10, 0x12, 0x14, 0x15, 0x3f, 0x40, 0xd2, 0xd5, 0xd6].includes(opcode) ||
			(opcode >= 0x20 && opcode <= 0x26)
		) {
			unsigned(end);
		} else if (opcode === 0x0e) {
			for (let remaining = count(end); remaining > 0; remaining--) unsigned(end);
			unsigned(end);
		} else if (opcode === 0x11 || opcode === 0x13) {
			unsigned(end);
			unsigned(end);
		} else if (opcode === 0x1c) {
			for (let remaining = count(end); remaining > 0; remaining--) valueType(end);
		} else if (opcode >= 0x28 && opcode <= 0x3e) {
			memoryArgument(end);
		} else if (opcode === 0x41 || opcode === 0xd0) signed(end, 5);
		else if (opcode === 0x42) signed(end, 10);
		else if (opcode === 0x43) skip(4, end);
		else if (opcode === 0x44) skip(8, end);
		else if (opcode === 0xfc) {
			const extended = unsigned(end);
			if (extended > 17)
				throw new Error(
					`Unsupported GCC WebAssembly opcode: 0xfc ${extended.toString(16)}`
				);
			if (extended >= 8) unsigned(end);
			if ([8, 10, 12, 14].includes(extended)) unsigned(end);
		} else if (opcode === 0xfd) {
			const extended = unsigned(end);
			if (extended >= 0x100 && extended <= 0x113)
				throw new Error('GCC WASI does not support relaxed SIMD');
			if (
				extended > 0xff ||
				[
					0x9a, 0xa2, 0xa5, 0xa6, 0xaf, 0xb0, 0xb2, 0xb3, 0xb4, 0xbb, 0xc2, 0xc5, 0xc6,
					0xcf, 0xd0, 0xd2, 0xd3, 0xd4, 0xe2, 0xee
				].includes(extended)
			)
				throw new Error(
					`Unsupported GCC WebAssembly opcode: 0xfd ${extended.toString(16)}`
				);
			features.simd128 = true;
			if (extended <= 0x0b || (extended >= 0x54 && extended <= 0x5d)) memoryArgument(end);
			if (extended === 0x0c || extended === 0x0d) skip(16, end);
			if ((extended >= 0x15 && extended <= 0x22) || (extended >= 0x54 && extended <= 0x5b))
				skip(1, end);
		} else if (opcode === 0xfe) {
			throw new Error('GCC WASI does not support atomic instructions or threads');
		} else throw new Error(`Unsupported GCC WebAssembly opcode: 0x${opcode.toString(16)}`);
		return opcode;
	}
	function limits(end: number, memory: boolean) {
		const flags = unsigned(end);
		if (flags !== 0 && flags !== 1)
			throw new Error(
				memory
					? 'GCC WASI does not support shared memory, threads or memory64'
					: 'Unsupported GCC WebAssembly table limits'
			);
		const initialPages = unsigned(end);
		const maximumPages = flags === 1 ? unsigned(end) : undefined;
		return { initialPages, ...(maximumPages === undefined ? {} : { maximumPages }) };
	}
	let memory: GccWasmInspection['memory'];
	function readMemory(end: number) {
		if (memory) throw new Error('GCC WASI requires exactly one memory');
		memory = Object.freeze({ ...limits(end, true), shared: false });
	}
	const types: { parameters: number[]; results: number[] }[] = [];
	const functions: number[] = [];
	let startFunction: number | undefined;
	let linkingSections = 0;
	while (position < bytes.length) {
		const id = byte(bytes.length);
		const length = unsigned(bytes.length),
			end = position + length;
		if (end > bytes.length) throw new Error('Truncated GCC WebAssembly section');
		if (id === 0) {
			if (name(end) === 'linking') {
				if (++linkingSections !== 1 || unsigned(end) !== 2)
					throw new Error('Unsupported GCC Wasm object linking metadata');
			}
		} else if (id === 1) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				if (byte(end) !== 0x60)
					throw new Error('Unsupported GCC WebAssembly function type');
				const parameters = Array.from({ length: count(end) }, () => valueType(end));
				const results = Array.from({ length: count(end) }, () => valueType(end));
				types.push({ parameters, results });
			}
		} else if (id === 2) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				name(end);
				name(end);
				switch (byte(end)) {
					case 0:
						functions.push(unsigned(end));
						break;
					case 1:
						valueType(end);
						limits(end, false);
						break;
					case 2:
						readMemory(end);
						break;
					case 3:
						valueType(end);
						if (byte(end) > 1)
							throw new Error('Unsupported GCC WebAssembly global type');
						break;
					default:
						throw new Error('Unsupported GCC WebAssembly import kind');
				}
			}
		} else if (id === 3) {
			for (let remaining = count(end); remaining > 0; remaining--)
				functions.push(unsigned(end));
		} else if (id === 5) {
			for (let remaining = count(end); remaining > 0; remaining--) readMemory(end);
		} else if (id === 6) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				valueType(end);
				if (byte(end) > 1) throw new Error('Unsupported GCC WebAssembly global type');
				while (instruction(end) !== 0x0b) {
					/* Constant expression, checked by the engine. */
				}
			}
		} else if (id === 7) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				const exported = name(end),
					kind = byte(end),
					index = unsigned(end);
				if (exported === '_start' && kind === 0) startFunction = index;
			}
		} else if (id === 8) {
			// WASI imports need the instance's memory before the command is entered.
			throw new Error(
				'GCC WASI must enter through _start, without a WebAssembly start section'
			);
		} else if (id === 10) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				const size = unsigned(end),
					bodyEnd = position + size;
				if (bodyEnd > end) throw new Error('Truncated GCC WebAssembly function body');
				for (let locals = count(bodyEnd); locals > 0; locals--) {
					unsigned(bodyEnd);
					valueType(bodyEnd);
				}
				while (position < bodyEnd) instruction(bodyEnd);
			}
		} else if (id === 13 && unsigned(end) !== 0) {
			throw new Error('GCC WASI does not support exception tags');
		}
		position = end;
	}
	if (features.simd128 && !supportsGccWasmSimd())
		throw new Error('This WebAssembly engine does not support Wasm SIMD');
	if (emit === 'executable' && startFunction !== undefined) {
		const type = types[functions[startFunction]];
		if (!type || type.parameters.length || type.results.length)
			throw new Error('GCC WASI _start must have type () -> ()');
	}
	// The engine validates instruction encoding, indices, section order and limits.
	const module = await WebAssembly.compile(bytes);
	const imports = WebAssembly.Module.imports(module);
	const exports = WebAssembly.Module.exports(module);
	const hasLinkingMetadata = linkingSections === 1;
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
	return {
		module,
		inspection: Object.freeze({
			imports: Object.freeze(imports.map((entry) => Object.freeze(entry))),
			exports: Object.freeze(exports.map((entry) => Object.freeze(entry))),
			hasLinkingMetadata,
			features: Object.freeze(features),
			...(memory ? { memory } : {})
		}) satisfies GccWasmInspection
	};
}

/** Checks the binary container and executable ABI; this is not a source compiler. */
export async function inspectGccWasm(
	bytes: Uint8Array,
	emit: 'object' | 'executable'
): Promise<GccWasmInspection> {
	return (await compileGccWasm(bytes, emit)).inspection;
}
