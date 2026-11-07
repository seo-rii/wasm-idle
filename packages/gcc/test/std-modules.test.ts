import { describe, expect, it } from 'vitest';
import { gccCompileInputs } from '../src/plan.js';
import { parseWasiGccManifest } from '../src/manifest.js';
import { gccStdModulesProfile, validateGccStdModulesProfile } from '../src/std-modules.js';
import { wasiGccCompilePlan } from '../src/wasi-plan.js';
import type { WasiGccCompileRequest } from '../src/types.js';
import { stdModulesManifestFixture } from './std-modules-fixtures.js';

const requestKeys = [
	'stdModules',
	'exceptions',
	'rtti',
	'simd',
	'relaxedSimd',
	'atomics',
	'tls',
	'coverage',
	'debug',
	'sharedMemory',
	'threads',
	'dynamicLinking',
	'linkInputs'
];

function admits(request: WasiGccCompileRequest) {
	return validateGccStdModulesProfile(request, gccCompileInputs(request, requestKeys));
}

// These are option-admission tests. They do not compile modules or qualify a bundle.
describe('GCC std module request profile', () => {
	it('preserves the ordinary request defaults and requires explicit opt-in', () => {
		for (const stdModules of [undefined, false]) {
			const request = { code: '#include <vector>', stdModules };
			expect(admits(request)).toBe(false);
			expect(gccCompileInputs(request, requestKeys)).toMatchObject({
				standard: 'gnu++20',
				optimization: '2',
				emit: 'executable'
			});
		}
	});

	it('admits only the explicit gnu++23 source profile with O2 defaults', () => {
		expect(admits({ code: 'import std;', standard: 'gnu++23', stdModules: true })).toBe(true);
		expect(
			admits({
				code: 'import std.compat;',
				standard: 'gnu++23',
				optimization: '2',
				stdModules: true,
				files: [{ path: 'header.cpp', contents: '#include <string>' }],
				sources: ['header.cpp'],
				linkInputs: [],
				defines: [],
				preprocessed: false,
				exceptions: false,
				rtti: false
			})
		).toBe(true);
	});

	it.each([null, 0, 'true', {}, []])('rejects a nonboolean opt-in: %j', (stdModules) => {
		expect(() => admits({ code: '', stdModules } as never)).toThrow('Invalid GCC stdModules');
	});

	it.each([
		[{ language: 'c', standard: 'gnu17' }, 'C++ source'],
		[{ standard: undefined }, 'explicit standard=gnu++23'],
		[{ standard: 'gnu++20' }, 'explicit standard=gnu++23'],
		[{ standard: 'c++23' }, 'explicit standard=gnu++23'],
		[{ standard: 'gnu++26' }, 'Unsupported GCC language standard'],
		[{ optimization: '0' }, 'optimization=2'],
		[{ optimization: '1' }, 'optimization=2'],
		[{ optimization: '3' }, 'optimization=2'],
		[{ optimization: 's' }, 'optimization=2'],
		[{ emit: 'assembly' }, 'executable output'],
		[{ emit: 'object' }, 'executable output'],
		[{ preprocessed: true }, 'ordinary source'],
		[{ defines: ['ONLINE_JUDGE=1'] }, 'caller macro'],
		[{ defines: ['_GLIBCXX_USE_CXX11_ABI=0'] }, 'caller macro'],
		[{ defines: ['_GLIBCXX_DEBUG'] }, 'caller macro'],
		[{ linkInputs: [{}] }, 'source-only'],
		[{ sharedMemory: {} }, 'private memory']
	])('rejects an unqualified module profile: %j', (update, diagnostic) => {
		expect(() =>
			admits({
				code: 'import std;',
				standard: 'gnu++23',
				stdModules: true,
				...update
			} as never)
		).toThrow(diagnostic as string);
	});

	it.each([
		'exceptions',
		'rtti',
		'simd',
		'relaxedSimd',
		'atomics',
		'tls',
		'coverage',
		'debug',
		'threads',
		'dynamicLinking'
	])('rejects the %s feature before optional assets can be loaded', (feature) => {
		expect(() =>
			admits({ code: '', standard: 'gnu++23', stdModules: true, [feature]: true } as never)
		).toThrow(`with ${feature} are not qualified`);
	});

	it('retains the common unknown-option boundary', () => {
		expect(() =>
			admits({ code: '', standard: 'gnu++23', stdModules: true, flags: ['-frtti'] } as never)
		).toThrow('Unsupported GCC option');
	});
});

function replace(value: unknown, path: string, replacement: unknown) {
	const keys = path.split('.');
	let record = value as Record<string, unknown>;
	for (const key of keys.slice(0, -1)) record = record[key] as Record<string, unknown>;
	record[keys.at(-1)!] = replacement;
}

describe('GCC std module descriptor and plan admission (synthetic metadata)', () => {
	it('retains legacy shapes and requires both capability and descriptor', () => {
		for (const stdModules of [undefined, false]) {
			const value = stdModulesManifestFixture();
			replace(value, 'capabilities.stdModules', stdModules);
			replace(value, 'stdModules', undefined);
			const parsed = parseWasiGccManifest(value);
			expect(parsed).not.toHaveProperty('stdModules');
			if (stdModules === undefined)
				expect(parsed.capabilities).not.toHaveProperty('stdModules');
			else expect(parsed.capabilities.stdModules).toBe(false);
		}
		const value = stdModulesManifestFixture();
		replace(value, 'stdModules', undefined);
		expect(() => parseWasiGccManifest(value)).toThrow('requires its separate descriptor');
	});

	it('snapshots and freezes every identity and ordered dependency', () => {
		const value = stdModulesManifestFixture(),
			parsed = parseWasiGccManifest(value);
		value.stdModules.modules[0].bmi.sha256 = 'f'.repeat(64);
		value.stdModules.bindings.gccSource.patches.reverse();
		expect(parsed.stdModules!.modules[0].bmi.sha256).not.toBe('f'.repeat(64));
		expect(parsed.stdModules!.bindings.gccSource.patches[0].path).toBe('patches/first.patch');
		const frozen = (value: unknown) => {
			if (!value || typeof value !== 'object') return;
			expect(Object.isFrozen(value)).toBe(true);
			for (const child of Object.values(value)) frozen(child);
		};
		frozen(parsed.stdModules);
	});

	it.each([
		['compilerHost', 'x86_64-pc-linux-gnu'],
		['compilerHost', 'wasm32-emscripten'],
		['target', 'x86_64-linux-gnu'],
		['abi', 'wasm32-wasi-preview2'],
		['schemaVersion', 2],
		['bindings.cc1plusJs.bytes', 9],
		['bindings.cc1plusWasm.sha256', 'b'.repeat(64)],
		['bindings.sysroot.sha256', 'b'.repeat(64)],
		['bindings.gccSource.gccCommit', 'b'.repeat(40)],
		['bindings.gccSource.sourceDiffSha256', 'c'.repeat(64)],
		['bindings.gccSource.patches.0.sha256', 'c'.repeat(64)],
		['bindings.gccSource.patches.0.purpose', 'different source identity'],
		['modules.0.bmi.path', '../std.gcm'],
		['modules.1.bmi.path', 'https://example.test/std.compat.gcm'],
		['modules.0.bmi.bytes', 0],
		['modules.0.bmi.sha256', 'invalid'],
		['modules.1.requires', []],
		['modules.0.name', 'third.party'],
		['initializerArchive.members.0.name', 'dummy.o'],
		['initializerArchive.asset.path', 'libstdc++modules.a'],
		['signalArchive.path', 'std-modules/wrong.a'],
		['interfaces.std.bytes', 0],
		['interfaces.stdCompat.sha256', 'INVALID'],
		['qualification.status', 'trusted'],
		['rawFlags', ['-frtti']]
	])('rejects the mismatched or unsupported %s field', (path, replacement) => {
		const value = stdModulesManifestFixture();
		replace(value.stdModules, path as string, replacement);
		expect(() => parseWasiGccManifest(value)).toThrow();
	});

	it.each(Object.keys(gccStdModulesProfile))('rejects a changed %s profile field', (key) => {
		const value = stdModulesManifestFixture();
		replace(value.stdModules.profile, key, null);
		expect(() => parseWasiGccManifest(value)).toThrow('Unsupported GCC std modules profile');
	});

	it('binds patch order and parent provenance, and rejects a nonboolean capability', () => {
		const value = stdModulesManifestFixture();
		value.stdModules.bindings.gccSource.patches.reverse();
		expect(() => parseWasiGccManifest(value)).toThrow('source identity mismatch');
		for (const replacement of ['true', 1, null]) {
			const value = stdModulesManifestFixture();
			replace(value, 'capabilities.stdModules', replacement);
			expect(() => parseWasiGccManifest(value)).toThrow('capability: stdModules');
		}
	});

	it('keeps outer and module qualification independent', () => {
		for (const key of ['qualification', 'stdModules.qualification']) {
			const value = stdModulesManifestFixture();
			replace(value, `${key}.status`, 'unverified');
			const parsed = parseWasiGccManifest(value);
			expect(() =>
				wasiGccCompilePlan(
					{ code: 'import std;', stdModules: true, standard: 'gnu++23' },
					parsed
				)
			).toThrow('separately qualified');
			expect(() => wasiGccCompilePlan({ code: '#include <vector>' }, parsed)).not.toThrow();
		}
	});

	it('preserves the ordinary plan and places initializers after every user object', () => {
		const value = stdModulesManifestFixture(),
			parsed = parseWasiGccManifest(value);
		const ordinary = wasiGccCompilePlan({ code: '#include <vector>' }, parsed);
		expect(
			wasiGccCompilePlan({ code: '#include <vector>', stdModules: false }, parsed)
		).toEqual(ordinary);
		replace(value, 'stdModules', undefined);
		replace(value, 'capabilities.stdModules', undefined);
		expect(
			wasiGccCompilePlan({ code: '#include <vector>' }, parseWasiGccManifest(value))
		).toEqual(ordinary);
		const plan = wasiGccCompilePlan(
			{
				code: 'import std;',
				stdModules: true,
				standard: 'gnu++23',
				files: [{ path: 'part.cpp', contents: 'import std.compat;' }],
				sources: ['part.cpp']
			},
			parsed
		);
		for (const stage of plan.stages.filter((stage) => stage.tool === 'cc1plus')) {
			expect(stage.argv).toEqual(
				expect.arrayContaining([
					'-O2',
					'-std=gnu++23',
					'-fmodules',
					'-fmodule-mapper=/gcc-std-modules/mapper.txt',
					'-mexception-handling',
					'-D_WASI_EMULATED_SIGNAL=1',
					'-fno-exceptions',
					'-fno-rtti'
				])
			);
			expect(stage.argv).not.toContain('-fexceptions');
		}
		const link = plan.stages.at(-1)!.argv;
		const positions = [
			'/workspace/program.o',
			'/workspace/program.1.o',
			'/gcc-std-modules/libstdc++modules.a',
			'/gcc-std-modules/libwasi-emulated-signal.a',
			'-lstdc++',
			'-lc'
		].map((path) => link.indexOf(path));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});
});
