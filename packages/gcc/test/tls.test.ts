import { describe, expect, it } from 'vitest';
import { compileGccWasm, inspectGccWasm } from '../src/wasm-output.js';
import { gccTlsRuntimePaths, parseWasiGccManifest } from '../src/manifest.js';
import { wasiGccCompilePlan } from '../src/wasi-plan.js';
import {
	gccLinkDigest,
	snapshotWasiGccLinkInputs,
	validateWasiGccLinkInputs
} from '../src/wasm-link-inputs.js';
import { atomicManifest, atomicObject, atomicOperation, sharedProfile } from './atomic-fixtures.js';
import { tlsObject, tlsSharedFixture, tlsSharedProfile } from './tls-fixtures.js';

describe('exact TLS object metadata', () => {
	it('requires explicit TLS opt-in independently of atomic instructions', async () => {
		const bytes = tlsObject();
		expect(WebAssembly.validate(bytes)).toBe(true);
		await expect(inspectGccWasm(bytes, 'object')).rejects.toThrow(/TLS.*explicit opt-in/);
		await expect(inspectGccWasm(bytes, 'object', { atomics: true })).rejects.toThrow(
			/TLS.*explicit opt-in/
		);
		const inspection = await inspectGccWasm(bytes, 'object', { tls: true });
		expect(inspection.features.tls).toBe(true);
		expect(inspection.features.atomics).toBe(false);
	});
	it('does not mistake ordinary data bytes for TLS flags or relocations', async () => {
		const bytes = tlsObject({
			symbolFlags: 0,
			segmentFlags: 0,
			relocation: 4,
			data: [0x80, 2, 21, 2]
		});
		const result = await inspectGccWasm(bytes, 'object');
		expect(result.features.tls).toBeUndefined();
	});
	it.each([
		{ symbolFlags: 0 },
		{ segmentFlags: 0 },
		{ relocationSymbol: 1 },
		{ relocationOffset: 3 },
		{ relocationOffset: 5 },
		{ relocation: 25 },
		{ features: ['atomics'] },
		{ features: ['bulk-memory'] }
	])('rejects inconsistent TLS metadata %j', async (options) => {
		await expect(inspectGccWasm(tlsObject(options), 'object', { tls: true })).rejects.toThrow(
			/TLS/
		);
	});
	it('validates option types before inspecting an object', async () => {
		await expect(inspectGccWasm(tlsObject(), 'object', { tls: 1 as never })).rejects.toThrow(
			/inspection options/
		);
	});
	it('requires a real i32.const relocation site, not matching bytes inside f64.const', async () => {
		const bytes = tlsObject({
			body: [0, 0x44, 0x41, 0x80, 0x80, 0x80, 0x80, 0, 0, 0, 0x1a, 0x0b],
			relocationOffset: 5
		});
		expect(WebAssembly.validate(bytes)).toBe(true);
		await expect(inspectGccWasm(bytes, 'object', { tls: true })).rejects.toThrow(/TLS/);
	});
});

describe('exact TLS initialization and reserved-memory ABI', () => {
	const options = { atomics: true, tls: true, sharedMemory: tlsSharedProfile };
	it('preserves the TLS template, shared initialized state and distinct per-instance bases', async () => {
		const { module, inspection } = await compileGccWasm(
			tlsSharedFixture(),
			'executable',
			options
		);
		expect(inspection.sharedEntry?.tls).toEqual({
			size: 4,
			alignment: 16,
			reservedLow: 1040,
			reservedHigh: 33808
		});
		const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
		const first = await WebAssembly.instantiate(module, { env: { memory } });
		const view = new DataView(memory.buffer);
		(first.exports.__wasm_init_tls as Function)(2048);
		view.setUint32(2048, 71, true);
		view.setUint32(1028, 81, true);
		const second = await WebAssembly.instantiate(module, { env: { memory } });
		(second.exports.__wasm_init_tls as Function)(4096);
		expect(view.getUint32(4096, true)).toBe(37);
		expect(view.getUint32(2048, true)).toBe(71);
		expect(view.getUint32(1028, true)).toBe(81);
		expect((first.exports.__tls_base as WebAssembly.Global).value).toBe(2048);
		expect((second.exports.__tls_base as WebAssembly.Global).value).toBe(4096);
	});
	it.each([
		{ alignment: 3 },
		{ size: 32769 },
		{ base: 16 },
		{ reservedLow: 1056 },
		{ reservedHigh: 33824 },
		{ initGlobal: 0 },
		{ initSegment: 1 },
		{ startupGlobal: 0 },
		{ dropTls: true },
		{ dropOrdinary: false },
		{ extraInitializer: true },
		{ cleanupParameter: true },
		{ yield: true, importName: 'fd_write' },
		{ yield: true, yield64: true }
	])('rejects invalid TLS state or ABI %j', async (variant) => {
		await expect(
			compileGccWasm(tlsSharedFixture(variant), 'executable', options)
		).rejects.toThrow();
	});
	it.each([0, 1])('keeps actual memory.grow(%i) bounded by the fixed maximum', async (pages) => {
		const { module } = await compileGccWasm(
			tlsSharedFixture({ grow: pages }),
			'executable',
			options
		);
		const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
		const { exports } = await WebAssembly.instantiate(module, { env: { memory } });
		(exports.__wasm_init_tls as Function)(2048);
		expect((exports.entry as Function)(0)).toBe(pages === 0 ? 1 : -1);
		expect(memory.buffer.byteLength).toBe(65536);
	});
	it('accepts only the exact optional TLS sched_yield host signature', async () => {
		const result = await inspectGccWasm(
			tlsSharedFixture({ yield: true }),
			'executable',
			options
		);
		expect(result.imports).toEqual([
			{ module: 'env', name: 'memory', kind: 'memory' },
			{ module: 'wasi_snapshot_preview1', name: 'sched_yield', kind: 'function' }
		]);
		await expect(
			inspectGccWasm(tlsSharedFixture(), 'executable', {
				atomics: true,
				sharedMemory: tlsSharedProfile
			})
		).rejects.toThrow(/reservedBytes/);
	});
});

describe('explicit TLS profile boundaries', () => {
	const capable = () => {
		const raw = atomicManifest();
		return parseWasiGccManifest({ ...raw, capabilities: { ...raw.capabilities, tls: true } });
	};
	it('preserves legacy shapes and command lines for absent or false TLS requests', () => {
		const legacy = parseWasiGccManifest(atomicManifest());
		expect(Object.hasOwn(legacy.capabilities, 'tls')).toBe(false);
		const request = { code: 'int value;', language: 'c' as const, emit: 'object' as const };
		expect(wasiGccCompilePlan({ ...request, tls: false }, legacy)).toEqual(
			wasiGccCompilePlan(request, legacy)
		);
		expect(wasiGccCompilePlan(request, legacy).stages[0].argv).not.toContain('-mno-tls');
		expect(wasiGccCompilePlan(request, capable()).stages[0].argv).toContain('-mno-tls');
		expect(() => wasiGccCompilePlan({ ...request, tls: true }, legacy)).toThrow(
			/TLS.*qualified/
		);
	});
	it.each(['c', 'cpp'] as const)(
		'keeps %s TLS and atomic lowering independent and preserves the qualification gate',
		(language) => {
			const manifest = capable();
			const request = { code: '', language, emit: 'object' as const, tls: true };
			const plan = wasiGccCompilePlan(request, manifest);
			expect(plan.stages[0].argv).toContain('-mtls');
			expect(plan.stages[0].argv).toContain('-mno-atomics');
			expect(plan.stages[0].argv).not.toContain('-matomics');
			expect(plan.stages[1].argv).toContain('--enable-threads');
			expect(plan.tls).toBe(true);
			expect(() =>
				wasiGccCompilePlan(request, {
					...manifest,
					qualification: { status: 'unverified' }
				})
			).toThrow(/TLS.*qualified/);
			expect(() => wasiGccCompilePlan({ ...request, tls: 1 as never }, manifest)).toThrow(
				/TLS option/
			);
		}
	);
	it.each(['c', 'cpp'] as const)(
		'selects the real TLS errno declaration before legacy %s headers only with opt-in',
		(language) => {
			const code = '#include <errno.h>\nint *location(void) { return &errno; }';
			const request = { code, language, emit: 'object' as const };
			const include = '/sysroot/include/wasm32-wasi-tls';
			for (const shared of [false, true]) {
				const plan = wasiGccCompilePlan(
					{
						...request,
						tls: true,
						...(shared
							? {
									atomics: true,
									sharedMemory: tlsSharedProfile,
									emit: 'executable' as const
								}
							: {})
					},
					capable()
				);
				const argv = plan.stages[0].argv;
				expect(argv[argv.indexOf('-isystem') + 1]).toBe(include);
				expect(argv.indexOf(include)).toBeLessThan(
					argv.indexOf('/sysroot/include/wasm32-wasi')
				);
			}
			const defaults = wasiGccCompilePlan(request, capable());
			expect(defaults.stages[0].argv).not.toContain(include);
			expect(wasiGccCompilePlan({ ...request, tls: false }, capable())).toEqual(defaults);
		}
	);

	it('registers shared C++ TLS destructors through the qualified GNU ABI', () => {
		const code =
			'struct Value { ~Value(); }; thread_local Value value; extern "C" int entry() { return (int)&value; }';
		const plan = wasiGccCompilePlan(
			{
				code,
				language: 'cpp',
				standard: 'c++17',
				tls: true,
				atomics: true,
				sharedMemory: tlsSharedProfile
			},
			capable()
		);
		expect(plan.stages[0].argv).toContain('-fuse-cxa-atexit');
		expect(plan.stages[0].argv).not.toContain('-fno-threadsafe-statics');
	});
	it('exposes GNU allocation and conversion declarations for shared TLS without compiler builtins', () => {
		const code =
			'#include <cstdlib>\nextern "C" int entry() { void *p = std::malloc(32); std::free(p); return std::strtol("17", nullptr, 10); }';
		const plan = wasiGccCompilePlan(
			{
				code,
				language: 'cpp',
				standard: 'c++17',
				tls: true,
				atomics: true,
				sharedMemory: tlsSharedProfile
			},
			capable()
		);
		expect(plan.stages[0].argv).not.toContain('-ffreestanding');
		expect(plan.stages[0].argv).toContain('-fno-builtin');
		expect(plan.stages[0].argv).not.toContain('-D__GCC_WASI_SINGLE_THREAD__=1');
	});

	it('selects distinct qualified runtimes and shutdown contracts for ordinary and shared TLS', () => {
		const manifest = capable();
		const ordinary = wasiGccCompilePlan(
			{ code: '', tls: true, language: 'cpp' },
			manifest
		).stages.at(-1)!.argv;
		for (const flag of [
			'--wrap=exit',
			'--wrap=__wasm_call_dtors',
			'--extra-features=atomics,bulk-memory,mutable-globals',
			gccTlsRuntimePaths.ordinary
		])
			expect(ordinary).toContain(flag);
		expect(ordinary.indexOf(gccTlsRuntimePaths.ordinary)).toBeLessThan(
			ordinary.indexOf('-lstdc++')
		);
		expect(ordinary).not.toContain(gccTlsRuntimePaths.shared);
		for (const file of [
			gccTlsRuntimePaths.ordinaryLibm,
			gccTlsRuntimePaths.ordinaryLibc,
			gccTlsRuntimePaths.ordinaryBuiltins
		])
			expect(ordinary).toContain(file);
		for (const file of [
			gccTlsRuntimePaths.libm,
			gccTlsRuntimePaths.libc,
			gccTlsRuntimePaths.builtins
		])
			expect(ordinary).not.toContain(file);
		for (const file of ['-lc', '-lm', '/sysroot/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a'])
			expect(ordinary).not.toContain(file);
		expect(() =>
			wasiGccCompilePlan(
				{ code: '', tls: true, atomics: true, sharedMemory: sharedProfile },
				manifest
			)
		).toThrow(/reservedBytes/);
		const profile = { ...sharedProfile, reservedBytes: 32768 };
		expect(() =>
			wasiGccCompilePlan({ code: '', tls: true, sharedMemory: profile }, manifest)
		).toThrow(/atomics: true/);
		const plan = wasiGccCompilePlan(
			{ code: '', tls: true, atomics: true, sharedMemory: profile },
			manifest
		);
		for (const name of ['__tls_base', '__tls_align', '__wasm_init_tls'])
			expect(plan.stages.at(-1)!.argv).toContain('--export=' + name);
		const shared = plan.stages.at(-1)!.argv;
		for (const file of [
			gccTlsRuntimePaths.shared,
			gccTlsRuntimePaths.libc,
			gccTlsRuntimePaths.libm,
			gccTlsRuntimePaths.builtins
		])
			expect(shared).toContain(file);
		for (const file of [
			gccTlsRuntimePaths.ordinary,
			gccTlsRuntimePaths.ordinaryLibc,
			gccTlsRuntimePaths.ordinaryLibm,
			gccTlsRuntimePaths.ordinaryBuiltins,
			'-lc',
			'--wrap=exit',
			'--wrap=__wasm_call_dtors'
		])
			expect(shared).not.toContain(file);
		expect(shared.indexOf(gccTlsRuntimePaths.shared)).toBeLessThan(
			shared.indexOf(gccTlsRuntimePaths.libc)
		);
		expect(() => wasiGccCompilePlan({ code: '', tls: true, debug: true }, manifest)).toThrow(
			/TLS.*DWARF/
		);
		const longDouble = {
			...manifest,
			capabilities: { ...manifest.capabilities, longDouble: true }
		};
		const tlsFormat = wasiGccCompilePlan({ code: '', tls: true }, longDouble).stages.at(
			-1
		)!.argv;
		expect(tlsFormat).toContain(gccTlsRuntimePaths.ordinaryLongDouble);
		expect(tlsFormat).not.toContain('-lc-printscan-long-double');
		expect(ordinary).not.toContain(gccTlsRuntimePaths.ordinaryLongDouble);
		expect(wasiGccCompilePlan({ code: '' }, longDouble).stages.at(-1)!.argv).toContain(
			'-lc-printscan-long-double'
		);
	});
	it('prevents TLS providers from entering default runtime resolution', () => {
		const raw = atomicManifest();
		for (const file of [
			...Object.values(gccTlsRuntimePaths),
			'/sysroot/lib/other/libgcc-wasi-tls.a'
		])
			expect(() =>
				parseWasiGccManifest({ ...raw, runtimeLibraries: [...raw.runtimeLibraries, file] })
			).toThrow(/separate from default/);
		const defaults = wasiGccCompilePlan({ code: '' }, capable()).stages.at(-1)!.argv;
		for (const file of Object.values(gccTlsRuntimePaths)) expect(defaults).not.toContain(file);
		expect(defaults).not.toContain('--wrap=exit');
		expect(defaults).not.toContain('--wrap=__wasm_call_dtors');
	});
	it('binds TLS object receipts to request, capability, metadata and exact hashes', async () => {
		const manifest = capable(),
			bytes = tlsObject(),
			hash = 'a'.repeat(64);
		const input = {
			path: 'tls.o',
			format: 'wasm-object' as const,
			bytes,
			sha256: await gccLinkDigest(bytes),
			profile: {
				target: 'wasm32-wasi' as const,
				abi: 'wasm32-wasi-preview1' as const,
				simd: false,
				tls: true,
				compatibility: {
					kind: 'gcc-bundle' as const,
					manifestSha256: hash,
					sysrootSha256: manifest.assets.sysroot.sha256
				}
			}
		};
		const snapshot = snapshotWasiGccLinkInputs([input]);
		await expect(
			validateWasiGccLinkInputs(
				snapshot,
				manifest,
				hash,
				false,
				'c',
				false,
				false,
				false,
				true
			)
		).resolves.toHaveLength(1);
		await expect(
			validateWasiGccLinkInputs(snapshot, manifest, hash, false, 'c')
		).rejects.toThrow(/TLS profile differs/);
		const atomicBytes = atomicObject(atomicOperation(3));
		const atomicInput = snapshotWasiGccLinkInputs([
			{ ...input, bytes: atomicBytes, sha256: await gccLinkDigest(atomicBytes) }
		]);
		await expect(
			validateWasiGccLinkInputs(
				atomicInput,
				manifest,
				hash,
				false,
				'c',
				false,
				false,
				false,
				true
			)
		).rejects.toThrow('atomic instructions require explicit opt-in');
		await expect(
			validateWasiGccLinkInputs(
				snapshot,
				{ ...manifest, capabilities: { ...manifest.capabilities, tls: false } },
				hash,
				false,
				'c',
				false,
				false,
				false,
				true
			)
		).rejects.toThrow(/TLS.*qualified/);
		const hidden = snapshotWasiGccLinkInputs([
			{ ...input, profile: { ...input.profile, tls: false } }
		]);
		await expect(validateWasiGccLinkInputs(hidden, manifest, hash, false, 'c')).rejects.toThrow(
			/TLS.*explicit opt-in/
		);
		expect(() =>
			snapshotWasiGccLinkInputs([
				{
					...input,
					profile: {
						...input.profile,
						compatibility: {
							kind: 'clang-c-scalar-v1',
							compilerVersion: '22.1.0',
							compilerCommit: '4434dabb69916856b824f68a64b029c67175e532',
							sysrootSha256: hash
						}
					}
				}
			])
		).toThrow(/does not qualify TLS/);
	});
});
