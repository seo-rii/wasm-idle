import type { GccSharedMemoryProfile, GccWasmInspection } from './types.js';
import { inspectGccTlsMetadata } from './wasm-tls-metadata.js';

/** Exercise modern typed catches and exception references; Tag existence is insufficient. */
export function supportsGccWasmExceptions(): boolean {
	// WABT --enable-exceptions: nested try_table/catch_ref, (i32, exnref) block,
	// throw and throw_ref, caught by the outer typed handler. No assets are fetched.
	return WebAssembly.validate(
		Uint8Array.from([
			0, 97, 115, 109, 1, 0, 0, 0, 1, 13, 3, 96, 1, 127, 0, 96, 0, 0, 96, 0, 2, 127, 105, 3,
			2, 1, 1, 13, 3, 1, 0, 0, 10, 32, 1, 30, 0, 2, 127, 31, 64, 1, 0, 0, 0, 2, 2, 31, 64, 1,
			1, 0, 0, 65, 42, 8, 0, 11, 0, 11, 10, 11, 0, 11, 26, 11
		])
	);
}

export function supportsGccWasmAtomics(): boolean {
	const body = [0, 0x41, 0, 0x41, 1, 0xfe, 0x1e, 2, 0, 0x1a, 0xfe, 3, 0, 0x0b];
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
			5,
			3,
			1,
			0,
			1,
			10,
			body.length + 2,
			1,
			body.length,
			...body
		])
	);
}

export function snapshotGccSharedMemory(value: unknown): GccSharedMemoryProfile {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Invalid GCC shared memory profile');
	const input = value as Record<string, unknown>;
	if (
		Object.keys(input).some(
			(key) => !['entry', 'initialPages', 'maximumPages', 'reservedBytes'].includes(key)
		) ||
		typeof input.entry !== 'string' ||
		!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(input.entry) ||
		input.entry.startsWith('__wasm_') ||
		[
			'_start',
			'memory',
			'__stack_pointer',
			'__stack_low',
			'__stack_high',
			'__heap_base',
			'__data_end',
			'__tls_size',
			'__tls_align',
			'__tls_base'
		].includes(input.entry) ||
		!Number.isSafeInteger(input.initialPages) ||
		(input.initialPages as number) < 1 ||
		(input.initialPages as number) > 8192 ||
		input.maximumPages !== input.initialPages ||
		(input.reservedBytes !== undefined &&
			(!Number.isSafeInteger(input.reservedBytes) ||
				(input.reservedBytes as number) < 16 ||
				(input.reservedBytes as number) % 16 ||
				(input.reservedBytes as number) > (input.initialPages as number) * 65536 - 1024))
	)
		throw new Error(
			'GCC shared memory requires an explicit entry and equal bounded initial/maximum pages'
		);
	return Object.freeze({
		entry: input.entry,
		initialPages: input.initialPages as number,
		maximumPages: input.maximumPages as number,
		...(input.reservedBytes === undefined
			? {}
			: { reservedBytes: input.reservedBytes as number })
	});
}

type InspectionOptions = Readonly<{
	exceptions?: boolean;
	relaxedSimd?: boolean;
	atomics?: boolean;
	tls?: boolean;
	sharedMemory?: GccSharedMemoryProfile;
}>;

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

/** Probe every relaxed instruction separately from baseline SIMD support. */
export function supportsGccWasmRelaxedSimd(): boolean {
	return Array.from({ length: 20 }, (_, index) => {
		const opcode = 0x100 + index;
		const arity =
			opcode >= 0x101 && opcode <= 0x104
				? 1
				: (opcode >= 0x105 && opcode <= 0x10c) || opcode === 0x113
					? 3
					: 2;
		// (v128, v128, v128) -> (); actual relaxed operation followed by drop.
		const body = [
			0,
			...Array.from({ length: arity }, (_, argument) => [0x20, argument]).flat(),
			0xfd,
			(opcode & 0x7f) | 0x80,
			opcode >>> 7,
			0x1a,
			0x0b
		];
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
				7,
				1,
				0x60,
				3,
				0x7b,
				0x7b,
				0x7b,
				0,
				3,
				2,
				1,
				0,
				10,
				body.length + 2,
				1,
				body.length,
				...body
			])
		);
	}).every(Boolean);
}

/** Compile and inspect one private snapshot. Execution must use this same module. */
export async function compileGccWasm(
	input: Uint8Array,
	emit: 'object' | 'executable',
	options: InspectionOptions = {}
) {
	if (!(input instanceof Uint8Array) || (emit !== 'object' && emit !== 'executable'))
		throw new Error('Invalid GCC WebAssembly inspection request');
	if (
		!options ||
		typeof options !== 'object' ||
		Object.keys(options).some(
			(key) => !['exceptions', 'relaxedSimd', 'atomics', 'tls', 'sharedMemory'].includes(key)
		) ||
		(options.exceptions !== undefined && typeof options.exceptions !== 'boolean') ||
		(options.relaxedSimd !== undefined && typeof options.relaxedSimd !== 'boolean') ||
		(options.atomics !== undefined && typeof options.atomics !== 'boolean') ||
		(options.tls !== undefined && typeof options.tls !== 'boolean')
	)
		throw new Error('Invalid GCC WebAssembly inspection options');
	if (
		options.exceptions === true &&
		(options.sharedMemory || options.tls || options.atomics || options.relaxedSimd)
	)
		throw new Error('GCC exception combination is not qualified');
	const sharedMemory =
		options.sharedMemory === undefined
			? undefined
			: snapshotGccSharedMemory(options.sharedMemory);
	if (sharedMemory && (options.atomics !== true || emit !== 'executable'))
		throw new Error('GCC shared memory requires an opted-in atomic executable');
	if (sharedMemory && (options.tls === true) !== (sharedMemory.reservedBytes !== undefined))
		throw new Error('GCC shared TLS requires an explicit reservedBytes reservation');
	const bytes = Uint8Array.from(input);
	if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((byte, i) => bytes[i] === byte))
		throw new Error('GCC did not produce a WebAssembly 1 binary');
	let position = 8;
	const features: {
		simd128: boolean;
		relaxedSimd: boolean;
		atomics: boolean;
		bulkMemory: boolean;
		exceptions?: boolean;
		tls?: boolean;
	} = { simd128: false, relaxedSimd: false, atomics: false, bulkMemory: false };
	let atomicWait = false;
	const i32ConstantOffsets = new Set<number>();
	const exceptionTagOffsets = new Set<number>();
	const exceptionTagIndices = new Set<number>();
	const blockTypes = new Set<number>();
	function exceptionFeature() {
		if (options.exceptions !== true) throw new Error('GCC exceptions require explicit opt-in');
		features.exceptions = true;
	}
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
		if (![0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f, 0x69].includes(type))
			throw new Error('Unsupported GCC WebAssembly value type');
		if (type === 0x7b) features.simd128 = true;
		if (type === 0x69) exceptionFeature();
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
	function signedType(end: number) {
		const start = position;
		signed(end, 5);
		let value = 0,
			shift = 0;
		for (let index = start; index < position; index++, shift += 7)
			value += (bytes[index] & 127) * 2 ** shift;
		if (bytes[position - 1] & 64) value -= 2 ** shift;
		return value;
	}
	function blockType(end: number) {
		const value = signedType(end);
		if (value === -5) features.simd128 = true;
		if (value === -23) exceptionFeature();
		if (value >= 0) blockTypes.add(value);
	}
	function exceptionTag(end: number) {
		exceptionTagOffsets.add(position);
		exceptionTagIndices.add(unsigned(end));
	}
	// Decode immediates to find actual instructions, never arbitrary 0xfd data bytes.
	// The engine remains the authority for full Wasm syntax and type validation.
	// https://webassembly.github.io/spec/core/binary/instructions.html
	function instruction(end: number) {
		const opcode = byte(end);
		if ([0x06, 0x07, 0x09, 0x18, 0x19].includes(opcode))
			throw new Error('Legacy WebAssembly exception instructions are unsupported');
		if (opcode === 0x08 || opcode === 0x0a || opcode === 0x1f) {
			exceptionFeature();
			if (opcode === 0x08) exceptionTag(end);
			if (opcode === 0x1f) {
				blockType(end);
				for (let remaining = count(end); remaining > 0; remaining--) {
					const kind = byte(end);
					if (kind > 3) throw new Error('Invalid modern exception catch kind');
					if (kind < 2) exceptionTag(end);
					unsigned(end); // Label depth and catch payload types are engine-checked.
				}
			}
			return opcode;
		}
		if (
			[0x00, 0x01, 0x05, 0x0b, 0x0f, 0x1a, 0x1b, 0xd1, 0xd3, 0xd4].includes(opcode) ||
			(opcode >= 0x45 && opcode <= 0xc4)
		)
			return opcode;
		if (opcode >= 0x02 && opcode <= 0x04) {
			blockType(end); // s33: a value type, empty block, or function type index.
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
		} else if (opcode === 0x41) {
			i32ConstantOffsets.add(position);
			signed(end, 5);
		} else if (opcode === 0xd0) {
			if (signedType(end) === -23) exceptionFeature();
		} else if (opcode === 0x42) signed(end, 10);
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
			if (extended >= 8 && extended <= 11) features.bulkMemory = true;
			return 0xfc00 + extended;
		} else if (opcode === 0xfd) {
			const extended = unsigned(end);
			if (extended >= 0x100 && extended <= 0x113) {
				if (options.relaxedSimd !== true)
					throw new Error('GCC WASI relaxed SIMD requires explicit opt-in');
				features.simd128 = features.relaxedSimd = true;
				return opcode;
			}
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
			// User/generated objects still require -matomics. A qualified TLS runtime
			// may contribute atomic instructions only during final executable linking.
			if (options.atomics !== true && !(emit === 'executable' && options.tls === true))
				throw new Error('GCC atomic instructions require explicit opt-in');
			const extended = unsigned(end);
			if (extended > 0x4e || (extended > 3 && extended < 0x10))
				throw new Error('Unsupported GCC WebAssembly atomic opcode');
			features.atomics = true;
			if (extended === 3) {
				if (byte(end) !== 0) throw new Error('Invalid GCC atomic fence reserved byte');
			} else {
				const natural =
					extended < 3
						? extended === 2
							? 3
							: 2
						: [2, 3, 0, 1, 0, 1, 2][(extended - 0x10) % 7];
				if (unsigned(end) !== natural)
					throw new Error('GCC atomic instructions require exact natural alignment');
				unsigned(end);
				if (extended === 1 || extended === 2) atomicWait = true;
			}
			return 0xfe00 + extended;
		} else throw new Error(`Unsupported GCC WebAssembly opcode: 0x${opcode.toString(16)}`);
		return opcode;
	}
	function limits(end: number, memory: boolean) {
		const flags = unsigned(end);
		if (flags !== 0 && flags !== 1 && !(memory && flags === 3 && sharedMemory))
			throw new Error(
				memory
					? 'GCC WASI does not support shared memory, threads or memory64'
					: 'Unsupported GCC WebAssembly table limits'
			);
		const initialPages = unsigned(end);
		const maximumPages = flags & 1 ? unsigned(end) : undefined;
		return {
			initialPages,
			...(maximumPages === undefined ? {} : { maximumPages }),
			shared: flags === 3
		};
	}
	let memory: GccWasmInspection['memory'];
	function readMemory(end: number) {
		if (memory) throw new Error('GCC WASI requires exactly one memory');
		memory = Object.freeze(limits(end, true));
	}
	const types: { parameters: number[]; results: number[] }[] = [];
	const functions: number[] = [];
	const tags: number[] = [];
	function tagType(end: number) {
		exceptionFeature();
		if (byte(end) !== 0) throw new Error('Invalid GCC exception tag attribute');
		tags.push(unsigned(end));
	}
	const globals: { type: number; mutable: number; constant?: number }[] = [];
	const exportedIndices = new Map<string, { kind: number; index: number }>();
	const bodies = new Map<
		number,
		{
			empty: boolean;
			instructions: number[];
			start: number;
			end: number;
			localDeclarations: number;
		}
	>();
	let importedFunctions = 0,
		moduleStartFunction: number | undefined;
	let startFunction: number | undefined;
	let linkingSections = 0;
	const passiveDataSegments: number[] = [];
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
				const namespace = name(end),
					importedName = name(end);
				switch (byte(end)) {
					case 0:
						functions.push(unsigned(end));
						importedFunctions++;
						break;
					case 1:
						valueType(end);
						limits(end, false);
						break;
					case 2:
						readMemory(end);
						break;
					case 3: {
						const type = valueType(end),
							mutable = byte(end);
						if (mutable > 1) throw new Error('Unsupported GCC WebAssembly global type');
						globals.push({ type, mutable });
						break;
					}
					case 4:
						if (
							emit !== 'object' ||
							namespace !== 'env' ||
							importedName !== '__cpp_exception'
						)
							throw new Error('Unsupported GCC exception tag import');
						tagType(end);
						break;
					default:
						throw new Error('Unsupported GCC WebAssembly import kind');
				}
			}
		} else if (id === 3) {
			for (let remaining = count(end); remaining > 0; remaining--)
				functions.push(unsigned(end));
		} else if (id === 4) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				valueType(end);
				limits(end, false);
			}
		} else if (id === 5) {
			for (let remaining = count(end); remaining > 0; remaining--) readMemory(end);
		} else if (id === 6) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				const type = valueType(end),
					mutable = byte(end),
					expressionStart = position;
				if (mutable > 1) throw new Error('Unsupported GCC WebAssembly global type');
				while (instruction(end) !== 0x0b) {
					/* Constant expression, checked by the engine. */
				}
				let constant: number | undefined;
				if (type === 0x7f && bytes[expressionStart] === 0x41) {
					let value = 0,
						shift = 0,
						cursor = expressionStart + 1,
						next: number;
					do {
						next = bytes[cursor++];
						value |= (next & 127) << shift;
						shift += 7;
					} while (next & 128 && shift < 35);
					if (cursor === position - 1) {
						if (shift < 32 && next & 64) value |= -1 << shift;
						constant = value >>> 0;
					}
				}
				globals.push({ type, mutable, ...(constant === undefined ? {} : { constant }) });
			}
		} else if (id === 7) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				const exported = name(end),
					kind = byte(end),
					index = unsigned(end);
				if (exported === '_start' && kind === 0) startFunction = index;
				exportedIndices.set(exported, { kind, index });
			}
		} else if (id === 8) {
			// WASI imports need the instance's memory before the command is entered.
			if (!sharedMemory)
				throw new Error(
					'GCC WASI must enter through _start, without a WebAssembly start section'
				);
			moduleStartFunction = unsigned(end);
		} else if (id === 9) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				const flags = unsigned(end);
				if (flags > 7) throw new Error('Unsupported GCC WebAssembly element segment');
				if (flags === 2 || flags === 6) unsigned(end);
				if (!(flags & 1))
					while (instruction(end) !== 0x0b) {
						/* Active offset. */
					}
				if (flags & 4) {
					if (flags !== 4) valueType(end);
					for (let entries = count(end); entries > 0; entries--)
						while (instruction(end) !== 0x0b) {
							/* Reference constant. */
						}
				} else {
					if (flags !== 0 && byte(end) !== 0)
						throw new Error('Unsupported GCC WebAssembly element kind');
					for (let entries = count(end); entries > 0; entries--) unsigned(end);
				}
			}
		} else if (id === 10) {
			let functionIndex = importedFunctions;
			for (let remaining = count(end); remaining > 0; remaining--) {
				const size = unsigned(end),
					bodyEnd = position + size;
				if (bodyEnd > end) throw new Error('Truncated GCC WebAssembly function body');
				const localDeclarations = count(bodyEnd);
				for (let locals = localDeclarations; locals > 0; locals--) {
					unsigned(bodyEnd);
					valueType(bodyEnd);
				}
				const instructions = [],
					start = position;
				while (position < bodyEnd) instructions.push(instruction(bodyEnd));
				bodies.set(functionIndex++, {
					start,
					end: bodyEnd,
					localDeclarations,
					empty:
						localDeclarations === 0 &&
						instructions.length === 1 &&
						instructions[0] === 0x0b,
					instructions
				});
			}
		} else if (id === 11 && sharedMemory) {
			for (let remaining = count(end); remaining > 0; remaining--) {
				if (unsigned(end) !== 1)
					throw new Error('GCC shared memory requires passive data segments');
				const size = unsigned(end);
				passiveDataSegments.push(size);
				skip(size, end);
			}
		} else if (id === 13) {
			for (let remaining = count(end); remaining > 0; remaining--) tagType(end);
			if (position !== end) throw new Error('Trailing GCC exception tag bytes');
		}
		position = end;
	}
	for (const index of tags) {
		const type = types[index];
		if (
			!type ||
			type.parameters.length !== 1 ||
			type.parameters[0] !== 0x7f ||
			type.results.length
		)
			throw new Error('GCC exception tag must have one i32 payload and no results');
	}
	if (tags.length > 1 || [...exceptionTagIndices].some((index) => index >= tags.length))
		throw new Error('GCC exceptions require a single local C++ tag identity');
	if (features.exceptions && features.simd128)
		throw new Error('GCC exception/SIMD combination is not qualified');
	if (options.exceptions === true && !supportsGccWasmExceptions())
		throw new Error('This WebAssembly engine does not support modern exception handling');
	if (
		emit === 'object' &&
		linkingSections === 1 &&
		inspectGccTlsMetadata(bytes, i32ConstantOffsets)
	) {
		if (options.tls !== true) throw new Error('GCC TLS requires explicit opt-in');
		features.tls = true;
	}
	if (features.simd128 && !supportsGccWasmSimd())
		throw new Error('This WebAssembly engine does not support Wasm SIMD');
	if (features.relaxedSimd && !supportsGccWasmRelaxedSimd())
		throw new Error('This WebAssembly engine does not support relaxed SIMD');
	if (features.atomics && !supportsGccWasmAtomics())
		throw new Error('This WebAssembly engine does not support atomic instructions');
	if (emit === 'executable' && atomicWait && !memory?.shared)
		throw new Error('GCC atomic wait requires shared memory');
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
	let sharedEntry: GccWasmInspection['sharedEntry'];
	if (emit === 'object') {
		if (!hasLinkingMetadata)
			throw new Error('GCC Wasm object is missing relocatable linking metadata');
	} else if (sharedMemory) {
		if (
			!memory?.shared ||
			memory.initialPages !== sharedMemory.initialPages ||
			memory.maximumPages !== sharedMemory.maximumPages
		)
			throw new Error('GCC shared memory limits differ from the explicit profile');
		const memoryImports = imports.filter(
			(entry) => entry.kind === 'memory' && entry.module === 'env' && entry.name === 'memory'
		);
		const otherImports = imports.filter((entry) => !memoryImports.includes(entry));
		if (
			memoryImports.length !== 1 ||
			(options.tls === true
				? otherImports.length > 1 ||
					otherImports.some(
						(entry) =>
							entry.kind !== 'function' ||
							entry.module !== 'wasi_snapshot_preview1' ||
							entry.name !== 'sched_yield'
					) ||
					(otherImports.length === 1 &&
						(types[functions[0]].parameters.length !== 0 ||
							types[functions[0]].results.length !== 1 ||
							types[functions[0]].results[0] !== 0x7f))
				: otherImports.length !== 0)
		)
			throw new Error(
				options.tls === true
					? 'GCC shared TLS permits only env.memory and sched_yield () -> i32 imports'
					: 'GCC shared entry permits only the env.memory import'
			);
		if (exportedIndices.get('memory')?.kind !== 2 || startFunction !== undefined)
			throw new Error('GCC shared entry must export memory without WASI _start');
		const entry = exportedIndices.get(sharedMemory.entry);
		const type = entry?.kind === 0 ? types[functions[entry.index]] : undefined;
		if (
			!type ||
			type.parameters.some((item) => item !== 0x7f) ||
			type.results.length !== 1 ||
			type.results[0] !== 0x7f
		)
			throw new Error('GCC shared entry requires i32 arguments and one i32 result');
		function exportedGlobal(name: string, mutable: number) {
			const exported = exportedIndices.get(name);
			const global = exported?.kind === 3 ? globals[exported.index] : undefined;
			if (
				!global ||
				global.type !== 0x7f ||
				global.mutable !== mutable ||
				global.constant === undefined
			)
				throw new Error('Invalid GCC shared entry global: ' + name);
			return global.constant;
		}
		const dataEnd = exportedGlobal('__data_end', 0),
			heapBase = exportedGlobal('__heap_base', 0);
		if (
			exportedGlobal('__stack_pointer', 1) !== heapBase ||
			heapBase % 16 ||
			dataEnd > heapBase ||
			heapBase > memory.initialPages * 65536
		)
			throw new Error('Invalid GCC shared entry data/stack bounds');
		const tlsSize = exportedGlobal('__tls_size', 0);
		let tls: NonNullable<GccWasmInspection['sharedEntry']>['tls'];
		let tlsBaseIndex: number | undefined,
			tlsInitializer: { start: number; end: number; localDeclarations: number } | undefined,
			tlsSegment: number | undefined;
		if (options.tls === true) {
			const alignment = exportedGlobal('__tls_align', 0),
				reservedLow = exportedGlobal('__stack_low', 0),
				reservedHigh = exportedGlobal('__stack_high', 0);
			if (
				exportedGlobal('__tls_base', 1) !== 0 ||
				alignment < 1 ||
				!Number.isInteger(Math.log2(alignment)) ||
				alignment > memory.initialPages * 65536 ||
				tlsSize > sharedMemory.reservedBytes! ||
				reservedLow !== Math.ceil(dataEnd / 16) * 16 ||
				reservedHigh !== heapBase ||
				reservedHigh - reservedLow !== sharedMemory.reservedBytes
			)
				throw new Error('Invalid GCC shared TLS size, alignment or reserved bounds');
			for (const [name, parameters] of [
				['__wasm_init_tls', [0x7f]],
				['__wasm_call_thread_dtors', []]
			] as const) {
				const exported = exportedIndices.get(name),
					signature = exported?.kind === 0 ? types[functions[exported.index]] : undefined;
				if (
					!signature ||
					signature.results.length ||
					signature.parameters.length !== parameters.length ||
					signature.parameters.some((value, index) => value !== parameters[index])
				)
					throw new Error('Invalid GCC shared TLS runtime function: ' + name);
				if (name === '__wasm_init_tls') tlsInitializer = bodies.get(exported!.index);
			}
			tlsBaseIndex = exportedIndices.get('__tls_base')!.index;
			tls = Object.freeze({ size: tlsSize, alignment, reservedLow, reservedHigh });
			if (tlsSize) features.tls = true;
		} else if (
			tlsSize !== 0 ||
			exportedIndices.has('__tls_base') ||
			exportedIndices.has('__wasm_init_tls')
		)
			throw new Error('GCC shared TLS requires explicit opt-in');
		const constructors = exportedIndices.get('__wasm_call_ctors');
		if (constructors?.kind !== 0 || !bodies.get(constructors.index)?.empty)
			throw new Error('GCC shared entry does not support dynamic constructors');
		if (passiveDataSegments.length && moduleStartFunction === undefined)
			throw new Error('GCC shared passive data requires a one-time memory initializer');
		if (moduleStartFunction !== undefined || tls) {
			const startup =
				moduleStartFunction === undefined ? undefined : bodies.get(moduleStartFunction);
			const invalid = () =>
				new Error('GCC shared startup must be the guarded one-time memory initializer');
			if (moduleStartFunction !== undefined && (!startup || startup.localDeclarations !== 0))
				throw invalid();
			const savedPosition = position;
			let end = startup?.end ?? 0;
			try {
				const expectBytes = (...expected: number[]) => {
					for (const value of expected) if (byte(end) !== value) throw invalid();
				};
				const constant = (bits: 32 | 64 = 32) => {
					expectBytes(bits === 32 ? 0x41 : 0x42);
					let value = 0n,
						shift = 0n,
						next: number;
					do {
						if (shift >= (bits === 32 ? 35n : 70n)) throw invalid();
						next = byte(end);
						value |= BigInt(next & 127) << shift;
						shift += 7n;
					} while (next & 128);
					if (next & 64) value |= -1n << shift;
					return BigInt.asUintN(bits, value);
				};
				const expectConstant = (value: number) => {
					if (constant() !== BigInt(value >>> 0)) throw invalid();
				};
				const atomic = (opcode: number) => {
					expectBytes(0xfe);
					if (unsigned(end) !== opcode || unsigned(end) !== 2 || unsigned(end) !== 0)
						throw invalid();
				};
				if (tls) {
					if (!tlsInitializer || tlsInitializer.localDeclarations !== 0) throw invalid();
					position = tlsInitializer.start;
					end = tlsInitializer.end;
					if (tls.size) {
						expectBytes(0x20, 0, 0x24);
						if (unsigned(end) !== tlsBaseIndex) throw invalid();
						expectBytes(0x20, 0);
						expectConstant(0);
						expectConstant(tls.size);
						expectBytes(0xfc);
						if (unsigned(end) !== 8) throw invalid();
						tlsSegment = unsigned(end);
						if (passiveDataSegments[tlsSegment] !== tls.size || unsigned(end) !== 0)
							throw invalid();
					} else if (tls.alignment !== 1) throw invalid();
					expectBytes(0x0b);
					if (position !== end) throw invalid();
				}
				if (startup) {
					position = startup.start;
					end = startup.end;
					// Pinned LLD's three blocks route guard states 0/1/2 to the
					// initializer, waiter and completed paths respectively. An opcode
					// allowlist cannot establish this ownership/control-flow contract.
					expectBytes(0x02, 0x40, 0x02, 0x40, 0x02, 0x40);
					const guard = Number(constant());
					if (guard < 1024 || guard % 4 || guard + 4 > dataEnd) throw invalid();
					expectConstant(0);
					expectConstant(1);
					atomic(0x48);
					expectBytes(0x0e);
					for (const value of [2, 0, 1, 2]) if (unsigned(end) !== value) throw invalid();
					expectBytes(0x0b);
					const initialized = new Set<number>(),
						ranges: [number, number][] = [[guard, guard + 4]];
					let initializedTls = false;
					for (;;) {
						const destination = Number(constant());
						let value = Number(constant()),
							setsTlsBase = false;
						if (bytes[position] === 0x24) {
							if (
								!tls ||
								!tls.size ||
								initializedTls ||
								value !== destination ||
								destination % tls.alignment
							)
								throw invalid();
							expectBytes(0x24);
							if (unsigned(end) !== tlsBaseIndex) throw invalid();
							setsTlsBase = true;
							value = Number(constant());
						}
						if (bytes[position] === 0xfe) {
							if (setsTlsBase || destination !== guard || value !== 2)
								throw invalid();
							atomic(0x17);
							break;
						}
						if (value !== 0) throw invalid();
						const length = Number(constant()),
							high = destination + length;
						if (
							destination < 1024 ||
							high > dataEnd ||
							ranges.some(([low, end]) => destination < end && high > low)
						)
							throw invalid();
						ranges.push([destination, high]);
						expectBytes(0xfc);
						const opcode = unsigned(end);
						if (opcode === 8) {
							const segment = unsigned(end);
							if (initialized.has(segment) || passiveDataSegments[segment] !== length)
								throw invalid();
							if (setsTlsBase !== (segment === tlsSegment)) throw invalid();
							if (setsTlsBase) initializedTls = true;
							initialized.add(segment);
						} else if (opcode !== 11 || setsTlsBase) throw invalid();
						if (unsigned(end) !== 0) throw invalid();
					}
					if (initialized.size !== passiveDataSegments.length) throw invalid();
					if (tls?.size && !initializedTls) throw invalid();
					expectConstant(guard);
					expectConstant(0xffffffff);
					atomic(0);
					expectBytes(0x1a, 0x0c);
					if (unsigned(end) !== 1) throw invalid();
					expectBytes(0x0b);
					expectConstant(guard);
					expectConstant(1);
					if (constant(64) !== 0xffffffffffffffffn) throw invalid();
					atomic(1);
					expectBytes(0x1a, 0x0b);
					for (let segment = 0; segment < passiveDataSegments.length; segment++) {
						if (segment === tlsSegment) continue;
						expectBytes(0xfc);
						if (unsigned(end) !== 9 || unsigned(end) !== segment) throw invalid();
					}
					expectBytes(0x0b);
					if (position !== end) throw invalid();
				}
			} finally {
				position = savedPosition;
			}
		}
		if (!tls && [...bodies.values()].some((body) => body.instructions.includes(0x40)))
			throw new Error(
				'GCC shared entry does not support memory growth or allocator runtimes'
			);
		sharedEntry = Object.freeze({
			name: sharedMemory.entry,
			parameterCount: type.parameters.length,
			dataEnd,
			heapBase,
			...(tls ? { tls } : {})
		});
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
		// Internal operand positions for object relocation validation; never caller metadata.
		exceptionTagOffsets,
		requiresMultivalue:
			types.some((type) => type.results.length > 1) ||
			[...blockTypes].some((index) => (types[index]?.parameters.length ?? 0) > 0),
		inspection: Object.freeze({
			imports: Object.freeze(imports.map((entry) => Object.freeze(entry))),
			exports: Object.freeze(exports.map((entry) => Object.freeze(entry))),
			hasLinkingMetadata,
			features: Object.freeze(features),
			...(sharedEntry ? { sharedEntry } : {}),
			...(memory ? { memory } : {})
		}) satisfies GccWasmInspection
	};
}

/** Checks the binary container and executable ABI; this is not a source compiler. */
export async function inspectGccWasm(
	bytes: Uint8Array,
	emit: 'object' | 'executable',
	options: InspectionOptions = {}
): Promise<GccWasmInspection> {
	return (await compileGccWasm(bytes, emit, options)).inspection;
}
