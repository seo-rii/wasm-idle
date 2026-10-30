import { gccDigest } from './manifest.js';
import { gccRelativePath } from './plan.js';
import { inspectGccWasm } from './wasm-output.js';
import type {
	WasiGccCompileRequest,
	WasiGccLinkInput,
	WasiGccLinkedInput,
	WasiGccLinkProfile,
	WasiGccManifest
} from './types.js';

const maxBytes = 64 * 1024 * 1024;
const maxMembers = 4096;
const decoder = new TextDecoder('utf-8', { fatal: true });
const clangCommit = '4434dabb69916856b824f68a64b029c67175e532';

function record(value: unknown, keys: readonly string[], label: string) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error(`Invalid GCC link input ${label}`);
	return value as Record<string, unknown>;
}

function profileSnapshot(value: unknown): WasiGccLinkProfile {
	const profile = record(
		value,
		['target', 'abi', 'simd', 'language', 'rtti', 'compatibility'],
		'profile'
	);
	if (
		profile.target !== 'wasm32-wasi' ||
		profile.abi !== 'wasm32-wasi-preview1' ||
		typeof profile.simd !== 'boolean'
	)
		throw new Error('Unsupported GCC link input target/ABI/SIMD profile');
	const language = profile.language,
		rtti = profile.rtti;
	if (language !== undefined && language !== 'c' && language !== 'cpp')
		throw new Error('Invalid GCC link input language profile');
	if (rtti !== undefined && typeof rtti !== 'boolean')
		throw new Error('Invalid GCC link input RTTI profile');
	if (rtti === true && language !== 'cpp')
		throw new Error('RTTI-enabled link inputs require an explicit C++ language profile');
	const compatibility = record(
		profile.compatibility,
		['kind', 'manifestSha256', 'sysrootSha256', 'compilerVersion', 'compilerCommit'],
		'compatibility'
	);
	const sysrootSha256 = gccDigest(compatibility.sysrootSha256);
	let contract: WasiGccLinkProfile['compatibility'];
	if (compatibility.kind === 'gcc-bundle') {
		if ('compilerVersion' in compatibility || 'compilerCommit' in compatibility)
			throw new Error('GCC bundle compatibility uses the exact manifest identity');
		contract = {
			kind: 'gcc-bundle',
			manifestSha256: gccDigest(compatibility.manifestSha256),
			sysrootSha256
		};
	} else if (
		compatibility.kind === 'clang-c-scalar-v1' &&
		compatibility.compilerVersion === '22.1.0' &&
		compatibility.compilerCommit === clangCommit &&
		!('manifestSha256' in compatibility)
	) {
		if (language === 'cpp') throw new Error('clang-c-scalar-v1 requires a C language profile');
		contract = {
			kind: 'clang-c-scalar-v1',
			compilerVersion: '22.1.0',
			compilerCommit: clangCommit,
			sysrootSha256
		};
	} else throw new Error('Unsupported GCC link input ABI compatibility contract');
	return Object.freeze({
		target: 'wasm32-wasi',
		abi: 'wasm32-wasi-preview1',
		simd: profile.simd,
		...(language === undefined ? {} : { language }),
		...(rtti === undefined ? {} : { rtti }),
		compatibility: Object.freeze(contract)
	});
}

/** Synchronous copies precede every await and Worker postMessage, including shared-buffer inputs. */
export function snapshotWasiGccLinkInputs(
	value: WasiGccCompileRequest['linkInputs']
): readonly WasiGccLinkInput[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 128)
		throw new Error('GCC supports at most 128 explicit link inputs');
	const paths: string[] = [];
	let total = 0;
	return value.map((value) => {
		const input = record(value, ['path', 'format', 'bytes', 'sha256', 'profile'], 'record');
		const path = gccRelativePath(input.path);
		if (
			(input.format !== 'wasm-object' && input.format !== 'wasm-archive') ||
			!path.endsWith(input.format === 'wasm-object' ? '.o' : '.a')
		)
			throw new Error(
				`GCC link input ${path}: expected explicit .o object or .a archive format`
			);
		if (
			paths.some(
				(existing) =>
					existing === path ||
					existing.startsWith(`${path}/`) ||
					path.startsWith(`${existing}/`)
			)
		)
			throw new Error(`Duplicate or conflicting GCC link input path: ${path}`);
		paths.push(path);
		if (
			!(input.bytes instanceof Uint8Array) ||
			input.bytes.byteLength < 8 ||
			(total += input.bytes.byteLength) > maxBytes
		)
			throw new Error('GCC link inputs exceed the 64 MiB limit or contain empty bytes');
		return Object.freeze({
			path,
			format: input.format,
			bytes: Uint8Array.from(input.bytes),
			sha256: gccDigest(input.sha256),
			profile: profileSnapshot(input.profile)
		});
	});
}

export async function gccLinkDigest(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

class Reader {
	constructor(
		readonly bytes: Uint8Array,
		public position = 0,
		readonly end = bytes.length
	) {}
	byte() {
		if (this.position >= this.end) throw new Error('Truncated Wasm linking metadata');
		return this.bytes[this.position++];
	}
	uint() {
		let value = 0;
		for (let shift = 0; shift <= 28; shift += 7) {
			const byte = this.byte();
			if (shift === 28 && byte > 15) break;
			value += (byte & 127) * 2 ** shift;
			if (byte < 128) return value;
		}
		throw new Error('Invalid Wasm linking integer');
	}
	count() {
		const count = this.uint();
		if (count > this.end - this.position) throw new Error('Truncated Wasm linking vector');
		return count;
	}
	signed() {
		for (let index = 0; index < 5; index++) {
			const byte = this.byte();
			if (byte < 128) {
				if (index === 4 && byte > 7 && byte < 120) break;
				return;
			}
		}
		throw new Error('Invalid Wasm relocation addend');
	}
	part(length = this.uint()) {
		if (length > this.end - this.position) throw new Error('Truncated Wasm linking payload');
		const part = new Reader(this.bytes, this.position, this.position + length);
		this.position += length;
		return part;
	}
	name() {
		const part = this.part();
		return decoder.decode(this.bytes.subarray(part.position, part.end));
	}
	done() {
		if (this.position !== this.end) throw new Error('Trailing bytes in Wasm linking metadata');
	}
}

type Section = { id: number; start: number; end: number; payload: number; name?: string };
type Symbol = { kind: number; flags: number; index?: number; name?: string };

/** Bounded object metadata checks complement the existing instruction decoder and Wasm engine.
 * Format: tool-conventions/25aceba5adba8f3f7cdbadd8e8705784aebcad6a/Linking.md.
 * LLD remains responsible for cross-object symbol resolution and final relocation application.
 */
async function inspectObject(
	bytes: Uint8Array,
	profile: WasiGccLinkProfile,
	manifest: WasiGccManifest
) {
	const inspection = await inspectGccWasm(bytes, 'object');
	if (inspection.features.simd128 && !profile.simd)
		throw new Error('Object contains SIMD outside its declared profile');
	const scalar = profile.compatibility.kind === 'clang-c-scalar-v1';
	const sections: Section[] = [];
	const reader = new Reader(bytes, 8);
	while (reader.position < reader.end) {
		const id = reader.byte(),
			part = reader.part(),
			start = part.position;
		const name = id === 0 ? part.name() : undefined;
		if (name === 'dylink' || name === 'dylink.0')
			throw new Error('Dynamic Wasm objects are unsupported');
		sections.push({ id, start, end: part.end, payload: part.position, name });
	}
	const standard = (id: number) => sections.find((section) => section.id === id);
	const content = (section: Section) => new Reader(bytes, section.payload, section.end);
	const count = (id: number) => {
		const section = standard(id);
		return section ? content(section).uint() : 0;
	};
	const types: { parameters: number[]; results: number[] }[] = [];
	const typeSection = standard(1);
	if (typeSection) {
		const r = content(typeSection);
		for (let n = r.count(); n > 0; n--) {
			if (r.byte() !== 0x60) throw new Error('Unsupported object function type');
			const parameters = Array.from({ length: r.count() }, () => r.byte());
			const results = Array.from({ length: r.count() }, () => r.byte());
			if (
				scalar &&
				(results.length > 1 ||
					[...parameters, ...results].some(
						(type) => ![0x7f, 0x7e, 0x7d, 0x7c].includes(type)
					))
			)
				throw new Error('clang-c-scalar-v1 excludes vector/reference function interfaces');
			types.push({ parameters, results });
		}
		r.done();
	}
	const imported = new Map<number, string[]>([
		[0, []],
		[2, []],
		[5, []]
	]);
	const functionTypes: number[] = [];
	const imports = standard(2);
	if (imports) {
		const r = content(imports);
		const limits = () => {
			const flags = r.uint();
			r.uint();
			if (flags & 1) r.uint();
		};
		for (let n = r.count(); n > 0; n--) {
			const module = r.name(),
				name = r.name(),
				kind = r.byte();
			if (module !== 'env' && module !== 'wasi_snapshot_preview1')
				throw new Error(`Unsupported object import module: ${module}`);
			if (kind === 0) {
				imported.get(0)!.push(name);
				functionTypes.push(r.uint());
			} else if (kind === 1) {
				imported.get(5)!.push(name);
				r.byte();
				limits();
			} else if (kind === 2) limits();
			else if (kind === 3) {
				imported.get(2)!.push(name);
				r.byte();
				r.byte();
			} else throw new Error('Unsupported object import kind');
		}
		r.done();
	}
	const functions = standard(3);
	if (functions) {
		const r = content(functions);
		for (let n = r.count(); n > 0; n--) functionTypes.push(r.uint());
		r.done();
	}
	const totals = new Map([
		[0, functionTypes.length],
		[2, imported.get(2)!.length + count(6)],
		[5, imported.get(5)!.length + count(4)]
	]);
	const chunks = new Map<Section, { start: number; end: number }[]>();
	const code = standard(10);
	if (code) {
		const r = content(code),
			ranges = [];
		for (let n = r.count(); n > 0; n--) {
			const body = r.part();
			for (let locals = body.count(); locals > 0; locals--) {
				body.uint();
				body.byte();
			}
			ranges.push({ start: body.position, end: body.end });
		}
		r.done();
		chunks.set(code, ranges);
	}
	const data = standard(11),
		segments: { start: number; end: number }[] = [];
	if (data) {
		const r = content(data);
		for (let n = r.count(); n > 0; n--) {
			const flags = r.uint();
			if (flags > 2 || (flags === 2 && r.uint() !== 0))
				throw new Error('Unsupported object data segment');
			if (flags !== 1) {
				if (r.byte() !== 0x41)
					throw new Error('Object data offset must be an i32 constant');
				r.signed();
				if (r.byte() !== 0x0b) throw new Error('Invalid object data offset');
			}
			const payload = r.part();
			segments.push({ start: payload.position, end: payload.end });
		}
		r.done();
		chunks.set(data, segments);
	}
	const linking = sections.find((section) => section.name === 'linking')!;
	if (
		sections.some(
			(section) => section.id !== 0 && sections.indexOf(section) > sections.indexOf(linking)
		)
	)
		throw new Error('Object linking metadata must follow standard sections');
	const lr = content(linking);
	if (lr.uint() !== 2) throw new Error('Unsupported Wasm object linking version');
	const subsections = new Map<number, Reader>();
	while (lr.position < lr.end) {
		const id = lr.byte(),
			part = lr.part();
		if (![5, 6, 7, 8, 9].includes(id) || subsections.has(id))
			throw new Error('Unsupported or duplicate Wasm linking subsection');
		subsections.set(id, part);
	}
	const symbols: Symbol[] = [];
	const sr = subsections.get(8);
	if (!sr) throw new Error('Wasm object requires a linking symbol table');
	const externalNames = new Set<string>();
	for (let n = sr.count(); n > 0; n--) {
		const kind = sr.byte(),
			flags = sr.uint(),
			undefinedSymbol = Boolean(flags & 0x10);
		if (flags & ~0xf7 || (flags & 3) === 3 || (undefinedSymbol && (flags & 3) === 2))
			throw new Error(
				'Unsupported object symbol flags (TLS/common/absolute are not supported)'
			);
		const symbol: Symbol = { kind, flags };
		if (kind === 0 || kind === 2 || kind === 5) {
			symbol.index = sr.uint();
			const names = imported.get(kind)!;
			if (
				symbol.index >= totals.get(kind)! ||
				undefinedSymbol !== symbol.index < names.length
			)
				throw new Error('Invalid Wasm object symbol index or definition');
			symbol.name = !undefinedSymbol || flags & 0x40 ? sr.name() : names[symbol.index];
		} else if (kind === 1) {
			symbol.name = sr.name();
			if (!undefinedSymbol) {
				symbol.index = sr.uint();
				const offset = sr.uint(),
					size = sr.uint(),
					segment = segments[symbol.index];
				if (
					!segment ||
					offset > segment.end - segment.start ||
					size > segment.end - segment.start - offset
				)
					throw new Error('Object data symbol exceeds its segment');
			}
		} else if (kind === 3) {
			symbol.index = sr.uint();
			if (!sections[symbol.index] || ![0, 10, 11].includes(sections[symbol.index].id))
				throw new Error('Invalid object section symbol');
		} else throw new Error('Unsupported Wasm object symbol kind');
		if (symbol.name !== undefined && (flags & 3) !== 2) {
			if (!symbol.name || externalNames.has(symbol.name))
				throw new Error('Duplicate or empty external object symbol');
			externalNames.add(symbol.name);
			if (scalar && (symbol.name.startsWith('_Z') || symbol.name.startsWith('__cxa_')))
				throw new Error('clang-c-scalar-v1 excludes C++ object interfaces');
		}
		symbols.push(symbol);
	}
	sr.done();
	const segmentInfo = subsections.get(5);
	if (segmentInfo) {
		const size = segmentInfo.count();
		if (size !== segments.length) throw new Error('Object segment metadata count mismatch');
		for (let n = size; n > 0; n--) {
			segmentInfo.name();
			if (segmentInfo.uint() > 31 || segmentInfo.uint() & ~5)
				throw new Error('Unsupported object segment flags/alignment');
		}
		segmentInfo.done();
	}
	const initializers = subsections.get(6);
	if (initializers) {
		const size = initializers.count();
		if (size && !manifest.capabilities.staticInitialization)
			throw new Error('This GCC bundle does not support object static initialization');
		for (let n = size; n > 0; n--) {
			initializers.uint();
			const symbol = symbols[initializers.uint()];
			const type =
				symbol?.index === undefined ? undefined : types[functionTypes[symbol.index]];
			if (
				symbol?.kind !== 0 ||
				symbol.flags & 0x10 ||
				!type ||
				type.parameters.length ||
				type.results.length
			)
				throw new Error('Invalid object initialization function');
		}
		initializers.done();
	}
	const comdats = subsections.get(7);
	if (comdats) {
		const names = new Set<string>();
		for (let n = comdats.count(); n > 0; n--) {
			const name = comdats.name();
			if (!name || names.has(name) || comdats.uint() !== 0)
				throw new Error('Invalid object COMDAT group');
			names.add(name);
			for (let entries = comdats.count(); entries > 0; entries--) {
				const kind = comdats.byte(),
					index = comdats.uint();
				const symbolKind = kind === 1 ? 0 : kind === 2 ? 2 : kind === 4 ? 5 : undefined;
				if (
					kind === 0
						? index >= segments.length
						: kind === 5
							? !sections[index]
							: symbolKind === undefined ||
								index < imported.get(symbolKind)!.length ||
								index >= totals.get(symbolKind)!
				)
					throw new Error('Invalid object COMDAT member');
			}
		}
		comdats.done();
	}
	const arch = subsections.get(9);
	if (arch) {
		if (arch.name() !== 'wasm32') throw new Error('Object target architecture is not wasm32');
		arch.done();
	}
	const featureSections = sections.filter((section) => section.name === 'target_features');
	if (featureSections.length > 1) throw new Error('Duplicate object target_features');
	for (const featureSection of featureSections) {
		const r = content(featureSection),
			names = new Set<string>();
		for (let n = r.count(); n > 0; n--) {
			const prefix = r.byte(),
				name = r.name();
			if (![43, 45].includes(prefix) || names.has(name))
				throw new Error('Malformed object target_features');
			names.add(name);
			const allowed = [
				'bulk-memory',
				'bulk-memory-opt',
				'call-indirect-overlong',
				'multivalue',
				'mutable-globals',
				'nontrapping-fptoint',
				'reference-types',
				'sign-ext',
				'simd128'
			];
			if (prefix === 43 && (!allowed.includes(name) || (name === 'simd128' && !profile.simd)))
				throw new Error(`Unsupported object target feature: ${name}`);
			if (prefix === 45 && name === 'simd128' && profile.simd)
				throw new Error('Object prohibits requested SIMD profile');
		}
		r.done();
	}
	const relocatedSections = new Set<number>();
	for (const relocation of sections.filter((section) => section.name?.startsWith('reloc.'))) {
		if (sections.indexOf(relocation) < sections.indexOf(linking))
			throw new Error('Object relocations precede symbol table');
		const r = content(relocation),
			targetIndex = r.uint(),
			target = sections[targetIndex];
		if (
			!target ||
			![0, 10, 11].includes(target.id) ||
			targetIndex >= sections.indexOf(relocation) ||
			relocatedSections.has(targetIndex)
		)
			throw new Error('Invalid or duplicate object relocation target section');
		relocatedSections.add(targetIndex);
		let previousEnd = -1;
		for (let n = r.count(); n > 0; n--) {
			const type = r.byte(),
				offset = r.uint(),
				index = r.uint();
			const kinds = new Map([
				[0, 0],
				[1, 0],
				[2, 0],
				[3, 1],
				[4, 1],
				[5, 1],
				[7, 2],
				[8, 0],
				[9, 3],
				[13, 2],
				[20, 5],
				[23, 1],
				[26, 0]
			]);
			if (
				type === 6
					? index >= types.length
					: !kinds.has(type) || symbols[index]?.kind !== kinds.get(type)
			)
				throw new Error(
					'Unsupported relocation type or invalid relocation symbol/type index'
				);
			if ([3, 4, 5, 8, 9, 23].includes(type)) r.signed();
			const leb = [0, 1, 3, 4, 6, 7, 20].includes(type),
				width = leb ? 5 : 4;
			const start = target.start + offset,
				end = start + width;
			const ranges = chunks.get(target) ?? [{ start: target.payload, end: target.end }];
			if (
				offset < previousEnd ||
				!ranges.some((range) => start >= range.start && end <= range.end)
			)
				throw new Error('Object relocation is overlapping or outside a code/data chunk');
			previousEnd = offset + width;
			if (leb) {
				const last = bytes[end - 1],
					signed = type === 1 || type === 4;
				if (
					![0, 1, 2, 3].every((i) => bytes[start + i] >= 128) ||
					last >= 128 ||
					(signed ? last > 7 && last < 120 : last > 15)
				)
					throw new Error('Object relocation requires a padded 32-bit LEB immediate');
			}
		}
		r.done();
	}
	return symbols
		.filter((symbol) => !(symbol.flags & 0x10) && (symbol.flags & 3) !== 2 && symbol.name)
		.map((symbol) => symbol.name!);
}

/** Regular GNU ar only. No thin archives, nested archives, path extraction, ELF or LLVM bitcode. */
function archiveMembers(bytes: Uint8Array) {
	if (decoder.decode(bytes.subarray(0, 8)) !== '!<arch>\n')
		throw new Error('Expected a regular GNU ar archive (thin archives are unsupported)');
	const members: { path: string; bytes: Uint8Array; offset: number }[] = [];
	let position = 8,
		strings: Uint8Array | undefined,
		index: Uint8Array | undefined;
	const names = new Set<string>();
	while (position < bytes.length) {
		const offset = position;
		if (bytes.length - position < 60) throw new Error('Truncated GNU archive header');
		const header = decoder.decode(bytes.subarray(position, position + 60));
		if (!header.endsWith('`\n') || !/^\d+ *$/u.test(header.slice(48, 58)))
			throw new Error('Malformed GNU archive header');
		const size = Number(header.slice(48, 58).trim());
		position += 60;
		if (!Number.isSafeInteger(size) || size > bytes.length - position)
			throw new Error('Truncated GNU archive member');
		const payload = bytes.subarray(position, position + size);
		position += size;
		if (position % 2) {
			if (bytes[position++] !== 10) throw new Error('Invalid GNU archive padding');
		}
		let name = header.slice(0, 16).trimEnd();
		if (name === '/') {
			if (index) throw new Error('Duplicate GNU archive index');
			index = payload;
			continue;
		}
		if (name === '//') {
			if (strings) throw new Error('Duplicate GNU archive name table');
			strings = payload;
			continue;
		}
		if (/^\/\d+$/u.test(name)) {
			const start = Number(name.slice(1));
			if (!strings || start >= strings.length || (start && strings[start - 1] !== 10))
				throw new Error('Invalid GNU archive long name');
			const end = strings.indexOf(10, start);
			if (end < 0 || strings[end - 1] !== 47)
				throw new Error('Malformed GNU archive long name');
			name = decoder.decode(strings.subarray(start, end - 1));
		} else if (name.endsWith('/')) name = name.slice(0, -1);
		else throw new Error('Unsupported GNU archive member name encoding');
		gccRelativePath(name);
		if (names.has(name) || members.length >= maxMembers)
			throw new Error('Duplicate archive member or more than 4096 members');
		names.add(name);
		members.push({ path: name, bytes: payload, offset });
	}
	if (!members.length || !index)
		throw new Error('GNU archive requires Wasm members and a 32-bit symbol index');
	const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
	if (index.length < 4) throw new Error('Truncated GNU archive symbol index');
	const count = view.getUint32(0);
	if (count > Math.floor((index.length - 4) / 5))
		throw new Error('Truncated GNU archive symbol index entries');
	let cursor = 4 + count * 4;
	const entries: { offset: number; name: string }[] = [];
	for (let i = 0; i < count; i++) {
		const offset = view.getUint32(4 + i * 4),
			end = index.indexOf(0, cursor);
		if (!members.some((member) => member.offset === offset) || end < 0)
			throw new Error('Invalid GNU archive symbol index offset/name');
		const name = decoder.decode(index.subarray(cursor, end));
		if (!name) throw new Error('Empty GNU archive index symbol');
		entries.push({ offset, name });
		cursor = end + 1;
	}
	// llvm-ar rounds the GNU index payload to even size with one NUL byte.
	if (
		cursor !== index.length &&
		!(cursor % 2 && cursor + 1 === index.length && index[cursor] === 0)
	)
		throw new Error('Trailing GNU archive symbol index bytes');
	return { members, entries };
}

/** Validate all bytes before starting the compiler; do not trust caller-provided Wasm inspection. */
export async function validateWasiGccLinkInputs(
	inputs: readonly WasiGccLinkInput[],
	manifest: WasiGccManifest,
	manifestSha256: string,
	simd: boolean,
	language: 'c' | 'cpp',
	rtti = false
): Promise<readonly WasiGccLinkedInput[]> {
	if (rtti && (language !== 'cpp' || !manifest.capabilities.rtti))
		throw new Error('RTTI link validation requires a capable bundle and C++ source request');
	const identities: WasiGccLinkedInput[] = [];
	for (const input of inputs) {
		try {
			const { profile } = input,
				{ compatibility } = profile;
			if (profile.simd !== simd)
				throw new Error('Link input SIMD profile differs from the compilation request');
			if (compatibility.sysrootSha256 !== manifest.assets.sysroot.sha256)
				throw new Error('Link input sysroot identity mismatch');
			if (
				compatibility.kind === 'gcc-bundle'
					? compatibility.manifestSha256 !== manifestSha256
					: language !== 'c'
			)
				throw new Error(
					compatibility.kind === 'gcc-bundle'
						? 'Link input GCC bundle identity mismatch'
						: 'clang-c-scalar-v1 requires a C source request'
				);
			if (profile.rtti === true && !manifest.capabilities.rtti)
				throw new Error('Link input requires an RTTI-capable GCC bundle');
			// C has no RTTI mode. Unknown legacy provenance must not be assumed C.
			if (profile.language !== 'c' && (profile.rtti === true) !== rtti)
				throw new Error(
					profile.language === undefined && rtti
						? 'Link input has unknown legacy language provenance for an RTTI-enabled request'
						: 'Link input C++ RTTI profile differs from the compilation request'
				);
			if ((await gccLinkDigest(input.bytes)) !== input.sha256)
				throw new Error('Link input SHA-256 mismatch');
			let members: WasiGccLinkedInput['members'];
			if (input.format === 'wasm-object') await inspectObject(input.bytes, profile, manifest);
			else {
				const archive = archiveMembers(input.bytes),
					receipts = [],
					definitions = new Map<number, string[]>();
				for (const member of archive.members) {
					try {
						definitions.set(
							member.offset,
							await inspectObject(member.bytes, profile, manifest)
						);
					} catch (error) {
						throw new Error(
							`Archive member ${member.path}: ${error instanceof Error ? error.message : String(error)}`
						);
					}
					receipts.push(
						Object.freeze({
							path: member.path,
							bytes: member.bytes.length,
							sha256: await gccLinkDigest(member.bytes)
						})
					);
				}
				for (const entry of archive.entries)
					if (!definitions.get(entry.offset)!.includes(entry.name))
						throw new Error(
							`Archive index references an absent definition: ${entry.name}`
						);
				members = Object.freeze(receipts);
			}
			identities.push(
				Object.freeze({
					path: input.path,
					format: input.format,
					bytes: input.bytes.length,
					sha256: input.sha256,
					profile,
					...(members ? { members } : {})
				})
			);
		} catch (error) {
			throw new Error(
				`GCC link input ${input.path}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error }
			);
		}
	}
	return Object.freeze(identities);
}
