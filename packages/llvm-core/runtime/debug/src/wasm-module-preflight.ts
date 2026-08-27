const MAX_MODULE_BYTES = 256 * 1024 * 1024;
const MAX_SECTIONS = 4_096;
const MAX_VECTOR_ENTRIES = 1_000_000;
const MAX_STRING_BYTES = 16 * 1024 * 1024;
const MAX_FUNCTION_BODY_BYTES = 64 * 1024 * 1024;
const MAX_INSTRUCTIONS = 16_000_000;
const MAX_CONTROL_DEPTH = 4_096;
const MAX_INITIAL_MEMORY_PAGES = 2_048;
const MAX_INITIAL_TABLE_ELEMENTS = 1_000_000;

const CORE_V1_HEADER = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
const WASI_PREVIEW1_IMPORT_MODULE = 'wasi_snapshot_preview1';
const WASI_SDK_33_PREVIEW1_SIGNATURES = new Map<string, string>([
	['args_get', 'ii>i'],
	['args_sizes_get', 'ii>i'],
	['clock_res_get', 'ii>i'],
	['clock_time_get', 'iIi>i'],
	['environ_get', 'ii>i'],
	['environ_sizes_get', 'ii>i'],
	['fd_prestat_get', 'ii>i'],
	['fd_prestat_dir_name', 'iii>i'],
	['fd_close', 'i>i'],
	['fd_datasync', 'i>i'],
	['fd_pread', 'iiiIi>i'],
	['fd_pwrite', 'iiiIi>i'],
	['fd_read', 'iiii>i'],
	['fd_renumber', 'ii>i'],
	['fd_seek', 'iIii>i'],
	['fd_tell', 'ii>i'],
	['fd_fdstat_get', 'ii>i'],
	['fd_fdstat_set_flags', 'ii>i'],
	['fd_fdstat_set_rights', 'iII>i'],
	['fd_sync', 'i>i'],
	['fd_write', 'iiii>i'],
	['fd_advise', 'iIIi>i'],
	['fd_allocate', 'iII>i'],
	['path_create_directory', 'iii>i'],
	['path_link', 'iiiiiii>i'],
	['path_open', 'iiiiiIIii>i'],
	['fd_readdir', 'iiiIi>i'],
	['path_readlink', 'iiiiii>i'],
	['path_rename', 'iiiiii>i'],
	['fd_filestat_get', 'ii>i'],
	['fd_filestat_set_times', 'iIIi>i'],
	['fd_filestat_set_size', 'iI>i'],
	['path_filestat_get', 'iiiii>i'],
	['path_filestat_set_times', 'iiiiIIi>i'],
	['path_symlink', 'iiiii>i'],
	['path_unlink_file', 'iii>i'],
	['path_remove_directory', 'iii>i'],
	['poll_oneoff', 'iiii>i'],
	['proc_exit', 'i>'],
	['random_get', 'ii>i'],
	['sock_accept', 'iii>i'],
	['sock_recv', 'iiiiii>i'],
	['sock_send', 'iiiii>i'],
	['sock_shutdown', 'ii>i'],
	['sched_yield', '>i']
]);
const DYNAMIC_LINKING_CUSTOM_SECTIONS = new Set(['dylink', 'dylink.0']);
const RELOCATABLE_CUSTOM_SECTIONS = new Set(['linking']);
const SIMD_TARGET_FEATURES = new Set(['simd128', 'relaxed-simd']);
const ATOMICS_TARGET_FEATURES = new Set(['atomics', 'shared-mem']);
const MEMORY64_TARGET_FEATURES = new Set(['memory64']);
const MULTI_MEMORY_TARGET_FEATURES = new Set(['multi-memory', 'multimemory']);
const TABLE64_TARGET_FEATURES = new Set(['table64']);

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	Symbol.toStringTag
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	'byteOffset'
)?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	'byteLength'
)?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	'byteLength'
)?.get;
const sharedArrayBufferByteLengthGetter =
	typeof SharedArrayBuffer === 'undefined'
		? undefined
		: Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get;

export function normalizeUint8ArrayObject(value: unknown): Uint8Array | null {
	if (
		!ArrayBuffer.isView(value) ||
		!typedArrayTagGetter ||
		!typedArrayBufferGetter ||
		!typedArrayByteOffsetGetter ||
		!typedArrayByteLengthGetter
	) {
		return null;
	}
	try {
		if (Reflect.apply(typedArrayTagGetter, value, []) !== 'Uint8Array') return null;
		const buffer = Reflect.apply(typedArrayBufferGetter, value, []) as ArrayBufferLike;
		const byteOffset = Reflect.apply(typedArrayByteOffsetGetter, value, []) as number;
		const byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
		return new Uint8Array(buffer, byteOffset, byteLength);
	} catch {
		return null;
	}
}

export function getArrayBufferKind(value: unknown): 'array-buffer' | 'shared-array-buffer' | null {
	if (arrayBufferByteLengthGetter) {
		try {
			Reflect.apply(arrayBufferByteLengthGetter, value, []);
			return 'array-buffer';
		} catch {
			// Try the distinct SharedArrayBuffer internal brand below.
		}
	}
	if (sharedArrayBufferByteLengthGetter) {
		try {
			Reflect.apply(sharedArrayBufferByteLengthGetter, value, []);
			return 'shared-array-buffer';
		} catch {
			// The value is neither supported buffer brand.
		}
	}
	return null;
}

function malformed(detail: string): never {
	throw new Error(`Malformed WAMR debug module: ${detail}`);
}

function unsupported(detail: string): never {
	throw new Error(`Unsupported WAMR debug module: ${detail}`);
}

class WasmReader {
	private position: number;

	constructor(
		private readonly bytes: Uint8Array,
		start = 0,
		private readonly limit = bytes.length
	) {
		this.position = start;
		if (start < 0 || limit < start || limit > bytes.length) {
			malformed('invalid parser bounds');
		}
	}

	get offset() {
		return this.position;
	}

	get remaining() {
		return this.limit - this.position;
	}

	get done() {
		return this.position === this.limit;
	}

	peekByte(context: string) {
		if (this.position >= this.limit) malformed(`unexpected end while reading ${context}`);
		return this.bytes[this.position]!;
	}

	readByte(context: string) {
		const value = this.peekByte(context);
		this.position += 1;
		return value;
	}

	readBytes(length: number, context: string) {
		if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
			malformed(`truncated ${context}`);
		}
		const value = this.bytes.subarray(this.position, this.position + length);
		this.position += length;
		return value;
	}

	skip(length: number, context: string) {
		this.readBytes(length, context);
	}

	readSubReader(length: number, context: string) {
		if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
			malformed(`truncated ${context}`);
		}
		const reader = new WasmReader(this.bytes, this.position, this.position + length);
		this.position += length;
		return reader;
	}

	readVarUint32(context: string) {
		let value = 0;
		let multiplier = 1;
		for (let index = 0; index < 5; index += 1) {
			const byte = this.readByte(context);
			const payload = byte & 0x7f;
			if (index === 4 && payload > 0x0f) malformed(`${context} exceeds u32`);
			value += payload * multiplier;
			if ((byte & 0x80) === 0) return value;
			multiplier *= 128;
		}
		return malformed(`${context} has an unterminated u32 LEB128 value`);
	}

	readSignedLeb(maxBytes: number, bitWidth: number, context: string) {
		for (let index = 0; index < maxBytes; index += 1) {
			const byte = this.readByte(context);
			const payload = byte & 0x7f;
			if ((byte & 0x80) !== 0) continue;
			if (index === maxBytes - 1) {
				const usedBits = bitWidth - 7 * index;
				const valueMask = (1 << usedBits) - 1;
				const unusedMask = 0x7f ^ valueMask;
				const signBit = 1 << (usedBits - 1);
				const expected = (payload & signBit) === 0 ? 0 : unusedMask;
				if ((payload & unusedMask) !== expected) {
					malformed(`${context} exceeds i${bitWidth}`);
				}
			}
			return;
		}
		malformed(`${context} has an unterminated signed LEB128 value`);
	}

	readVectorCount(context: string) {
		const count = this.readVarUint32(`${context} count`);
		if (count > MAX_VECTOR_ENTRIES) {
			malformed(`${context} count ${count} exceeds ${MAX_VECTOR_ENTRIES}`);
		}
		return count;
	}

	readName(context: string) {
		const length = this.readVarUint32(`${context} byte length`);
		if (length > MAX_STRING_BYTES) {
			malformed(`${context} exceeds ${MAX_STRING_BYTES} bytes`);
		}
		const bytes = this.readBytes(length, context);
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			return malformed(`${context} is not valid UTF-8`);
		}
	}
}

class WamrModuleValidator {
	private memoryCount = 0;
	private tableCount = 0;
	private instructionCount = 0;
	private readonly functionTypes: string[] = [];

	constructor(private readonly module: Uint8Array) {}

	validate() {
		const bufferKind = getArrayBufferKind(this.module.buffer);
		if (bufferKind === 'shared-array-buffer') {
			unsupported('SharedArrayBuffer-backed guest modules are not supported');
		}
		if (bufferKind !== 'array-buffer') malformed('module view has an invalid backing buffer');
		if (this.module.byteLength > MAX_MODULE_BYTES) {
			unsupported(`module size exceeds ${MAX_MODULE_BYTES} bytes`);
		}
		if (
			this.module.byteLength < CORE_V1_HEADER.byteLength ||
			!CORE_V1_HEADER.every((byte, index) => this.module[index] === byte)
		) {
			unsupported('expected a core WebAssembly v1 binary');
		}

		const reader = new WasmReader(this.module, CORE_V1_HEADER.byteLength);
		let sectionCount = 0;
		while (!reader.done) {
			sectionCount += 1;
			if (sectionCount > MAX_SECTIONS) malformed(`section count exceeds ${MAX_SECTIONS}`);
			const id = reader.readByte('section id');
			const size = reader.readVarUint32('section size');
			const section = reader.readSubReader(size, `section ${id}`);
			this.readSection(id, section);
			if (!section.done) malformed(`section ${id} has trailing bytes`);
		}

		let valid = false;
		try {
			valid = WebAssembly.validate(
				new Uint8Array(
					this.module.buffer as ArrayBuffer,
					this.module.byteOffset,
					this.module.byteLength
				)
			);
		} catch {
			valid = false;
		}
		if (!valid) malformed('binary failed core WebAssembly validation');
	}

	private readSection(id: number, reader: WasmReader) {
		switch (id) {
			case 0:
				this.readCustomSection(reader);
				return;
			case 1:
				this.readTypeSection(reader);
				return;
			case 2:
				this.readImportSection(reader);
				return;
			case 3:
				this.readIndexVector(reader, 'function section');
				return;
			case 4:
				this.readTableSection(reader);
				return;
			case 5:
				this.readMemorySection(reader);
				return;
			case 6:
				this.readGlobalSection(reader);
				return;
			case 7:
				this.readExportSection(reader);
				return;
			case 8:
				reader.readVarUint32('start function index');
				return;
			case 9:
				this.readElementSection(reader);
				return;
			case 10:
				this.readCodeSection(reader);
				return;
			case 11:
				this.readDataSection(reader);
				return;
			case 12:
				reader.readVarUint32('data count');
				return;
			case 13:
				unsupported('exception-handling tag sections are not supported');
			default:
				unsupported(`unknown core section id ${id}`);
		}
	}

	private readCustomSection(reader: WasmReader) {
		const name = reader.readName('custom section name');
		if (DYNAMIC_LINKING_CUSTOM_SECTIONS.has(name)) {
			unsupported(`dynamic linking metadata (${name}) is not supported`);
		}
		if (RELOCATABLE_CUSTOM_SECTIONS.has(name) || name.startsWith('reloc.')) {
			unsupported(`multi-module or relocatable metadata (${name}) is not supported`);
		}
		if (name === 'target_features') {
			this.readTargetFeatures(reader);
			return;
		}
		reader.skip(reader.remaining, `custom section ${name}`);
	}

	private readTargetFeatures(reader: WasmReader) {
		const count = reader.readVectorCount('target feature');
		for (let index = 0; index < count; index += 1) {
			const prefix = reader.readByte(`target feature ${index} prefix`);
			if (prefix !== 0x2b && prefix !== 0x2d) {
				malformed(`target feature ${index} has invalid prefix ${prefix}`);
			}
			const name = reader.readName(`target feature ${index} name`);
			if (prefix === 0x2d) continue;
			if (SIMD_TARGET_FEATURES.has(name)) unsupported(`SIMD target feature ${name}`);
			if (ATOMICS_TARGET_FEATURES.has(name)) unsupported(`atomics target feature ${name}`);
			if (MEMORY64_TARGET_FEATURES.has(name)) unsupported(`memory64 target feature ${name}`);
			if (MULTI_MEMORY_TARGET_FEATURES.has(name)) {
				unsupported(`multiple memories target feature ${name}`);
			}
			if (TABLE64_TARGET_FEATURES.has(name)) unsupported(`table64 target feature ${name}`);
		}
	}

	private readTypeSection(reader: WasmReader) {
		const count = reader.readVectorCount('type');
		for (let index = 0; index < count; index += 1) {
			const form = reader.readByte(`type ${index} form`);
			if (form !== 0x60) unsupported(`non-function type form 0x${form.toString(16)}`);
			const parameters = this.readValueTypeVector(reader, `type ${index} parameter`);
			const results = this.readValueTypeVector(reader, `type ${index} result`);
			this.functionTypes.push(`${parameters}>${results}`);
		}
	}

	private readImportSection(reader: WasmReader) {
		const count = reader.readVectorCount('import');
		for (let index = 0; index < count; index += 1) {
			const moduleName = reader.readName(`import ${index} module`);
			const fieldName = reader.readName(`import ${index} name`);
			const kind = reader.readByte(`import ${index} kind`);
			if (moduleName !== WASI_PREVIEW1_IMPORT_MODULE) {
				unsupported(`unsupported import module ${JSON.stringify(moduleName)}`);
			}
			if (kind !== 0) unsupported('Preview 1 imports must be functions');
			const typeIndex = reader.readVarUint32(`import ${index} function type index`);
			const actualSignature = this.functionTypes[typeIndex];
			if (actualSignature === undefined) {
				malformed(`import ${index} references missing function type ${typeIndex}`);
			}
			const expectedSignature = WASI_SDK_33_PREVIEW1_SIGNATURES.get(fieldName);
			if (expectedSignature === undefined) {
				unsupported(`unsupported Preview 1 import ${JSON.stringify(fieldName)}`);
			}
			if (actualSignature !== expectedSignature) {
				unsupported(
					`Preview 1 import ${JSON.stringify(fieldName)} has signature ${actualSignature}, expected ${expectedSignature}`
				);
			}
		}
	}

	private readIndexVector(reader: WasmReader, context: string) {
		const count = reader.readVectorCount(context);
		for (let index = 0; index < count; index += 1) {
			reader.readVarUint32(`${context} index ${index}`);
		}
	}

	private readTableSection(reader: WasmReader) {
		const count = reader.readVectorCount('table');
		for (let index = 0; index < count; index += 1) {
			this.readTableType(reader, `table ${index}`);
			this.addTable();
		}
	}

	private readMemorySection(reader: WasmReader) {
		const count = reader.readVectorCount('memory');
		for (let index = 0; index < count; index += 1) {
			this.readLimits(reader, `memory ${index}`, 'memory');
			this.addMemory();
		}
	}

	private readGlobalSection(reader: WasmReader) {
		const count = reader.readVectorCount('global');
		for (let index = 0; index < count; index += 1) {
			this.readGlobalType(reader, `global ${index}`);
			this.readConstantExpression(reader, `global ${index} initializer`);
		}
	}

	private readExportSection(reader: WasmReader) {
		const count = reader.readVectorCount('export');
		for (let index = 0; index < count; index += 1) {
			reader.readName(`export ${index} name`);
			const kind = reader.readByte(`export ${index} kind`);
			if (kind > 3) {
				if (kind === 4) unsupported('exception-handling tag exports are not supported');
				malformed(`export ${index} has unknown kind ${kind}`);
			}
			reader.readVarUint32(`export ${index} index`);
		}
	}

	private readElementSection(reader: WasmReader) {
		const count = reader.readVectorCount('element segment');
		for (let index = 0; index < count; index += 1) {
			const flags = reader.readVarUint32(`element segment ${index} flags`);
			if (flags > 7) malformed(`element segment ${index} has invalid flags ${flags}`);
			if (flags === 0 || flags === 4) {
				this.readConstantExpression(reader, `element segment ${index} offset`);
			} else if (flags === 2 || flags === 6) {
				const tableIndex = reader.readVarUint32(`element segment ${index} table index`);
				if (tableIndex !== 0) unsupported('multiple tables are not supported');
				this.readConstantExpression(reader, `element segment ${index} offset`);
			}

			if (flags <= 3) {
				if (flags !== 0) {
					const elementKind = reader.readByte(`element segment ${index} kind`);
					if (elementKind !== 0) malformed(`element segment ${index} has invalid kind`);
				}
				this.readIndexVector(reader, `element segment ${index} function`);
			} else {
				if (flags !== 4) this.readReferenceType(reader, `element segment ${index} type`);
				const expressionCount = reader.readVectorCount(
					`element segment ${index} initializer`
				);
				for (
					let expressionIndex = 0;
					expressionIndex < expressionCount;
					expressionIndex += 1
				) {
					this.readConstantExpression(
						reader,
						`element segment ${index} initializer ${expressionIndex}`
					);
				}
			}
		}
	}

	private readCodeSection(reader: WasmReader) {
		const count = reader.readVectorCount('function body');
		for (let index = 0; index < count; index += 1) {
			const size = reader.readVarUint32(`function body ${index} size`);
			if (size > MAX_FUNCTION_BODY_BYTES) {
				unsupported(`function body ${index} exceeds ${MAX_FUNCTION_BODY_BYTES} bytes`);
			}
			const body = reader.readSubReader(size, `function body ${index}`);
			const localGroupCount = body.readVectorCount(`function body ${index} local group`);
			let localCount = 0;
			for (let group = 0; group < localGroupCount; group += 1) {
				localCount += body.readVarUint32(
					`function body ${index} local group ${group} count`
				);
				if (localCount > MAX_VECTOR_ENTRIES) {
					unsupported(`function body ${index} has too many locals`);
				}
				this.readValueType(body, `function body ${index} local group ${group} type`);
			}
			this.readExpression(body, `function body ${index}`);
			if (!body.done) malformed(`function body ${index} has trailing bytes`);
		}
	}

	private readDataSection(reader: WasmReader) {
		const count = reader.readVectorCount('data segment');
		for (let index = 0; index < count; index += 1) {
			const flags = reader.readVarUint32(`data segment ${index} flags`);
			if (flags === 0) {
				this.readConstantExpression(reader, `data segment ${index} offset`);
			} else if (flags === 2) {
				const memoryIndex = reader.readVarUint32(`data segment ${index} memory index`);
				if (memoryIndex !== 0) unsupported('multiple memories are not supported');
				this.readConstantExpression(reader, `data segment ${index} offset`);
			} else if (flags !== 1) {
				malformed(`data segment ${index} has invalid flags ${flags}`);
			}
			const size = reader.readVarUint32(`data segment ${index} byte length`);
			reader.skip(size, `data segment ${index} bytes`);
		}
	}

	private readTableType(reader: WasmReader, context: string) {
		this.readReferenceType(reader, `${context} element`);
		this.readLimits(reader, context, 'table');
	}

	private readLimits(reader: WasmReader, context: string, kind: 'memory' | 'table') {
		const flags = reader.readVarUint32(`${context} limits flags`);
		if ((flags & ~0x07) !== 0) malformed(`${context} has invalid limits flags ${flags}`);
		if ((flags & 0x04) !== 0) unsupported(`${kind}64 is not supported`);
		if ((flags & 0x02) !== 0) {
			if (kind === 'memory') unsupported('shared memory and atomics are not supported');
			unsupported('shared tables are not supported');
		}
		const minimum = reader.readVarUint32(`${context} minimum`);
		if (kind === 'memory' && minimum > MAX_INITIAL_MEMORY_PAGES) {
			unsupported(`${context} minimum ${minimum} pages exceeds ${MAX_INITIAL_MEMORY_PAGES}`);
		}
		if (kind === 'table' && minimum > MAX_INITIAL_TABLE_ELEMENTS) {
			unsupported(
				`${context} minimum ${minimum} elements exceeds ${MAX_INITIAL_TABLE_ELEMENTS}`
			);
		}
		if ((flags & 0x01) !== 0) reader.readVarUint32(`${context} maximum`);
	}

	private readGlobalType(reader: WasmReader, context: string) {
		this.readValueType(reader, `${context} value type`);
		const mutable = reader.readByte(`${context} mutability`);
		if (mutable > 1) malformed(`${context} has invalid mutability ${mutable}`);
	}

	private readValueTypeVector(reader: WasmReader, context: string) {
		const count = reader.readVectorCount(context);
		let signature = '';
		for (let index = 0; index < count; index += 1) {
			signature += this.readValueType(reader, `${context} ${index}`);
		}
		return signature;
	}

	private readValueType(reader: WasmReader, context: string) {
		const type = reader.readByte(context);
		if (type === 0x7b) unsupported(`SIMD v128 value type in ${context}`);
		if (type === 0x7f) return 'i';
		if (type === 0x7e) return 'I';
		if (type === 0x7d) return 'f';
		if (type === 0x7c) return 'F';
		if (type === 0x70) return 'r';
		if (type === 0x6f) return 'R';
		unsupported(`unsupported value type 0x${type.toString(16)} in ${context}`);
	}

	private readReferenceType(reader: WasmReader, context: string) {
		const type = reader.readByte(context);
		if (type === 0x70 || type === 0x6f) return;
		unsupported(`unsupported reference type 0x${type.toString(16)} in ${context}`);
	}

	private readConstantExpression(reader: WasmReader, context: string) {
		while (true) {
			this.countInstruction();
			const opcode = reader.readByte(`${context} opcode`);
			switch (opcode) {
				case 0x0b:
					return;
				case 0x23:
				case 0xd2:
					reader.readVarUint32(`${context} instruction index`);
					break;
				case 0x41:
					reader.readSignedLeb(5, 32, `${context} i32 constant`);
					break;
				case 0x42:
					reader.readSignedLeb(10, 64, `${context} i64 constant`);
					break;
				case 0x43:
					reader.skip(4, `${context} f32 constant`);
					break;
				case 0x44:
					reader.skip(8, `${context} f64 constant`);
					break;
				case 0xd0:
					this.readHeapType(reader, context);
					break;
				default:
					unsupported('extended constant expressions are not supported');
			}
		}
	}

	private readExpression(reader: WasmReader, context: string) {
		let depth = 1;
		while (depth > 0) {
			this.countInstruction();
			const opcode = reader.readByte(`${context} opcode`);
			switch (opcode) {
				case 0x02:
				case 0x03:
				case 0x04:
					this.readBlockType(reader, context);
					depth += 1;
					if (depth > MAX_CONTROL_DEPTH) {
						unsupported(`control depth exceeds ${MAX_CONTROL_DEPTH}`);
					}
					break;
				case 0x0b:
					depth -= 1;
					break;
				case 0x0c:
				case 0x0d:
				case 0x10:
				case 0x20:
				case 0x21:
				case 0x22:
				case 0x23:
				case 0x24:
				case 0x25:
				case 0x26:
				case 0xd2:
					reader.readVarUint32(`${context} instruction index`);
					break;
				case 0x0e: {
					const count = reader.readVectorCount(`${context} branch table`);
					for (let index = 0; index <= count; index += 1) {
						reader.readVarUint32(`${context} branch table label ${index}`);
					}
					break;
				}
				case 0x11:
					reader.readVarUint32(`${context} call_indirect type index`);
					if (reader.readVarUint32(`${context} call_indirect table index`) !== 0) {
						unsupported('multiple tables are not supported');
					}
					break;
				case 0x1c:
					this.readValueTypeVector(reader, `${context} typed select`);
					break;
				case 0x28:
				case 0x29:
				case 0x2a:
				case 0x2b:
				case 0x2c:
				case 0x2d:
				case 0x2e:
				case 0x2f:
				case 0x30:
				case 0x31:
				case 0x32:
				case 0x33:
				case 0x34:
				case 0x35:
				case 0x36:
				case 0x37:
				case 0x38:
				case 0x39:
				case 0x3a:
				case 0x3b:
				case 0x3c:
				case 0x3d:
				case 0x3e:
					if ((reader.readVarUint32(`${context} memory alignment`) & 0x40) !== 0) {
						unsupported('multi-memory instruction encoding is not supported');
					}
					reader.readVarUint32(`${context} memory offset`);
					break;
				case 0x3f:
				case 0x40:
					if (reader.readVarUint32(`${context} memory index`) !== 0) {
						unsupported('multiple memories are not supported');
					}
					break;
				case 0x41:
					reader.readSignedLeb(5, 32, `${context} i32 constant`);
					break;
				case 0x42:
					reader.readSignedLeb(10, 64, `${context} i64 constant`);
					break;
				case 0x43:
					reader.skip(4, `${context} f32 constant`);
					break;
				case 0x44:
					reader.skip(8, `${context} f64 constant`);
					break;
				case 0xd0:
					this.readHeapType(reader, context);
					break;
				case 0xfc:
					this.readMiscInstruction(reader, context);
					break;
				case 0xfd:
					unsupported('SIMD instructions are not supported');
				case 0xfe:
					unsupported('atomic instructions are not supported');
				case 0xfb:
					unsupported('GC instructions are not supported');
				default:
					if (this.isImmediateFreeCoreOpcode(opcode)) break;
					unsupported(`instruction opcode 0x${opcode.toString(16)} is not supported`);
			}
		}
	}

	private readBlockType(reader: WasmReader, context: string) {
		const type = reader.peekByte(`${context} block type`);
		if (type === 0x40) {
			reader.readByte(`${context} block type`);
			return;
		}
		if (
			type === 0x7f ||
			type === 0x7e ||
			type === 0x7d ||
			type === 0x7c ||
			type === 0x70 ||
			type === 0x6f
		) {
			reader.readByte(`${context} block type`);
			return;
		}
		if (type === 0x7b) unsupported(`SIMD v128 block type in ${context}`);
		if (type < 0x80 && (type & 0x40) !== 0) {
			unsupported(`GC or typed block types are not supported in ${context}`);
		}
		reader.readSignedLeb(5, 33, `${context} block type index`);
	}

	private readHeapType(reader: WasmReader, context: string) {
		const type = reader.peekByte(`${context} heap type`);
		if (type === 0x70 || type === 0x6f) {
			reader.readByte(`${context} heap type`);
			return;
		}
		unsupported('GC or typed references are not supported');
	}

	private readMiscInstruction(reader: WasmReader, context: string) {
		const opcode = reader.readVarUint32(`${context} misc opcode`);
		if (opcode <= 7) return;
		if (opcode === 8) {
			reader.readVarUint32(`${context} data index`);
			if (reader.readVarUint32(`${context} memory index`) !== 0) {
				unsupported('multiple memories are not supported');
			}
			return;
		}
		if (opcode === 9) {
			reader.readVarUint32(`${context} data index`);
			return;
		}
		if (opcode === 10) {
			if (
				reader.readVarUint32(`${context} destination memory index`) !== 0 ||
				reader.readVarUint32(`${context} source memory index`) !== 0
			) {
				unsupported('multiple memories are not supported');
			}
			return;
		}
		if (opcode === 11) {
			if (reader.readVarUint32(`${context} memory index`) !== 0) {
				unsupported('multiple memories are not supported');
			}
			return;
		}
		if (opcode === 12) {
			reader.readVarUint32(`${context} element index`);
			if (reader.readVarUint32(`${context} table index`) !== 0) {
				unsupported('multiple tables are not supported');
			}
			return;
		}
		if (opcode === 13) {
			reader.readVarUint32(`${context} element index`);
			return;
		}
		if (opcode === 14) {
			if (
				reader.readVarUint32(`${context} destination table index`) !== 0 ||
				reader.readVarUint32(`${context} source table index`) !== 0
			) {
				unsupported('multiple tables are not supported');
			}
			return;
		}
		if (opcode >= 15 && opcode <= 17) {
			if (reader.readVarUint32(`${context} table index`) !== 0) {
				unsupported('multiple tables are not supported');
			}
			return;
		}
		unsupported(`misc instruction 0xfc/${opcode} is not supported`);
	}

	private isImmediateFreeCoreOpcode(opcode: number) {
		return (
			opcode === 0x00 ||
			opcode === 0x01 ||
			opcode === 0x05 ||
			opcode === 0x0f ||
			opcode === 0x1a ||
			opcode === 0x1b ||
			(opcode >= 0x45 && opcode <= 0xc4) ||
			opcode === 0xd1
		);
	}

	private countInstruction() {
		this.instructionCount += 1;
		if (this.instructionCount > MAX_INSTRUCTIONS) {
			unsupported(`instruction count exceeds ${MAX_INSTRUCTIONS}`);
		}
	}

	private addMemory() {
		this.memoryCount += 1;
		if (this.memoryCount > 1) unsupported('multiple memories are not supported');
	}

	private addTable() {
		this.tableCount += 1;
		if (this.tableCount > 1) unsupported('multiple tables are not supported');
	}
}

export function validateWamrDebugModule(module: Uint8Array): void {
	const normalizedModule = normalizeUint8ArrayObject(module);
	if (!normalizedModule) malformed('expected a Uint8Array module view');
	new WamrModuleValidator(normalizedModule).validate();
}
