import type { CdpWasmLocation } from './cdp.js';

/** TeaVM 0.13.1 embedded debug format, shared by its Wasm GC backend.
 * Format reference: org.teavm.backend.wasm.debug.parser in the upstream 0.13.1 tag.
 * This decodes compiler metadata; Java execution remains entirely in the browser VM.
 */
class Reader {
	position = 0;
	constructor(readonly bytes: Uint8Array) {}
	get remaining() {
		return this.bytes.length - this.position;
	}
	byte() {
		if (!this.remaining) throw new Error('Truncated TeaVM debug metadata');
		return this.bytes[this.position++];
	}
	leb(signed = false) {
		let value = 0;
		let shift = 0;
		for (let index = 0; index < 5; index++) {
			const byte = this.byte();
			value += (byte & 127) * 2 ** shift;
			shift += 7;
			if (!(byte & 128)) {
				if (signed && byte & 64) value -= 2 ** shift;
				if (
					value < (signed ? -2147483648 : 0) ||
					value > (signed ? 2147483647 : 4294967295)
				)
					break;
				return value;
			}
		}
		throw new Error('Invalid TeaVM debug integer');
	}
	take(size: number) {
		if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining)
			throw new Error('Truncated TeaVM debug section');
		const bytes = this.bytes.subarray(this.position, this.position + size);
		this.position += size;
		return bytes;
	}
	string() {
		return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.leb()));
	}
}

function entry<T>(items: T[], index: number): T {
	if (!Number.isSafeInteger(index) || index < 0 || index >= items.length)
		throw new Error('Invalid TeaVM debug reference');
	return items[index];
}

function treeNames(rows: Array<{ parent: number; name: string }>, separator: string) {
	return rows.map((row, index) => {
		const names = [row.name];
		const seen = new Set([index + 1]);
		while (row.parent) {
			if (seen.has(row.parent)) throw new Error('Cyclic TeaVM debug path');
			seen.add(row.parent);
			row = entry(rows, row.parent - 1);
			names.push(row.name);
		}
		return names.reverse().join(separator);
	});
}

/** Returns byte offsets in the whole Wasm module, as required by CDP. */
export function readTeaVmDebugLocations(
	bytes: Uint8Array,
	sourcePaths?: readonly string[]
): CdpWasmLocation[] {
	const module = new Reader(bytes);
	if (!module.take(8).every((byte, index) => byte === [0, 97, 115, 109, 1, 0, 0, 0][index])) {
		throw new Error('Invalid WebAssembly header');
	}
	const sections = new Map<string, Uint8Array>();
	let codeOffset = 0;
	let codeEnd = 0;
	while (module.remaining) {
		const id = module.byte();
		const length = module.leb();
		const offset = module.position;
		const body = module.take(length);
		if (id === 10) {
			codeOffset = offset;
			codeEnd = offset + length;
		}
		if (id === 0) {
			const section = new Reader(body);
			const name = section.string();
			if (name.startsWith('teavm_')) sections.set(name, section.take(section.remaining));
		}
	}
	if (!codeOffset || !sections.has('teavm_line'))
		throw new Error('Java module has no embedded TeaVM source locations');
	const reader = (name: string) => new Reader(sections.get(name) ?? new Uint8Array());
	const strings: string[] = [];
	const stringReader = reader('teavm_str');
	while (stringReader.remaining) strings.push(stringReader.string());
	const fileRows: Array<{ parent: number; name: string }> = [];
	const filesReader = reader('teavm_file');
	while (filesReader.remaining) {
		const parent = filesReader.leb();
		const nameIndex = filesReader.leb();
		let name = entry(strings, Math.floor(nameIndex / 2));
		if (nameIndex & 1) name += `.${entry(strings, filesReader.leb())}`;
		fileRows.push({ parent, name });
	}
	const files = treeNames(fileRows, '/');
	const packageRows: Array<{ parent: number; name: string }> = [];
	const packagesReader = reader('teavm_pkg');
	while (packagesReader.remaining)
		packageRows.push({
			parent: packagesReader.leb(),
			name: entry(strings, packagesReader.leb())
		});
	const packages = treeNames(packageRows, '.');
	const classes: string[] = [];
	const classesReader = reader('teavm_cls');
	while (classesReader.remaining) {
		const parent = classesReader.leb();
		const name = entry(strings, classesReader.leb());
		classes.push(parent ? `${entry(packages, parent - 1)}.${name}` : name);
	}
	const methods: string[] = [];
	const methodsReader = reader('teavm_mtd');
	while (methodsReader.remaining)
		methods.push(
			`${entry(classes, methodsReader.leb())}.${entry(strings, methodsReader.leb())}`
		);

	const normalized = sourcePaths?.map((path) => ({
		path,
		normalized: path.replace(/\\/g, '/').replace(/^\.\//, '')
	}));
	const resolveSource = (path: string) => {
		if (!normalized) return path;
		const exact = normalized.filter(
			(item) => path === item.normalized || path.endsWith(`/${item.normalized}`)
		);
		if (exact.length === 1) return exact[0].path;
		const base = path.split('/').pop();
		const candidates = normalized.filter((item) => item.normalized.split('/').pop() === base);
		return candidates.length === 1 ? candidates[0].path : '';
	};
	const sourceFiles = files.map(resolveSource);
	const lines = reader('teavm_line');
	const locations: CdpWasmLocation[] = [];
	let address = 0;
	let state = { method: '', file: 0, line: 1 };
	const stack: Array<typeof state> = [];
	let previous: CdpWasmLocation | undefined;
	const record = () => {
		// WasmBinaryRenderer 0.13.1 supplies module offsets to GCDebugInfoBuilder,
		// with sectionOffset = output.position + 4 while the section header takes
		// one id byte + four length bytes. CDP uses the actual module byte offset.
		const absolute = address + 1;
		if (absolute > codeEnd) throw new Error('TeaVM source location exceeds the code section');
		if (previous) previous.endAddress = absolute;
		previous = undefined;
		if (!state.method || !state.file || state.line < 1) return;
		const sourcePath = entry(sourceFiles, state.file - 1);
		if (!sourcePath) return;
		previous = {
			address: absolute,
			endAddress: codeEnd,
			sourcePath,
			line: state.line,
			functionName: state.method,
			...(stack.length > 1 ? { inlineDepth: stack.length - 1 } : {})
		};
		locations.push(previous);
	};
	while (lines.remaining) {
		const command = lines.byte();
		if (command === 0) {
			stack.push(state);
			state = { method: entry(methods, lines.leb()), file: 0, line: 1 };
			record();
		} else if (command === 1) {
			if (!stack.length) throw new Error('Unbalanced TeaVM debug method');
			state = stack.pop()!;
			record();
		} else if (command === 2) {
			state.line += lines.leb(true);
			record();
		} else if (command === 3) {
			state.file = lines.leb();
			state.line = 1;
			record();
		} else if (command === 4) {
			address += lines.leb();
		} else if (command >= 10) {
			address += (command - 10) % 32;
			state.line += Math.floor((command - 10) / 32) - 3;
			record();
		} else throw new Error('Unsupported TeaVM debug line command');
	}
	if (stack.length) throw new Error('Unterminated TeaVM debug method');
	return locations.filter((location) => location.endAddress! > location.address);
}
