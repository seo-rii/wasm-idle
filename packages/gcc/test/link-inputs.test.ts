import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gccCompilePlan } from '../src/plan.js';
import { wasiGccCompilePlan } from '../src/wasi-plan.js';
import {
	gccLinkDigest,
	snapshotWasiGccLinkInputs,
	validateWasiGccLinkInputs
} from '../src/wasm-link-inputs.js';
import type {
	CrossGccManifest,
	WasiGccLinkInput,
	WasiGccLinkProfile,
	WasiGccManifest
} from '../src/types.js';

const encoder = new TextEncoder();
const hash = 'a'.repeat(64),
	sysrootHash = 'b'.repeat(64);
const profile: WasiGccLinkProfile = {
	target: 'wasm32-wasi',
	abi: 'wasm32-wasi-preview1',
	simd: false,
	compatibility: { kind: 'gcc-bundle', manifestSha256: hash, sysrootSha256: sysrootHash }
};
const manifest = {
	compiler: { version: '17.0.0' },
	assets: { sysroot: { sha256: sysrootHash } },
	sysrootPath: '/sysroot',
	gccInstallation: '/sysroot/lib/gcc/wasm32-wasi/17.0.0',
	resourceDir: '/sysroot/lib/gcc/wasm32-wasi/17.0.0/include',
	runtimeLibraries: ['/sysroot/lib/builtins.a'],
	capabilities: { cpp: true, libc: true, libm: true, simd: true, staticInitialization: true }
} as unknown as WasiGccManifest;

const uint = (value: number): number[] => {
	const bytes = [];
	do {
		const byte = value & 127;
		value >>>= 7;
		bytes.push(byte | (value ? 128 : 0));
	} while (value);
	return bytes;
};
const name = (value: string) => [...uint(encoder.encode(value).length), ...encoder.encode(value)];
const section = (id: number, bytes: number[]) => [id, ...uint(bytes.length), ...bytes];
const custom = (key: string, bytes: number[]) => section(0, [...name(key), ...bytes]);

// Binary-format contract fixtures, not a compiler or evidence of compiler qualification.
function object(
	options: {
		relocation?: boolean;
		offset?: number;
		index?: number;
		symbol?: string;
		version?: number;
		noSymbols?: boolean;
		simd?: boolean;
		relaxedSimd?: boolean;
		feature?: string;
		prohibitFeature?: boolean;
		init?: boolean;
		importName?: string;
	} = {}
) {
	const symbol = options.symbol ?? 'helper';
	const body = options.simd
		? [
				0,
				0xfd,
				0x0c,
				...Array<number>(16).fill(0),
				...(options.relaxedSimd
					? [0xfd, 0x0c, ...Array<number>(16).fill(0), 0xfd, 0x80, 2]
					: []),
				0x0b
			]
		: [0, 0x20, 0, ...(options.relocation ? [0x10, 0x80, 0x80, 0x80, 0x80, 0] : []), 0x0b];
	const symbols = options.relocation
		? [2, 0, 0, 1, ...name(symbol), 0, 16, 0]
		: [1, 0, 0, 0, ...name(symbol)];
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...section(1, options.simd ? [1, 0x60, 0, 1, 0x7b] : [1, 0x60, 1, 0x7f, 1, 0x7f]),
		...(options.relocation
			? section(2, [1, ...name('env'), ...name(options.importName ?? 'callee'), 0, 0])
			: []),
		...section(3, [1, 0]),
		...section(10, [1, ...uint(body.length), ...body]),
		...custom('linking', [
			options.version ?? 2,
			...(options.noSymbols ? [] : section(8, symbols)),
			...(options.init ? section(6, [1, 0, 0]) : [])
		]),
		...(options.relocation
			? custom('reloc.CODE', [
					3,
					1,
					0,
					...uint(options.offset ?? 6),
					...uint(options.index ?? 1)
				])
			: []),
		...(options.feature
			? custom('target_features', [
					1,
					options.prohibitFeature ? 45 : 43,
					...name(options.feature)
				])
			: [])
	]);
}

function archive(
	members: { path: string; bytes: Uint8Array; symbol: string }[],
	wrongIndex = false
) {
	const chunks: Uint8Array[] = [encoder.encode('!<arch>\n')];
	const header = (path: string, bytes: Uint8Array) => {
		const text = `${path.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'644'.padEnd(8)}${String(bytes.length).padEnd(10)}\x60\n`;
		return [encoder.encode(text), bytes, ...(bytes.length % 2 ? [Uint8Array.of(10)] : [])];
	};
	const strings = encoder.encode(members.map((member) => `${member.symbol}\0`).join(''));
	const indexSize = 4 + 4 * members.length + strings.length;
	const index = new Uint8Array(indexSize + (indexSize % 2));
	const view = new DataView(index.buffer);
	view.setUint32(0, members.length);
	let offset = 8 + 60 + index.length + (index.length % 2);
	for (const [i, member] of members.entries()) {
		view.setUint32(4 + i * 4, wrongIndex ? offset + 1 : offset);
		offset += 60 + member.bytes.length + (member.bytes.length % 2);
	}
	index.set(strings, 4 + 4 * members.length);
	chunks.push(...header('/', index));
	for (const member of members) chunks.push(...header(`${member.path}/`, member.bytes));
	const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
	let position = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, position);
		position += chunk.length;
	}
	return bytes;
}

async function input(
	bytes = object(),
	path = 'helper.o',
	declaredProfile = profile
): Promise<WasiGccLinkInput> {
	return {
		path,
		format: path.endsWith('.a') ? 'wasm-archive' : 'wasm-object',
		bytes,
		sha256: await gccLinkDigest(bytes),
		profile: declaredProfile
	};
}
const validate = (inputs: readonly WasiGccLinkInput[], simd = false, language: 'c' | 'cpp' = 'c') =>
	validateWasiGccLinkInputs(snapshotWasiGccLinkInputs(inputs), manifest, hash, simd, language);

describe('explicit WASI link inputs', () => {
	it('binds relaxed object and archive inputs to explicit matching request and bundle profiles', async () => {
		const capable = {
			...manifest,
			capabilities: { ...manifest.capabilities, relaxedSimd: true }
		};
		const relaxedProfile = { ...profile, simd: true, relaxedSimd: true };
		const validateRelaxed = (entries: readonly WasiGccLinkInput[], selected = true) =>
			validateWasiGccLinkInputs(
				snapshotWasiGccLinkInputs(entries),
				capable,
				hash,
				true,
				'c',
				false,
				selected
			);
		const bytes = object({ simd: true, relaxedSimd: true, feature: 'relaxed-simd' });
		const raw = await input(bytes, 'relaxed.o', relaxedProfile);
		const packed = await input(
			archive([{ path: 'relaxed.o', bytes, symbol: 'helper' }]),
			'relaxed.a',
			relaxedProfile
		);
		for (const entry of [raw, packed]) {
			await expect(validateRelaxed([entry])).resolves.toMatchObject([
				{ profile: relaxedProfile }
			]);
			await expect(validateRelaxed([entry], false)).rejects.toThrow(
				'relaxed SIMD profile differs'
			);
			await expect(
				validateWasiGccLinkInputs([entry], manifest, hash, true, 'c', false, true)
			).rejects.toThrow('requires a capable bundle');
			await expect(
				validateRelaxed([{ ...entry, profile: { ...profile, simd: true } }])
			).rejects.toThrow('relaxed SIMD profile differs');
			await expect(
				validateRelaxed([{ ...entry, profile: { ...profile, simd: true } }], false)
			).rejects.toThrow('requires explicit opt-in');
		}
		for (const value of ['true', null, 0, {}])
			expect(() =>
				snapshotWasiGccLinkInputs([
					{ ...raw, profile: { ...relaxedProfile, relaxedSimd: value } } as never
				])
			).toThrow('Invalid GCC link input relaxed SIMD profile');
		expect(() =>
			snapshotWasiGccLinkInputs([{ ...raw, profile: { ...relaxedProfile, simd: false } }])
		).toThrow('require a SIMD profile');
		await expect(
			validateRelaxed([
				await input(
					object({ simd: true, feature: 'relaxed-simd', prohibitFeature: true }),
					'prohibit.o',
					relaxedProfile
				)
			])
		).rejects.toThrow('Object prohibits requested relaxed SIMD profile');
		const unsupported = {
			...relaxedProfile,
			compatibility: {
				kind: 'clang-c-scalar-v1' as const,
				compilerVersion: '22.1.0' as const,
				compilerCommit: '4434dabb69916856b824f68a64b029c67175e532' as const,
				sysrootSha256: sysrootHash
			}
		};
		expect(() => snapshotWasiGccLinkInputs([{ ...raw, profile: unsupported }])).toThrow(
			'does not qualify relaxed SIMD'
		);
		const legacy = await input();
		expect(snapshotWasiGccLinkInputs([legacy])[0].profile).not.toHaveProperty('relaxedSimd');
		await expect(validate([legacy])).resolves.toHaveLength(1);
	});

	it('accepts native DWARF custom relocations relative to payload and checks every slot boundary', async () => {
		const bytes = Uint8Array.from(
			readFileSync(new URL('./fixtures/dwarf-native.o', import.meta.url))
		);
		const provenance = JSON.parse(
			readFileSync(new URL('./fixtures/dwarf-native.json', import.meta.url), 'utf8')
		);
		expect(bytes.length).toBe(provenance.object.bytes);
		expect(await gccLinkDigest(bytes)).toBe(provenance.object.sha256);
		const receipt = await validate([await input(bytes, 'dwarf.o')]);
		expect(receipt[0].sha256).toBe(provenance.object.sha256);

		// Rebuild only the standard relocation vector around this real object.
		// Custom offsets start after both the name-length LEB and name bytes.
		const readUint = (data: Uint8Array, start: number): [number, number] => {
			let value = 0,
				shift = 0,
				cursor = start;
			for (;;) {
				const byte = data[cursor++];
				value += (byte & 127) * 2 ** shift;
				if (byte < 128) return [value, cursor];
				shift += 7;
			}
		};
		const parts: { id: number; bytes: Uint8Array; name?: string; payload: number }[] = [];
		for (let cursor = 8; cursor < bytes.length;) {
			const id = bytes[cursor++];
			const [length, start] = readUint(bytes, cursor);
			const end = start + length;
			let payload = start,
				name: string | undefined;
			if (id === 0) {
				const [size, begin] = readUint(bytes, payload);
				name = new TextDecoder().decode(bytes.subarray(begin, begin + size));
				payload = begin + size;
			}
			parts.push({ id, name, bytes: bytes.subarray(start, end), payload: payload - start });
			cursor = end;
		}
		const relocation = parts.find((part) => part.name === 'reloc..debug_info')!;
		const [target, cursor] = readUint(relocation.bytes, relocation.payload);
		const [, entryStart] = readUint(relocation.bytes, cursor);
		const entries = relocation.bytes.subarray(entryStart);
		const [type, afterType] = readUint(entries, 0);
		const [, afterOffset] = readUint(entries, afterType);
		const source = parts[target];
		const size = source.bytes.length - source.payload;
		// One original relocation is retained, so the vector must end at its first entry.
		// All supported DWARF custom slots are fixed i32 and carry a standard signed addend.
		const [symbol, afterSymbol] = readUint(entries, afterOffset);
		let afterAddend = afterSymbol;
		if ([5, 8, 9].includes(type)) do {} while (entries[afterAddend++] & 128);
		const oneEntry = entries.subarray(afterOffset, afterAddend);
		const singleOffset = (offset: number) =>
			Uint8Array.from([
				...bytes.subarray(0, 8),
				...parts.flatMap((part) =>
					part === relocation
						? custom(part.name!, [target, 1, type, ...uint(offset), ...oneEntry])
						: section(part.id, [...part.bytes])
				)
			]);
		expect(symbol).toBeGreaterThanOrEqual(0);
		for (const offset of [0, size - 4])
			await expect(
				validate([await input(singleOffset(offset), 'boundary.o')])
			).resolves.toHaveLength(1);
		for (const offset of [size - 3, size, 0xffffffff])
			await expect(
				validate([await input(singleOffset(offset), 'outside.o')])
			).rejects.toThrow('outside');
	});

	it('preserves explicit coverage provenance and rejects covered objects/archives even when undeclared', async () => {
		const plain = await input();
		expect(snapshotWasiGccLinkInputs([plain])[0].profile).not.toHaveProperty('coverage');
		await expect(
			validate([{ ...plain, profile: { ...plain.profile, coverage: false } }])
		).resolves.toHaveLength(1);
		const covered = { ...plain, profile: { ...plain.profile, coverage: true } };
		expect(snapshotWasiGccLinkInputs([covered])[0].profile.coverage).toBe(true);
		await expect(validate([covered])).rejects.toThrow(
			'coverage link inputs are currently unsupported'
		);
		for (const bytes of [
			object({ symbol: '__gcov0.helper' }),
			object({ relocation: true, importName: '__gcov_init' }),
			archive([
				{
					path: 'covered.o',
					bytes: object({ symbol: '__gcov_merge_add' }),
					symbol: '__gcov_merge_add'
				}
			])
		]) {
			const isArchive = new TextDecoder().decode(bytes.subarray(0, 8)) === '!<arch>\n';
			await expect(
				validate([await input(bytes, isArchive ? 'covered.a' : 'covered.o')])
			).rejects.toThrow('coverage link inputs are currently unsupported');
		}
		for (const coverage of [null, 'true', 0, [], {}])
			expect(() =>
				snapshotWasiGccLinkInputs([
					{ ...plain, profile: { ...plain.profile, coverage } }
				] as never)
			).toThrow('Invalid GCC link input coverage profile');
	});

	it('copies bytes and profiles synchronously, including SharedArrayBuffer views', async () => {
		const bytes = new Uint8Array(new SharedArrayBuffer(object().length));
		bytes.set(object());
		const original = await input(bytes),
			copy = snapshotWasiGccLinkInputs([original]);
		bytes.fill(0);
		(original.profile.compatibility as { manifestSha256: string }).manifestSha256 = 'c'.repeat(
			64
		);
		expect(copy[0].bytes).toEqual(object());
		expect(copy[0].bytes.buffer).toBeInstanceOf(ArrayBuffer);
		expect(Object.isFrozen(copy[0].profile.compatibility)).toBe(true);
		// Restore the shared fixture profile; the snapshot retained its prior identity.
		(original.profile.compatibility as { manifestSha256: string }).manifestSha256 = hash;
		await expect(
			validateWasiGccLinkInputs(copy, manifest, hash, false, 'c')
		).resolves.toHaveLength(1);
	});

	it('links external inputs in exact order after all source objects, in a separate namespace', async () => {
		const first = await input(),
			library = await input(
				archive([{ path: 'helper.o', bytes: object(), symbol: 'helper' }]),
				'libhelper.a'
			);
		const plan = wasiGccCompilePlan(
			{
				code: 'int main(void) { return 0; }',
				language: 'c',
				files: [
					{ path: 'unit.c', contents: 'int unit;' },
					{ path: 'helper.o', contents: 'ordinary data' }
				],
				sources: ['unit.c'],
				linkInputs: [first, library]
			},
			manifest
		);
		const argv = plan.stages.at(-1)!.argv;
		expect(argv.slice(argv.indexOf('/workspace/program.o'), argv.indexOf('-lm'))).toEqual([
			'/workspace/program.o',
			'/workspace/program.1.o',
			'/link-inputs/helper.o',
			'/link-inputs/libhelper.a'
		]);
		expect(plan.files.find((file) => file.path === '/workspace/helper.o')?.contents).toEqual(
			encoder.encode('ordinary data')
		);
		expect(plan.files.find((file) => file.path === '/link-inputs/helper.o')?.contents).toEqual(
			first.bytes
		);
		expect(plan.stages.filter((stage) => stage.tool === 'cc1')).toHaveLength(2);
		for (const emit of ['object', 'assembly'] as const)
			expect(() =>
				wasiGccCompilePlan({ code: '', emit, linkInputs: [first] }, manifest)
			).toThrow('executable');
		expect(() =>
			gccCompilePlan({ code: '', linkInputs: [first] } as never, {} as CrossGccManifest)
		).toThrow('Unsupported GCC option');
	});

	it('accepts real object structure with or without relocations/optional feature metadata', async () => {
		const receipt = await validate([await input(object({ relocation: true }))]);
		expect(receipt[0]).toMatchObject({
			path: 'helper.o',
			sha256: await gccLinkDigest(object({ relocation: true }))
		});
		await expect(validate([await input(object())])).resolves.toHaveLength(1);
		await expect(
			validate([await input(object({ feature: 'multivalue' }))])
		).resolves.toHaveLength(1);
	});

	it.each([
		[{ version: 3 }, /linking metadata/],
		[{ noSymbols: true }, /symbol table/],
		[{ relocation: true, offset: 999 }, /outside/],
		[{ relocation: true, index: 100 }, /relocation symbol/],
		[{ feature: 'memory64' }, /target feature/],
		[{ feature: 'atomics' }, /target feature/],
		[{ feature: 'relaxed-simd' }, /target feature/],
		[{ init: true }, /initialization function/]
	] as const)(
		'rejects malformed or unsupported object metadata %j',
		async (options, diagnostic) => {
			await expect(validate([await input(object(options))])).rejects.toThrow(diagnostic);
		}
	);

	it('does not accept an arbitrary module or non-Wasm binary as an object', async () => {
		for (const bytes of [
			Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0),
			encoder.encode('LLVM bitcode is not an object'),
			Uint8Array.of(127, 69, 76, 70, 2, 1, 1, 0),
			object().subarray(0, -1)
		])
			await expect(validate([await input(bytes)])).rejects.toThrow();
	});

	it('rejects hash, compiler, sysroot and SIMD mismatches before tool execution', async () => {
		const original = await input();
		await expect(validate([{ ...original, sha256: '0'.repeat(64) }])).rejects.toThrow(
			'SHA-256'
		);
		for (const key of ['manifestSha256', 'sysrootSha256'] as const)
			await expect(
				validate([
					{
						...original,
						profile: {
							...profile,
							compatibility: {
								kind: 'gcc-bundle',
								manifestSha256: hash,
								sysrootSha256: sysrootHash,
								[key]: '0'.repeat(64)
							}
						}
					}
				])
			).rejects.toThrow('identity mismatch');
		await expect(validate([original], true)).rejects.toThrow('SIMD profile');
		await expect(validate([await input(object({ simd: true }))])).rejects.toThrow('SIMD');
		await expect(
			validate(
				[await input(object({ simd: true }), 'simd.o', { ...profile, simd: true })],
				true
			)
		).resolves.toHaveLength(1);
	});

	it('preserves legacy profiles while copying explicit language and RTTI provenance', async () => {
		const legacy = await input();
		expect(snapshotWasiGccLinkInputs([legacy])[0].profile).toEqual(profile);
		const declared = { ...profile, language: 'cpp' as const, rtti: true };
		const value = await input(object(), 'cpp.o', declared);
		const copied = snapshotWasiGccLinkInputs([value]);
		declared.rtti = false;
		expect(copied[0].profile).toMatchObject({ language: 'cpp', rtti: true });
		expect(Object.isFrozen(copied[0].profile)).toBe(true);
		for (const update of [
			{ language: 'objc' },
			{ language: null },
			{ rtti: 'true' },
			{ rtti: 1 },
			{ rtti: true },
			{ language: 'c', rtti: true }
		])
			expect(() =>
				snapshotWasiGccLinkInputs([
					{ ...legacy, profile: { ...profile, ...update } } as never
				])
			).toThrow(/language|RTTI/);
	});

	it('allows known C objects and archives with either C++ RTTI mode', async () => {
		const capable = { ...manifest, capabilities: { ...manifest.capabilities, rtti: true } };
		const c = { ...profile, language: 'c' as const };
		const values = [
			await input(object(), 'helper.o', c),
			await input(
				archive([{ path: 'helper.o', bytes: object(), symbol: 'helper' }]),
				'libhelper.a',
				c
			)
		];
		for (const rtti of [false, true])
			await expect(
				validateWasiGccLinkInputs(
					snapshotWasiGccLinkInputs(values),
					capable,
					hash,
					false,
					'cpp',
					rtti
				)
			).resolves.toHaveLength(2);
		await expect(
			validateWasiGccLinkInputs(snapshotWasiGccLinkInputs(values), capable, hash, false, 'c')
		).resolves.toHaveLength(2);
	});

	it('requires matching C++ RTTI modes and treats legacy missing language conservatively', async () => {
		const capable = { ...manifest, capabilities: { ...manifest.capabilities, rtti: true } };
		for (const rtti of [false, true]) {
			const declared = { ...profile, language: 'cpp' as const, rtti };
			for (const value of [
				await input(object(), 'cpp.o', declared),
				await input(
					archive([{ path: 'cpp.o', bytes: object(), symbol: 'helper' }]),
					'libcpp.a',
					declared
				)
			]) {
				const values = snapshotWasiGccLinkInputs([value]);
				await expect(
					validateWasiGccLinkInputs(values, capable, hash, false, 'cpp', rtti)
				).resolves.toHaveLength(1);
				await expect(
					validateWasiGccLinkInputs(values, capable, hash, false, 'cpp', !rtti)
				).rejects.toThrow('C++ RTTI profile');
			}
		}
		const legacy = snapshotWasiGccLinkInputs([await input()]);
		await expect(
			validateWasiGccLinkInputs(legacy, capable, hash, false, 'cpp')
		).resolves.toHaveLength(1);
		await expect(
			validateWasiGccLinkInputs(legacy, capable, hash, false, 'cpp', true)
		).rejects.toThrow('unknown legacy language');
		const enabled = snapshotWasiGccLinkInputs([
			await input(object(), 'cpp.o', { ...profile, language: 'cpp', rtti: true })
		]);
		await expect(
			validateWasiGccLinkInputs(enabled, manifest, hash, false, 'cpp')
		).rejects.toThrow('RTTI-capable');
		await expect(validateWasiGccLinkInputs(enabled, capable, hash, false, 'c')).rejects.toThrow(
			'C++ RTTI profile'
		);
	});

	it('requires the pinned explicitly declared scalar C contract for Clang inputs', async () => {
		const clang: WasiGccLinkProfile = {
			...profile,
			compatibility: {
				kind: 'clang-c-scalar-v1',
				compilerVersion: '22.1.0',
				compilerCommit: '4434dabb69916856b824f68a64b029c67175e532',
				sysrootSha256: sysrootHash
			}
		};
		const value = await input(object(), 'clang.o', clang);
		await expect(validate([value])).resolves.toHaveLength(1);
		await expect(validate([value], false, 'cpp')).rejects.toThrow('C source request');
		const capable = { ...manifest, capabilities: { ...manifest.capabilities, rtti: true } };
		await expect(
			validateWasiGccLinkInputs(
				snapshotWasiGccLinkInputs([value]),
				capable,
				hash,
				false,
				'cpp',
				true
			)
		).rejects.toThrow('C source request');
		expect(() =>
			snapshotWasiGccLinkInputs([{ ...value, profile: { ...clang, language: 'cpp' } }])
		).toThrow('C language profile');
		await expect(
			validate([await input(object({ symbol: '_Z6helperi' }), 'clang.o', clang)])
		).rejects.toThrow('C++ object interfaces');
		await expect(
			validate(
				[await input(object({ simd: true }), 'clang.o', { ...clang, simd: true })],
				true
			)
		).rejects.toThrow('scalar-v1');
		expect(() =>
			snapshotWasiGccLinkInputs([
				{
					...value,
					profile: {
						...clang,
						compatibility: { ...clang.compatibility, compilerVersion: 'other' }
					}
				} as never
			])
		).toThrow('compatibility contract');
	});

	it('validates all archive members and index definitions and records ordered member digests', async () => {
		const a = object({ symbol: 'a' }),
			b = object({ symbol: 'b', relocation: true });
		const value = await input(
			archive([
				{ path: 'a.o', bytes: a, symbol: 'a' },
				{ path: 'b.o', bytes: b, symbol: 'b' }
			]),
			'lib.a'
		);
		const [receipt] = await validate([value]);
		expect(receipt.members).toEqual([
			{ path: 'a.o', bytes: a.length, sha256: await gccLinkDigest(a) },
			{ path: 'b.o', bytes: b.length, sha256: await gccLinkDigest(b) }
		]);
		await expect(
			validate([await input(archive([{ path: 'a.o', bytes: a, symbol: 'absent' }]), 'bad.a')])
		).rejects.toThrow('absent definition');
		await expect(
			validate([
				await input(archive([{ path: 'a.o', bytes: a, symbol: 'a' }], true), 'bad.a')
			])
		).rejects.toThrow('index offset');
		await expect(
			validate([
				await input(
					archive([
						{ path: 'a.o', bytes: a, symbol: 'a' },
						{ path: 'hidden.o', bytes: encoder.encode('not wasm'), symbol: 'hidden' }
					]),
					'bad.a'
				)
			])
		).rejects.toThrow('Archive member hidden.o');
		await expect(
			validate([await input(encoder.encode('!<thin>\n'), 'thin.a')])
		).rejects.toThrow('regular GNU ar');
		await expect(
			validate([await input(value.bytes.subarray(0, -1), 'truncated.a')])
		).rejects.toThrow();
	});

	it('bounds input count, bytes, paths and format without mounting caller paths', async () => {
		const value = await input();
		for (const path of ['../helper.o', '/helper.o', 'a//b.o', 'helper.a', 'x\u0000.o'])
			expect(() => snapshotWasiGccLinkInputs([{ ...value, path }])).toThrow();
		expect(() => snapshotWasiGccLinkInputs([value, value])).toThrow('Duplicate');
		expect(() => snapshotWasiGccLinkInputs(Array(129).fill(value))).toThrow('128');
		expect(() =>
			snapshotWasiGccLinkInputs([{ ...value, bytes: new Uint8Array(64 * 1024 * 1024 + 1) }])
		).toThrow('64 MiB');
		expect(() =>
			snapshotWasiGccLinkInputs([
				{ ...value, arbitraryFlags: ['--allow-undefined'] } as never
			])
		).toThrow('record');
	});
});
