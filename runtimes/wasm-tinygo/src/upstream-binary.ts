const WASM_HEADER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const LLVM_BITCODE_HEADER = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });

const WASM_SYMBOL_UNDEFINED = 0x10;
const WASM_SYMBOL_EXPLICIT_NAME = 0x40;
const WASM_SYMBOL_TLS = 0x100;
const WASM_SEGMENT_TLS = 0x2;
const WASM_RELOCATION_TYPES = new Set(Array.from({ length: 27 }, (_, index) => index));
const WASM_RELOCATIONS_WITH_ADDEND = new Set([
	3, 4, 5, 8, 9, 11, 14, 15, 16, 17, 21, 22, 23, 25
]);
const WASM_64_BIT_RELOCATIONS = new Set([14, 15, 16, 17, 18, 19, 22, 24, 25]);
const WASM_TLS_RELOCATIONS = new Set([21, 25]);
const MAX_WASM_SECTION_COUNT = 4096;
const MAX_WASM_CORE_VECTOR_COUNT = 65_536;
const WASM_RELOCATION_WIDTH = new Map<number, number>([
	...[0, 1, 3, 4, 6, 7, 10, 11, 12, 20, 21].map((type) => [type, 5] as const),
	...[2, 5, 8, 9, 13, 23, 26].map((type) => [type, 4] as const),
	...[14, 15, 17, 18, 24, 25].map((type) => [type, 10] as const),
	...[16, 19, 22].map((type) => [type, 8] as const)
]);
const FORBIDDEN_NATIVE_SYMBOL =
	/^(?:__cxa_|__gxx_personality_v0$|__clang_call_terminate$|__tls_|__emutls_|_Unwind_|atexit$|__wasm_(?:call_ctors|apply_data_relocs)$|__dso_handle$|__cxx_global_var_init(?:\.|$)|_GLOBAL__|_Z(?:n[aw]|d[al]|GV|TI|TS|Z|TV)|_ZN(?:K?St)|_ZSt|llvm\.global_(?:ctors|dtors)$)/u;
const FORBIDDEN_NATIVE_SEGMENT =
	/^(?:\.preinit_array|\.init_array|\.fini_array|\.ctors|\.dtors)(?:\.|$)/u;
const ALLOWED_ENABLED_TARGET_FEATURES = new Set([
	'bulk-memory',
	'bulk-memory-opt',
	'call-indirect-overlong',
	'mutable-globals',
	'nontrapping-fptoint',
	'sign-ext'
]);
const ALLOWED_DISABLED_TARGET_FEATURES = new Set(['multivalue', 'reference-types']);
const ALLOWED_LINKED_TARGET_FEATURES = new Set([
	...ALLOWED_ENABLED_TARGET_FEATURES,
	...ALLOWED_DISABLED_TARGET_FEATURES
]);
const FORBIDDEN_TARGET_FEATURES = new Set([
	'atomics',
	'exception-handling',
	'shared-mem',
	'shared-memory',
	'simd128',
	'threads'
]);
const UPSTREAM_PROGRAM_EXPORTS = new Set([
	'malloc',
	'__libc_malloc',
	'aligned_alloc',
	'free',
	'__libc_free',
	'calloc',
	'__libc_calloc',
	'realloc',
	'__libc_realloc',
	'_start'
]);

interface WasmSection {
	id: number;
	index: number;
	payloadStart: number;
	payloadEnd: number;
	customName?: string;
	customPayloadStart?: number;
}

interface WasmObjectMetadata {
	symbolCount: number;
	symbolTable: boolean;
	linkingVersion: number;
}

interface WasmCoreInspection {
	types: Array<{ parameters: number; results: number }>;
	importedFunctionTypes: number[];
	definedFunctionTypes: number[];
	exports: Array<{ name: string; kind: number; index: number }>;
}

type WasmObjectProfile = 'auxiliary' | 'upstream-program';

function hasHeader(bytes: Uint8Array, header: Uint8Array) {
	return (
		bytes.byteLength >= header.byteLength &&
		header.every((value, index) => bytes[index] === value)
	);
}

function readU32(bytes: Uint8Array, start: number, limit: number, label: string) {
	let value = 0;
	let shift = 0;
	for (let offset = start; offset < limit && offset < start + 5; offset += 1) {
		const byte = bytes[offset];
		if (byte === undefined) break;
		if (offset === start + 4 && (byte & 0xf0) !== 0) {
			throw new Error(`${label} contains an overflowing WebAssembly u32`);
		}
		value += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) return { value, next: offset + 1 };
		shift += 7;
	}
	throw new Error(`${label} contains a truncated WebAssembly u32`);
}

function skipSignedLeb(
	bytes: Uint8Array,
	start: number,
	limit: number,
	maximumBytes: number,
	label: string
) {
	for (let offset = start; offset < limit && offset < start + maximumBytes; offset += 1) {
		const byte = bytes[offset];
		if (byte !== undefined && (byte & 0x80) === 0) return offset + 1;
	}
	throw new Error(`${label} contains a truncated signed WebAssembly integer`);
}

function readName(bytes: Uint8Array, start: number, limit: number, label: string) {
	const size = readU32(bytes, start, limit, label);
	const end = size.next + size.value;
	if (end > limit) throw new Error(`${label} contains a truncated WebAssembly name`);
	let value: string;
	try {
		value = UTF8.decode(bytes.subarray(size.next, end));
	} catch (error) {
		throw new Error(`${label} contains a non-UTF-8 WebAssembly name`, { cause: error });
	}
	return { value, next: end };
}

function parseWasmSections(bytes: Uint8Array, label: string) {
	if (!hasHeader(bytes, WASM_HEADER)) {
		throw new Error(`${label} does not have a WebAssembly header`);
	}
	const sections: WasmSection[] = [];
	let offset = WASM_HEADER.byteLength;
	while (offset < bytes.byteLength) {
		const id = bytes[offset];
		if (id === undefined) throw new Error(`${label} has a truncated WebAssembly section`);
		offset += 1;
		const size = readU32(bytes, offset, bytes.byteLength, label);
		const payloadStart = size.next;
		const payloadEnd = payloadStart + size.value;
		if (payloadEnd > bytes.byteLength) {
			throw new Error(`${label} has a truncated WebAssembly section`);
		}
		if (sections.length >= MAX_WASM_SECTION_COUNT) {
			throw new Error(`${label} exceeds the WebAssembly section-count limit`);
		}
		const section: WasmSection = {
			id,
			index: sections.length,
			payloadStart,
			payloadEnd
		};
		if (id === 0) {
			const name = readName(bytes, payloadStart, payloadEnd, label);
			section.customName = name.value;
			section.customPayloadStart = name.next;
		}
		sections.push(section);
		offset = payloadEnd;
	}
	if (!WebAssembly.validate(Uint8Array.from(bytes))) {
		throw new Error(`${label} is not a structurally valid WebAssembly module`);
	}
	return sections;
}

function readLimits(bytes: Uint8Array, start: number, end: number, label: string) {
	const flags = readU32(bytes, start, end, label);
	if ((flags.value & ~0x1) !== 0) {
		throw new Error(`${label} contains unsupported WebAssembly limits flags`);
	}
	let cursor = readU32(bytes, flags.next, end, label).next;
	if ((flags.value & 1) !== 0) cursor = readU32(bytes, cursor, end, label).next;
	return cursor;
}

function assertProtocolLimits(
	bytes: Uint8Array,
	sections: readonly WasmSection[],
	label: string
) {
	let memoryCount = 0;
	let tableCount = 0;
	for (const section of sections) {
		if (section.id === 5) {
			let cursor = section.payloadStart;
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			memoryCount += count.value;
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				cursor = readLimits(bytes, cursor, section.payloadEnd, label);
			}
			if (cursor !== section.payloadEnd) {
				throw new Error(`${label} has trailing WebAssembly memory metadata`);
			}
		} else if (section.id === 2) {
			let cursor = section.payloadStart;
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				const moduleName = readName(bytes, cursor, section.payloadEnd, label);
				const fieldName = readName(bytes, moduleName.next, section.payloadEnd, label);
				cursor = fieldName.next;
				const kind = bytes[cursor];
				if (kind === undefined || kind > 4) {
					throw new Error(`${label} import ${index} has an invalid kind`);
				}
				cursor += 1;
				if (kind === 0) {
					cursor = readU32(bytes, cursor, section.payloadEnd, label).next;
				} else if (kind === 1) {
					tableCount += 1;
					if (cursor >= section.payloadEnd) {
						throw new Error(`${label} has a truncated table import`);
					}
					cursor += 1;
					cursor = readLimits(bytes, cursor, section.payloadEnd, label);
				} else if (kind === 2) {
					memoryCount += 1;
					cursor = readLimits(bytes, cursor, section.payloadEnd, label);
				} else if (kind === 3) {
					if (cursor + 2 > section.payloadEnd) {
						throw new Error(`${label} has a truncated global import`);
					}
					cursor += 2;
				} else {
					throw new Error(`${label} contains a forbidden tag import`);
				}
			}
			if (cursor !== section.payloadEnd) {
				throw new Error(`${label} has trailing WebAssembly import metadata`);
			}
		} else if (section.id === 4) {
			let cursor = section.payloadStart;
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			tableCount += count.value;
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				if (cursor >= section.payloadEnd) {
					throw new Error(`${label} has a truncated table definition`);
				}
				cursor = readLimits(bytes, cursor + 1, section.payloadEnd, label);
			}
			if (cursor !== section.payloadEnd) {
				throw new Error(`${label} has trailing WebAssembly table metadata`);
			}
		}
	}
	if (memoryCount > 1) throw new Error(`${label} contains more than one linear memory`);
	if (tableCount > 1) throw new Error(`${label} contains more than one table`);
}

function inspectWasmCoreFeatures(
	bytes: Uint8Array,
	sections: readonly WasmSection[],
	label: string
): WasmCoreInspection {
	const types: Array<{ parameters: number; results: number }> = [];
	const importedFunctionTypes: number[] = [];
	const definedFunctionTypes: number[] = [];
	const exports: Array<{ name: string; kind: number; index: number }> = [];
	const assertVectorCount = (value: number, kind: string) => {
		if (value > MAX_WASM_CORE_VECTOR_COUNT) {
			throw new Error(`${label} ${kind} exceeds the core vector-count limit`);
		}
	};
	const readNumericValueType = (cursor: number, end: number, context: string) => {
		const valueType = bytes[cursor];
		if (valueType === undefined || cursor >= end) {
			throw new Error(`${label} has a truncated ${context} value type`);
		}
		if (valueType === 0x7b) throw new Error(`${label} contains forbidden v128 value types`);
		if (![0x7f, 0x7e, 0x7d, 0x7c].includes(valueType)) {
			throw new Error(`${label} contains forbidden reference or extended value types`);
		}
		return cursor + 1;
	};
	const scanExpression = (start: number, end: number) => {
		let cursor = start;
		let depth = 1;
		while (cursor < end) {
			const opcode = bytes[cursor];
			if (opcode === undefined) throw new Error(`${label} has a truncated instruction`);
			cursor += 1;
			if (opcode === 0x0b) {
				depth -= 1;
				if (depth === 0) return cursor;
				continue;
			}
			if (opcode >= 0x06 && opcode <= 0x0a) {
				throw new Error(`${label} contains forbidden exception-handling instructions`);
			}
			if ([0x12, 0x13, 0x14, 0x15, 0x18, 0x19, 0x1f].includes(opcode)) {
				throw new Error(`${label} contains forbidden tail-call, reference, or exception instructions`);
			}
			if (opcode === 0x02 || opcode === 0x03 || opcode === 0x04) {
				depth += 1;
				const blockType = bytes[cursor];
				if (blockType === undefined) throw new Error(`${label} has a truncated block type`);
				if (blockType === 0x40) cursor += 1;
				else cursor = readNumericValueType(cursor, end, 'block');
			} else if (opcode === 0x0c || opcode === 0x0d || opcode === 0x10) {
				cursor = readU32(bytes, cursor, end, label).next;
			} else if (opcode === 0x0e) {
				const count = readU32(bytes, cursor, end, label);
				assertVectorCount(count.value, 'branch table');
				cursor = count.next;
				for (let index = 0; index <= count.value; index += 1) {
					cursor = readU32(bytes, cursor, end, label).next;
				}
			} else if (opcode === 0x11) {
				cursor = readU32(bytes, cursor, end, label).next;
				const tableIndex = readU32(bytes, cursor, end, label);
				if (tableIndex.value !== 0) {
					throw new Error(`${label} contains a nonzero call_indirect table index`);
				}
				cursor = tableIndex.next;
			} else if (opcode === 0x1c || opcode === 0x25 || opcode === 0x26) {
				throw new Error(`${label} contains forbidden reference-type instructions`);
			} else if (opcode >= 0x20 && opcode <= 0x24) {
				cursor = readU32(bytes, cursor, end, label).next;
			} else if (opcode >= 0x28 && opcode <= 0x3e) {
				cursor = readU32(bytes, cursor, end, label).next;
				cursor = readU32(bytes, cursor, end, label).next;
			} else if (opcode === 0x3f || opcode === 0x40) {
				const memoryIndex = readU32(bytes, cursor, end, label);
				if (memoryIndex.value !== 0) {
					throw new Error(`${label} contains a nonzero memory instruction index`);
				}
				cursor = memoryIndex.next;
			} else if (opcode === 0x41) {
				cursor = skipSignedLeb(bytes, cursor, end, 5, label);
			} else if (opcode === 0x42) {
				cursor = skipSignedLeb(bytes, cursor, end, 10, label);
			} else if (opcode === 0x43 || opcode === 0x44) {
				cursor += opcode === 0x43 ? 4 : 8;
				if (cursor > end) throw new Error(`${label} has a truncated floating constant`);
			} else if (opcode === 0xfc) {
				const subopcode = readU32(bytes, cursor, end, label);
				cursor = subopcode.next;
				if (subopcode.value <= 7) continue;
				if (subopcode.value === 8) {
					cursor = readU32(bytes, cursor, end, label).next;
					const memoryIndex = readU32(bytes, cursor, end, label);
					if (memoryIndex.value !== 0) {
						throw new Error(`${label} contains a nonzero bulk-memory instruction index`);
					}
					cursor = memoryIndex.next;
				} else if (subopcode.value === 9) {
					cursor = readU32(bytes, cursor, end, label).next;
				} else if (subopcode.value === 10) {
					const destinationMemory = readU32(bytes, cursor, end, label);
					const sourceMemory = readU32(bytes, destinationMemory.next, end, label);
					if (destinationMemory.value !== 0 || sourceMemory.value !== 0) {
						throw new Error(`${label} contains a nonzero bulk-memory instruction index`);
					}
					cursor = sourceMemory.next;
				} else if (subopcode.value === 11) {
					const memoryIndex = readU32(bytes, cursor, end, label);
					if (memoryIndex.value !== 0) {
						throw new Error(`${label} contains a nonzero bulk-memory instruction index`);
					}
					cursor = memoryIndex.next;
				} else {
					throw new Error(`${label} contains forbidden reference-type prefixed instructions`);
				}
			} else if (opcode === 0xfd) {
				throw new Error(`${label} contains forbidden SIMD instructions`);
			} else if (opcode === 0xfe) {
				throw new Error(`${label} contains forbidden atomic instructions`);
			} else if (opcode === 0xfb || opcode >= 0xd0) {
				throw new Error(`${label} contains forbidden GC or reference-type instructions`);
			} else if (
				!((opcode >= 0x00 && opcode <= 0x05) ||
					opcode === 0x0f ||
					opcode === 0x1a ||
					opcode === 0x1b ||
					(opcode >= 0x45 && opcode <= 0xc4))
			) {
				throw new Error(`${label} contains an instruction outside the protocol`);
			}
		}
		throw new Error(`${label} has an unterminated instruction expression`);
	};

	for (const section of sections) {
		let cursor = section.payloadStart;
		if (section.id === 1) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'type section');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				if (bytes[cursor] !== 0x60) throw new Error(`${label} contains non-function core types`);
				cursor += 1;
				const parameterCount = readU32(bytes, cursor, section.payloadEnd, label);
				assertVectorCount(parameterCount.value, 'function parameters');
				cursor = parameterCount.next;
				for (let parameter = 0; parameter < parameterCount.value; parameter += 1) {
					cursor = readNumericValueType(cursor, section.payloadEnd, 'parameter');
				}
				const resultCount = readU32(bytes, cursor, section.payloadEnd, label);
				assertVectorCount(resultCount.value, 'function results');
				if (resultCount.value > 1) throw new Error(`${label} contains multivalue function types`);
				cursor = resultCount.next;
				for (let result = 0; result < resultCount.value; result += 1) {
					cursor = readNumericValueType(cursor, section.payloadEnd, 'result');
				}
				types.push({ parameters: parameterCount.value, results: resultCount.value });
			}
		} else if (section.id === 2) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'imports');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				const moduleName = readName(bytes, cursor, section.payloadEnd, label);
				const fieldName = readName(bytes, moduleName.next, section.payloadEnd, label);
				cursor = fieldName.next;
				const kind = bytes[cursor];
				if (kind === undefined) throw new Error(`${label} has a truncated import`);
				cursor += 1;
				if (kind === 0) {
					const typeIndex = readU32(bytes, cursor, section.payloadEnd, label);
					cursor = typeIndex.next;
					importedFunctionTypes.push(typeIndex.value);
				} else if (kind === 1) {
					if (bytes[cursor] !== 0x70) {
						throw new Error(`${label} contains forbidden extended table references`);
					}
					cursor = readLimits(bytes, cursor + 1, section.payloadEnd, label);
				} else if (kind === 2) {
					cursor = readLimits(bytes, cursor, section.payloadEnd, label);
				} else if (kind === 3) {
					cursor = readNumericValueType(cursor, section.payloadEnd, 'global import');
					const mutability = bytes[cursor];
					if (mutability !== 0 && mutability !== 1) {
						throw new Error(`${label} has invalid global mutability`);
					}
					cursor += 1;
				} else {
					throw new Error(`${label} contains forbidden tag imports`);
				}
			}
		} else if (section.id === 3) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'defined functions');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				const typeIndex = readU32(bytes, cursor, section.payloadEnd, label);
				cursor = typeIndex.next;
				definedFunctionTypes.push(typeIndex.value);
			}
		} else if (section.id === 4) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'tables');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				if (bytes[cursor] !== 0x70) {
					throw new Error(`${label} contains forbidden extended table references`);
				}
				cursor = readLimits(bytes, cursor + 1, section.payloadEnd, label);
			}
		} else if (section.id === 6) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'globals');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				cursor = readNumericValueType(cursor, section.payloadEnd, 'global');
				const mutability = bytes[cursor];
				if (mutability !== 0 && mutability !== 1) {
					throw new Error(`${label} has invalid global mutability`);
				}
				cursor = scanExpression(cursor + 1, section.payloadEnd);
			}
		} else if (section.id === 7) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'exports');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				const name = readName(bytes, cursor, section.payloadEnd, label);
				cursor = name.next;
				const kind = bytes[cursor];
				if (kind === undefined || kind > 4) throw new Error(`${label} has an invalid export`);
				cursor += 1;
				const itemIndex = readU32(bytes, cursor, section.payloadEnd, label);
				cursor = itemIndex.next;
				exports.push({ name: name.value, kind, index: itemIndex.value });
			}
		} else if (section.id === 9) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'element segments');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				const flags = readU32(bytes, cursor, section.payloadEnd, label);
				cursor = flags.next;
				if (flags.value > 3) throw new Error(`${label} contains reference-type element segments`);
				if (flags.value === 0 || flags.value === 2) {
					if (flags.value === 2) cursor = readU32(bytes, cursor, section.payloadEnd, label).next;
					cursor = scanExpression(cursor, section.payloadEnd);
				}
				if (flags.value !== 0) {
					if (bytes[cursor] !== 0) throw new Error(`${label} has a non-function element kind`);
					cursor += 1;
				}
				const functions = readU32(bytes, cursor, section.payloadEnd, label);
				assertVectorCount(functions.value, 'element functions');
				cursor = functions.next;
				for (let functionIndex = 0; functionIndex < functions.value; functionIndex += 1) {
					cursor = readU32(bytes, cursor, section.payloadEnd, label).next;
				}
			}
		} else if (section.id === 10) {
			const count = readU32(bytes, cursor, section.payloadEnd, label);
			assertVectorCount(count.value, 'function bodies');
			cursor = count.next;
			for (let index = 0; index < count.value; index += 1) {
				const bodySize = readU32(bytes, cursor, section.payloadEnd, label);
				cursor = bodySize.next;
				const bodyEnd = cursor + bodySize.value;
				if (bodyEnd > section.payloadEnd) throw new Error(`${label} has a truncated function body`);
				const localGroups = readU32(bytes, cursor, bodyEnd, label);
				assertVectorCount(localGroups.value, 'local groups');
				cursor = localGroups.next;
				for (let group = 0; group < localGroups.value; group += 1) {
					const locals = readU32(bytes, cursor, bodyEnd, label);
					assertVectorCount(locals.value, 'locals');
					cursor = readNumericValueType(locals.next, bodyEnd, 'local');
				}
				cursor = scanExpression(cursor, bodyEnd);
				if (cursor !== bodyEnd) throw new Error(`${label} has trailing function-body bytes`);
			}
		}
		if (
			[1, 2, 3, 4, 6, 7, 9, 10].includes(section.id) &&
			cursor !== section.payloadEnd
		) {
			throw new Error(`${label} has trailing core section metadata`);
		}
	}
	for (const typeIndex of [...importedFunctionTypes, ...definedFunctionTypes]) {
		if (!types[typeIndex]) throw new Error(`${label} function references an unknown type`);
	}
	return { types, importedFunctionTypes, definedFunctionTypes, exports };
}

function parseSegmentInfo(
	bytes: Uint8Array,
	start: number,
	end: number,
	label: string
) {
	let cursor = start;
	const count = readU32(bytes, cursor, end, label);
	cursor = count.next;
	for (let index = 0; index < count.value; index += 1) {
		const name = readName(bytes, cursor, end, label);
		cursor = name.next;
		if (FORBIDDEN_NATIVE_SEGMENT.test(name.value)) {
			throw new Error(`${label} contains forbidden native lifetime segment ${name.value}`);
		}
		const alignment = readU32(bytes, cursor, end, label);
		cursor = alignment.next;
		if (alignment.value > 31) {
			throw new Error(`${label} linking segment ${index} has an invalid alignment`);
		}
		const flags = readU32(bytes, cursor, end, label);
		cursor = flags.next;
		if ((flags.value & ~0x7) !== 0) {
			throw new Error(`${label} linking segment ${index} has unknown flags`);
		}
		if ((flags.value & WASM_SEGMENT_TLS) !== 0) {
			throw new Error(`${label} contains forbidden thread-local storage metadata`);
		}
	}
	if (cursor !== end) throw new Error(`${label} has trailing linking segment metadata`);
}

function parseInitFunctions(bytes: Uint8Array, start: number, end: number, label: string) {
	let cursor = start;
	const count = readU32(bytes, cursor, end, label);
	cursor = count.next;
	for (let index = 0; index < count.value; index += 1) {
		cursor = readU32(bytes, cursor, end, label).next;
		cursor = readU32(bytes, cursor, end, label).next;
	}
	if (cursor !== end) throw new Error(`${label} has trailing init-function metadata`);
	if (count.value !== 0) {
		throw new Error(`${label} contains forbidden native initialization functions`);
	}
}

function parseComdats(bytes: Uint8Array, start: number, end: number, label: string) {
	let cursor = start;
	const count = readU32(bytes, cursor, end, label);
	cursor = count.next;
	for (let index = 0; index < count.value; index += 1) {
		const name = readName(bytes, cursor, end, label);
		cursor = name.next;
		const flags = readU32(bytes, cursor, end, label);
		cursor = flags.next;
		if (flags.value !== 0) throw new Error(`${label} COMDAT ${index} has unknown flags`);
		const entries = readU32(bytes, cursor, end, label);
		cursor = entries.next;
		for (let entryIndex = 0; entryIndex < entries.value; entryIndex += 1) {
			const kind = bytes[cursor];
			if (kind === undefined || kind > 5 || kind === 3) {
				throw new Error(`${label} COMDAT ${index} contains an invalid symbol kind`);
			}
			cursor += 1;
			cursor = readU32(bytes, cursor, end, label).next;
		}
	}
	if (cursor !== end) throw new Error(`${label} has trailing COMDAT metadata`);
}

function parseSymbolTable(
	bytes: Uint8Array,
	start: number,
	end: number,
	label: string,
	profile: WasmObjectProfile
) {
	let cursor = start;
	const count = readU32(bytes, cursor, end, label);
	cursor = count.next;
	for (let index = 0; index < count.value; index += 1) {
		const kind = bytes[cursor];
		if (kind === undefined || kind > 5 || kind === 4) {
			throw new Error(`${label} symbol ${index} has an invalid kind`);
		}
		cursor += 1;
		const flags = readU32(bytes, cursor, end, label);
		cursor = flags.next;
		if ((flags.value & ~0x3f7) !== 0 || (flags.value & 0x3) === 0x3) {
			throw new Error(`${label} symbol ${index} has invalid flags`);
		}
		if ((flags.value & WASM_SYMBOL_TLS) !== 0) {
			throw new Error(`${label} contains forbidden thread-local storage metadata`);
		}
		let name: string | undefined;
		if (kind === 1) {
			const decoded = readName(bytes, cursor, end, label);
			name = decoded.value;
			cursor = decoded.next;
			if ((flags.value & WASM_SYMBOL_UNDEFINED) === 0) {
				cursor = readU32(bytes, cursor, end, label).next;
				cursor = readU32(bytes, cursor, end, label).next;
				cursor = readU32(bytes, cursor, end, label).next;
			}
		} else if (kind === 3) {
			cursor = readU32(bytes, cursor, end, label).next;
		} else {
			cursor = readU32(bytes, cursor, end, label).next;
			if (
				(flags.value & WASM_SYMBOL_UNDEFINED) === 0 ||
				(flags.value & WASM_SYMBOL_EXPLICIT_NAME) !== 0
			) {
				const decoded = readName(bytes, cursor, end, label);
				name = decoded.value;
				cursor = decoded.next;
			}
		}
		const permittedProgramRuntimeSymbol =
			profile === 'upstream-program' &&
			name === '__wasm_call_ctors' &&
			kind === 0 &&
			flags.value === (WASM_SYMBOL_UNDEFINED | WASM_SYMBOL_EXPLICIT_NAME);
		if (
			name !== undefined &&
			FORBIDDEN_NATIVE_SYMBOL.test(name) &&
			!permittedProgramRuntimeSymbol
		) {
			throw new Error(`${label} contains forbidden native ABI symbol ${name}`);
		}
	}
	if (cursor !== end) throw new Error(`${label} has trailing symbol-table metadata`);
	return count.value;
}

function parseLinkingSection(
	bytes: Uint8Array,
	section: WasmSection,
	label: string,
	profile: WasmObjectProfile
) {
	let cursor = section.customPayloadStart!;
	const version = readU32(bytes, cursor, section.payloadEnd, label);
	cursor = version.next;
	if (version.value !== 2) {
		throw new Error(`${label} uses unsupported WebAssembly linking version ${version.value}`);
	}
	const seen = new Set<number>();
	let symbolCount = 0;
	let symbolTable = false;
	let sawSymbolTable = false;
	while (cursor < section.payloadEnd) {
		const type = bytes[cursor];
		if (type === undefined) throw new Error(`${label} has truncated linking metadata`);
		cursor += 1;
		const size = readU32(bytes, cursor, section.payloadEnd, label);
		cursor = size.next;
		const subsectionEnd = cursor + size.value;
		if (subsectionEnd > section.payloadEnd) {
			throw new Error(`${label} has a truncated linking subsection`);
		}
		if (seen.has(type)) throw new Error(`${label} has a duplicate linking subsection ${type}`);
		seen.add(type);
		if (type === 5) {
			parseSegmentInfo(bytes, cursor, subsectionEnd, label);
		} else if (type === 6) {
			if (!sawSymbolTable) {
				throw new Error(`${label} init functions precede the symbol table`);
			}
			parseInitFunctions(bytes, cursor, subsectionEnd, label);
		} else if (type === 7) {
			parseComdats(bytes, cursor, subsectionEnd, label);
		} else if (type === 8) {
			symbolCount = parseSymbolTable(bytes, cursor, subsectionEnd, label, profile);
			symbolTable = true;
			sawSymbolTable = true;
		} else {
			throw new Error(`${label} contains unsupported linking subsection ${type}`);
		}
		cursor = subsectionEnd;
	}
	if (!symbolTable) throw new Error(`${label} linking section has no symbol table`);
	return { linkingVersion: version.value, symbolCount, symbolTable };
}

function parseRelocationSection(
	bytes: Uint8Array,
	section: WasmSection,
	sections: readonly WasmSection[],
	metadata: WasmObjectMetadata,
	label: string
) {
	let cursor = section.customPayloadStart!;
	const targetIndex = readU32(bytes, cursor, section.payloadEnd, label);
	cursor = targetIndex.next;
	const target = sections[targetIndex.value];
	if (!target || (target.id !== 0 && target.id !== 10 && target.id !== 11)) {
		throw new Error(`${label} relocation section targets an invalid section`);
	}
	const count = readU32(bytes, cursor, section.payloadEnd, label);
	cursor = count.next;
	let previousOffset = -1;
	for (let index = 0; index < count.value; index += 1) {
		const type = bytes[cursor];
		if (type === undefined || !WASM_RELOCATION_TYPES.has(type)) {
			throw new Error(`${label} relocation ${index} has an unsupported type`);
		}
		if (WASM_TLS_RELOCATIONS.has(type)) {
			throw new Error(`${label} contains a forbidden TLS relocation`);
		}
		if (WASM_64_BIT_RELOCATIONS.has(type)) {
			throw new Error(`${label} contains a forbidden memory64 or table64 relocation`);
		}
		if (type === 10) {
			throw new Error(`${label} contains a forbidden exception event relocation`);
		}
		cursor += 1;
		const relocationOffset = readU32(bytes, cursor, section.payloadEnd, label);
		cursor = relocationOffset.next;
		const targetSize = target.payloadEnd - target.payloadStart;
		const encodedWidth = WASM_RELOCATION_WIDTH.get(type)!;
		if (
			relocationOffset.value < previousOffset ||
			relocationOffset.value + encodedWidth > targetSize
		) {
			throw new Error(`${label} relocation ${index} lies outside its target section`);
		}
		previousOffset = relocationOffset.value;
		const referencedIndex = readU32(bytes, cursor, section.payloadEnd, label);
		cursor = referencedIndex.next;
		if (type !== 6 && type !== 26 && referencedIndex.value >= metadata.symbolCount) {
			throw new Error(`${label} relocation ${index} references an unknown symbol`);
		}
		if (WASM_RELOCATIONS_WITH_ADDEND.has(type)) {
			cursor = skipSignedLeb(
				bytes,
				cursor,
				section.payloadEnd,
				WASM_64_BIT_RELOCATIONS.has(type) ? 10 : 5,
				label
			);
		}
	}
	if (cursor !== section.payloadEnd) {
		throw new Error(`${label} has trailing relocation metadata`);
	}
}

function assertProtocolTargetFeatures(
	bytes: Uint8Array,
	sections: readonly WasmSection[],
	label: string,
	required: boolean,
	linked: boolean
) {
	const featureSections = sections.filter((section) => section.customName === 'target_features');
	if (featureSections.length > 1) {
		throw new Error(`${label} contains duplicate target_features metadata`);
	}
	const section = featureSections[0];
	if (!section) {
		if (required) throw new Error(`${label} has no target_features metadata`);
		return;
	}
	let cursor = section.customPayloadStart!;
	const count = readU32(bytes, cursor, section.payloadEnd, label);
	cursor = count.next;
	const seen = new Set<string>();
	for (let index = 0; index < count.value; index += 1) {
		const prefix = bytes[cursor];
		if (prefix !== 0x2b && prefix !== 0x2d) {
			throw new Error(`${label} target feature ${index} has an invalid prefix`);
		}
		cursor += 1;
		const decoded = readName(bytes, cursor, section.payloadEnd, label);
		cursor = decoded.next;
		if (seen.has(decoded.value)) {
			throw new Error(`${label} contains duplicate target feature ${decoded.value}`);
		}
		seen.add(decoded.value);
		if (FORBIDDEN_TARGET_FEATURES.has(decoded.value)) {
			throw new Error(`${label} contains forbidden target feature ${decoded.value}`);
		}
		const allowlist =
			prefix === 0x2b
				? linked
					? ALLOWED_LINKED_TARGET_FEATURES
					: ALLOWED_ENABLED_TARGET_FEATURES
				: ALLOWED_DISABLED_TARGET_FEATURES;
		if (!allowlist.has(decoded.value)) {
			throw new Error(`${label} contains target feature outside the protocol: ${decoded.value}`);
		}
	}
	if (cursor !== section.payloadEnd) {
		throw new Error(`${label} has trailing target_features metadata`);
	}
}

export function assertTinyGoLLVMBitcodeEnvelope(bytes: Uint8Array, label: string) {
	if (!hasHeader(bytes, LLVM_BITCODE_HEADER)) {
		throw new Error(`${label} does not have an LLVM bitcode header`);
	}
	if (bytes.byteLength < 16 || bytes.byteLength % 4 !== 0) {
		throw new Error(`${label} is not an aligned LLVM bitstream`);
	}
	let bit = LLVM_BITCODE_HEADER.byteLength * 8;
	const bitLimit = bytes.byteLength * 8;
	const readBits = (width: number) => {
		if (width < 1 || width > 32 || bit + width > bitLimit) {
			throw new Error(`${label} contains a truncated LLVM bitstream`);
		}
		let value = 0;
		for (let index = 0; index < width; index += 1) {
			value += ((bytes[(bit + index) >>> 3]! >>> ((bit + index) & 7)) & 1) * 2 ** index;
		}
		bit += width;
		return value;
	};
	const readVbr = (width: number) => {
		let value = 0;
		let shift = 0;
		while (true) {
			const chunk = readBits(width);
			value += (chunk & (2 ** (width - 1) - 1)) * 2 ** shift;
			if (!Number.isSafeInteger(value)) {
				throw new Error(`${label} contains an overflowing LLVM bitstream value`);
			}
			if ((chunk & 2 ** (width - 1)) === 0) return value;
			shift += width - 1;
		}
	};
	let moduleBlocks = 0;
	while (bit < bitLimit) {
		const abbreviation = readBits(2);
		if (abbreviation !== 1) {
			throw new Error(`${label} contains an invalid top-level LLVM bitstream entry`);
		}
		const blockId = readVbr(8);
		const codeWidth = readVbr(4);
		if (codeWidth < 2 || codeWidth > 32) {
			throw new Error(`${label} contains an invalid LLVM block code width`);
		}
		bit = Math.ceil(bit / 32) * 32;
		const words = readBits(32);
		const end = bit + words * 32;
		if (end > bitLimit) throw new Error(`${label} contains a truncated LLVM block`);
		if (![0, 8, 13, 23, 25].includes(blockId)) {
			throw new Error(`${label} contains unsupported top-level LLVM block ${blockId}`);
		}
		if (blockId === 8) moduleBlocks += 1;
		bit = end;
	}
	if (moduleBlocks !== 1) {
		throw new Error(`${label} must contain exactly one LLVM module block`);
	}
}

export function assertTinyGoRelocatableWasmObject(
	bytes: Uint8Array,
	label: string,
	options: { profile?: WasmObjectProfile } = {}
) {
	const profile = options.profile ?? 'auxiliary';
	const sections = parseWasmSections(bytes, label);
	assertProtocolTargetFeatures(bytes, sections, label, false, false);
	assertProtocolLimits(bytes, sections, label);
	const core = inspectWasmCoreFeatures(bytes, sections, label);
	if (sections.some((section) => section.id === 8 || section.id === 13)) {
		throw new Error(`${label} contains executable-only export or start behavior`);
	}
	if (profile === 'auxiliary' && sections.some((section) => section.id === 7)) {
		throw new Error(`${label} contains executable-only export or start behavior`);
	}
	if (profile === 'upstream-program') {
		const remainingExports = new Set(UPSTREAM_PROGRAM_EXPORTS);
		for (const entry of core.exports) {
			if (!remainingExports.delete(entry.name)) {
				throw new Error(`${label} contains unexpected program export ${entry.name}`);
			}
			if (entry.kind !== 0) {
				throw new Error(`${label} program export ${entry.name} is not a function`);
			}
			const definedIndex = entry.index - core.importedFunctionTypes.length;
			if (definedIndex < 0 || definedIndex >= core.definedFunctionTypes.length) {
				throw new Error(`${label} program export ${entry.name} is not a defined function`);
			}
		}
		const missingExport = remainingExports.values().next().value;
		if (missingExport !== undefined) {
			throw new Error(`${label} is missing required program export ${missingExport}`);
		}
	}
	const linking = sections.filter((section) => section.customName === 'linking');
	if (linking.length !== 1) {
		throw new Error(`${label} must contain exactly one WebAssembly linking section`);
	}
	const linkingSection = linking[0]!;
	const lastData = sections.findLast((section) => section.id === 11);
	if (lastData && linkingSection.index < lastData.index) {
		throw new Error(`${label} linking section precedes its data section`);
	}
	const metadata = parseLinkingSection(bytes, linkingSection, label, profile);
	for (const section of sections) {
		if (section.customName === 'dylink' || section.customName === 'dylink.0') {
			throw new Error(`${label} contains dynamic-linking metadata`);
		}
		if (section.customName?.startsWith('reloc.')) {
			if (section.index < linkingSection.index) {
				throw new Error(`${label} relocation metadata precedes the linking section`);
			}
			parseRelocationSection(bytes, section, sections, metadata, label);
		}
	}
	return metadata;
}

export async function assertTinyGoFinalWasmModule(
	bytes: Uint8Array,
	label: string,
	options: { phase?: 'final' | 'pre-asyncify' } = {}
) {
	const phase = options.phase ?? 'final';
	const sections = parseWasmSections(bytes, label);
	assertProtocolTargetFeatures(bytes, sections, label, true, true);
	assertProtocolLimits(bytes, sections, label);
	const core = inspectWasmCoreFeatures(bytes, sections, label);
	if (sections.some((section) => section.id === 8)) {
		throw new Error(`${label} contains a forbidden core start section`);
	}
	if (sections.some((section) => section.id === 13)) {
		throw new Error(`${label} contains forbidden exception tags`);
	}
	const forbiddenCustom = sections.find(
		(section) =>
			section.customName === 'linking' ||
			section.customName === 'dylink' ||
			section.customName === 'dylink.0' ||
			section.customName?.startsWith('reloc.')
	);
	if (forbiddenCustom) {
		throw new Error(`${label} retains relocatable-object metadata ${forbiddenCustom.customName}`);
	}
	const startExport = core.exports.find((entry) => entry.name === '_start');
	if (!startExport || startExport.kind !== 0) {
		throw new Error(`${label} does not export the WASI _start function`);
	}
	if (startExport.index < core.importedFunctionTypes.length) {
		throw new Error(`${label} exports an imported _start function`);
	}
	const definedIndex = startExport.index - core.importedFunctionTypes.length;
	const typeIndex = core.definedFunctionTypes[definedIndex];
	const startType = typeIndex === undefined ? undefined : core.types[typeIndex];
	if (!startType || startType.parameters !== 0 || startType.results !== 0) {
		throw new Error(`${label} _start must be a defined () -> () function`);
	}
	const module = await WebAssembly.compile(Uint8Array.from(bytes));
	const imports = WebAssembly.Module.imports(module);
	const requiredAsyncifyImports = new Set([
		'stop_rewind',
		'start_unwind',
		'stop_unwind',
		'start_rewind'
	]);
	const unsupportedImports = imports.filter((entry) => {
		if (entry.module === 'wasi_snapshot_preview1' && entry.kind === 'function') return false;
		if (
			phase === 'pre-asyncify' &&
			entry.module === 'asyncify' &&
			entry.kind === 'function' &&
			requiredAsyncifyImports.delete(entry.name)
		) {
			return false;
		}
		return true;
	});
	if (unsupportedImports.length > 0) {
		throw new Error(
			`${label} imports outside the WASI function boundary: ${[
				...new Set(unsupportedImports.map((entry) => `${entry.module}.${entry.name}:${entry.kind}`))
			].join(', ')}`
		);
	}
	const missingAsyncifyImport = requiredAsyncifyImports.values().next().value;
	if (phase === 'pre-asyncify' && missingAsyncifyImport !== undefined) {
		throw new Error(`${label} is missing required asyncify import ${missingAsyncifyImport}`);
	}
	const exports = WebAssembly.Module.exports(module);
	if (!exports.some((entry) => entry.name === 'memory' && entry.kind === 'memory')) {
		throw new Error(`${label} does not export linear memory`);
	}
}
