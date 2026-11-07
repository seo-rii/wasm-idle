import { describe, expect, it } from 'vitest';
import { parseWasiGccManifest } from '../src/manifest.js';
import { wasiGccCompilePlan } from '../src/wasi-plan.js';
import { compileGccWasm, inspectGccWasm, supportsGccWasmAtomics } from '../src/wasm-output.js';
import { runGccWasiArtifact } from '../src/wasi-run.js';
import {
	atomicLibrary,
	atomicManifest,
	qualifiedAtomicManifest,
	atomicObject,
	atomicOperation,
	section,
	sharedArtifact,
	sharedFixture,
	sharedProfile,
	guardedInitializer
} from './atomic-fixtures.js';

describe('explicit atomic profile and provider', () => {
	it('keeps old manifests/default command paths and requires exactly the pinned provider', () => {
		const raw = atomicManifest();
		const legacy = {
			...raw,
			runtimeLibraries: raw.runtimeLibraries.filter((path) => path !== atomicLibrary),
			capabilities: { ...raw.capabilities, atomics: undefined, sharedMemory: undefined }
		};
		const old = parseWasiGccManifest(legacy);
		expect(old.capabilities.atomics).toBe(false);
		expect(old.capabilities.sharedMemory).toBe(false);
		expect(
			wasiGccCompilePlan({ code: 'int main() { return 0; }' }, old).stages.flatMap(
				(stage) => stage.argv
			)
		).not.toContain('-mno-atomics');
		for (const libraries of [
			[],
			[atomicLibrary, atomicLibrary],
			['/sysroot/lib/other/libatomic.a']
		])
			expect(() => parseWasiGccManifest({ ...raw, runtimeLibraries: libraries })).toThrow(
				/libatomic/
			);
		expect(() =>
			parseWasiGccManifest({
				...raw,
				capabilities: { ...raw.capabilities, atomics: false, sharedMemory: false }
			})
		).toThrow(/libatomic/);
		expect(() =>
			parseWasiGccManifest({ ...raw, capabilities: { ...raw.capabilities, atomics: false } })
		).toThrow(/requires the atomics/);
	});
	it('only selects the native atomic option and runtime library on opt-in', () => {
		const manifest = qualifiedAtomicManifest();
		const ordinary = wasiGccCompilePlan({ code: 'int main() { return 0; }' }, manifest);
		expect(ordinary.stages[0].argv).toContain('-mno-atomics');
		expect(ordinary.stages.at(-1)!.argv).not.toContain(atomicLibrary);
		const atomic = wasiGccCompilePlan(
			{ code: 'int main() { return 0; }', atomics: true },
			manifest
		);
		expect(atomic.stages[0].argv).toContain('-matomics');
		expect(atomic.stages[1].argv).toContain('--enable-threads');
		expect(atomic.stages.at(-1)!.argv.filter((value) => value === atomicLibrary)).toHaveLength(
			1
		);
		expect(() =>
			wasiGccCompilePlan(
				{ code: '', atomics: true },
				{ ...manifest, qualification: { status: 'unverified' } }
			)
		).toThrow(/qualified/);
		expect(() => wasiGccCompilePlan({ code: '', atomics: 1 as never }, manifest)).toThrow(
			/Invalid GCC atomic/
		);
	});
	it.each(['c', 'cpp'] as const)(
		'links freestanding %s with explicit fixed memory and no command CRT',
		(language) => {
			const helper = language === 'c' ? 'helper.c' : 'helper.cpp';
			const plan = wasiGccCompilePlan(
				{
					code: 'int entry(int x) { return x; }',
					language,
					atomics: true,
					sharedMemory: sharedProfile,
					sources: [helper],
					files: [{ path: helper, contents: 'unsigned helper() { return 1; }' }]
				},
				qualifiedAtomicManifest()
			);
			const compilers = plan.stages.filter(
				(stage) => stage.tool === 'cc1' || stage.tool === 'cc1plus'
			);
			expect(compilers).toHaveLength(2);
			for (const stage of compilers) {
				expect(stage.argv).toContain('-ffreestanding');
				expect(stage.argv).toContain('-matomics');
				expect(stage.argv).not.toContain('-D__GCC_WASI_SINGLE_THREAD__=1');
				expect(stage.argv).not.toContain('-fno-threadsafe-statics');
			}
			const ld = plan.stages.at(-1)!.argv;
			for (const flag of [
				'--no-entry',
				'--shared-memory',
				'--import-memory',
				'--initial-memory=65536',
				'--max-memory=65536',
				'--export=entry',
				'--export=__wasm_call_ctors',
				'--export=__tls_size',
				atomicLibrary,
				'-lc'
			])
				expect(ld).toContain(flag);
			expect(ld).not.toContain('/sysroot/lib/wasm32-wasi/crt1-command.o');
			expect(ld).not.toContain('-lstdc++');
		}
	);
	it('rejects shared/default, unequal limits, reserved entries, coverage and object output combinations', () => {
		const manifest = qualifiedAtomicManifest();
		for (const request of [
			{ sharedMemory: sharedProfile },
			{ atomics: true, sharedMemory: { ...sharedProfile, maximumPages: 2 } },
			{ atomics: true, sharedMemory: { ...sharedProfile, entry: '_start' } },
			{ atomics: true, sharedMemory: sharedProfile, emit: 'object' as const },
			{ atomics: true, sharedMemory: sharedProfile, coverage: true }
		])
			expect(() => wasiGccCompilePlan({ code: '', ...request }, manifest)).toThrow();
	});
});

describe('actual atomic instruction decoding', () => {
	it('probes the actual engine and rejects atomic bytes without opt-in', async () => {
		expect(supportsGccWasmAtomics()).toBe(true);
		await expect(inspectGccWasm(atomicObject(atomicOperation(0x1e)), 'object')).rejects.toThrow(
			/explicit opt-in/
		);
	});
	it.each([0, 1, 2, 3, ...Array.from({ length: 63 }, (_, index) => 0x10 + index)])(
		'validates real opcode 0xfe:%i and its complete immediate',
		async (opcode) => {
			const result = await inspectGccWasm(atomicObject(atomicOperation(opcode)), 'object', {
				atomics: true
			});
			expect(result.features.atomics).toBe(true);
		}
	);
	it('rejects reserved opcodes, incorrect natural alignments and fence reserved bytes', async () => {
		for (const instructions of [
			[0xfe, 4],
			atomicOperation(0x1e, 1),
			atomicOperation(0x1e, 0x42),
			atomicOperation(3, 1)
		])
			await expect(
				inspectGccWasm(atomicObject(instructions), 'object', { atomics: true })
			).rejects.toThrow(/opcode|alignment|reserved/);
	});
	it('does not mistake data bytes for atomic instructions', async () => {
		const data = section(11, [1, 0, 0x41, 0, 0x0b, 4, 0xfe, 0x1e, 2, 0]);
		const result = await inspectGccWasm(atomicObject([], data), 'object');
		expect(result.features.atomics).toBe(false);
	});
});

describe('shared executable ABI inspection', () => {
	it('rejects the real two-instantiation counterexample that resets shared state unconditionally', async () => {
		const bytes = Uint8Array.from(
			Buffer.from(
				'AGFzbQEAAAABCAJgAABgAAF/AhABA2VudgZtZW1vcnkCAwEBAwQDAAEABhgEfwFBgAgLfwBBgAgLfwBBgAgLfwBBAAsHYAcGbWVtb3J5AgARX193YXNtX2NhbGxfY3RvcnMAAAVlbnRyeQABD19fc3RhY2tfcG9pbnRlcgMACl9fZGF0YV9lbmQDAQtfX2hlYXBfYmFzZQMCCl9fdGxzX3NpemUDAwgBAgoWAwIACwQAQQALDABBgARBAEEE/AsACw==',
				'base64'
			)
		);
		expect(WebAssembly.validate(bytes)).toBe(true);
		const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
		const module = await WebAssembly.compile(bytes);
		await WebAssembly.instantiate(module, { env: { memory } });
		new Uint8Array(memory.buffer)[512] = 99;
		await WebAssembly.instantiate(module, { env: { memory } });
		expect(new Uint8Array(memory.buffer)[512]).toBe(0);
		await expect(
			compileGccWasm(bytes, 'executable', { atomics: true, sharedMemory: sharedProfile })
		).rejects.toThrow(/guarded one-time/);
	});
	it.each([false, true])(
		'accepts guarded initialization with fill=%s and preserves state across instances',
		async (fill) => {
			const bytes = sharedFixture({
				initializer: guardedInitializer({ fill }),
				data: fill ? undefined : [11, 22, 33, 44],
				dataEnd: 1032,
				heapBase: 1040
			});
			const { module } = await compileGccWasm(bytes, 'executable', {
				atomics: true,
				sharedMemory: sharedProfile
			});
			const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
			await WebAssembly.instantiate(module, { env: { memory } });
			const view = new Uint8Array(memory.buffer);
			expect(view[1024]).toBe(fill ? 0 : 11);
			expect(new DataView(memory.buffer).getUint32(1028, true)).toBe(2);
			view[1024] = 77;
			await WebAssembly.instantiate(module, { env: { memory } });
			expect(view[1024]).toBe(77);
		}
	);
	it.each([
		{ guard: 512 },
		{ guard: 1025 },
		{ guard: 1032 },
		{ destination: 512 },
		{ destination: 1028 },
		{ length: 3 },
		{ length: 16 },
		{ source: 1 },
		{ publishGuard: 1024 },
		{ waitGuard: 1024 },
		{ desiredState: 2 },
		{ publishedState: 0 },
		{ waitState: 2 },
		{ waitTimeout: 0 },
		{ branchTable: [0, 0, 2] },
		{ drop: false },
		{ extraOp: true }
	])('rejects engine-valid unsafe initializer structure or ranges %j', async (options) => {
		const bytes = sharedFixture({
			initializer: guardedInitializer(options),
			data: [11, 22, 33, 44],
			dataEnd: 1032,
			heapBase: 1040
		});
		expect(WebAssembly.validate(bytes)).toBe(true);
		await expect(
			compileGccWasm(bytes, 'executable', { atomics: true, sharedMemory: sharedProfile })
		).rejects.toThrow(/guarded one-time/);
	});
	it('requires explicit shared mode and derives bounds/signature from actual bytes', async () => {
		await expect(
			inspectGccWasm(sharedFixture(), 'executable', { atomics: true })
		).rejects.toThrow(/shared memory/);
		const inspected = await inspectGccWasm(sharedFixture(), 'executable', {
			atomics: true,
			sharedMemory: sharedProfile
		});
		expect(inspected.memory).toEqual({ initialPages: 1, maximumPages: 1, shared: true });
		expect(inspected.sharedEntry).toEqual({
			name: 'entry',
			parameterCount: 1,
			heapBase: 1024,
			dataEnd: 1024
		});
		await expect(
			runGccWasiArtifact(sharedArtifact(), {}, qualifiedAtomicManifest())
		).rejects.toThrow(/runGccSharedArtifact/);
	});
	it.each([
		[{ tls: 8 }, /TLS/],
		[{ constructors: true }, /constructors/],
		[{ activeData: true }, /passive/],
		[{ passiveData: true }, /one-time memory initializer/],
		[{ importModule: 'wasi_snapshot_preview1' }, /env.memory/],
		[{ extraImport: true }, /env.memory/],
		[{ memoryGrow: true }, /memory growth/],
		[{ result64: true }, /i32 result/]
	] as const)('rejects an unsupported binary contract %j', async (options, expected) => {
		await expect(
			inspectGccWasm(sharedFixture(options), 'executable', {
				atomics: true,
				sharedMemory: sharedProfile
			})
		).rejects.toThrow(expected);
	});
});
