import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createGccCompiler } from '../src/compiler.js';
import { gccAssetPaths, parseWasiGccManifest } from '../src/manifest.js';
import { wasiGccCompilePlan } from '../src/wasi-plan.js';

const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function fixture(timezoneDatabase?: unknown) {
	const revision = (family: string) => ({
		family,
		repository: `https://example.test/${family}`,
		version: family === 'gcc' ? '17.0.0' : '1.0.0',
		commit: 'a'.repeat(40)
	});
	return {
		schemaVersion: 2,
		kind: 'gcc-wasm32-wasi',
		host: 'wasm32-emscripten',
		target: 'wasm32-wasi',
		compiler: revision('gcc'),
		assembler: revision('wabt'),
		linker: { ...revision('lld'), host: 'wasm32-wasi' },
		sysroot: revision('wasi-libc'),
		abi: 'wasm32-wasi-preview1',
		linkMode: 'static',
		sysrootPath: '/sysroot',
		gccInstallation: '/sysroot/lib/gcc/wasm32-wasi/17.0.0',
		resourceDir: '/sysroot/lib/gcc/wasm32-wasi/17.0.0/include',
		runtimeLibraries: ['/sysroot/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a'],
		capabilities: {
			c: true,
			cpp: true,
			libc: true,
			libm: true,
			libstdcxx: true,
			staticInitialization: true,
			exceptions: false,
			rtti: true,
			threads: false,
			dynamicLinking: false,
			simd: false,
			...(timezoneDatabase === undefined ? {} : { timezoneDatabase })
		},
		assets: Object.fromEntries(
			Object.entries(gccAssetPaths)
				.filter(([name]) => name !== 'ldJs')
				.map(([name, path]) => [name, { path, bytes: 8, sha256: 'a'.repeat(64) }])
		),
		qualification: { status: 'unverified' }
	};
}

// Synthetic transport data checks admission only, never GNU timezone behavior.
function tar(name: string, bytes: Uint8Array) {
	const result = new Uint8Array(2048);
	result.set(encoder.encode(name));
	for (const offset of [100, 108, 116]) result.set(encoder.encode('0000000\0'), offset);
	result.set(encoder.encode('00000000000\0'), 136);
	result.set(encoder.encode(`${bytes.length.toString(8).padStart(11, '0')}\0`), 124);
	result[156] = 48;
	result.set(encoder.encode('ustar\0'), 257);
	result.set(bytes, 512);
	result.fill(32, 148, 156);
	const checksum = result.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
	result.set(encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
	return result;
}

describe('GNU timezone capability admission', () => {
	it('preserves older parsed shapes and explicit false without changing qualification', () => {
		expect(parseWasiGccManifest(fixture()).capabilities).not.toHaveProperty('timezoneDatabase');
		expect(parseWasiGccManifest(fixture(false)).capabilities.timezoneDatabase).toBe(false);
		for (const status of ['unverified', 'verified']) {
			const value = fixture(true);
			value.qualification.status = status;
			const parsed = parseWasiGccManifest(value);
			expect(parsed.capabilities.timezoneDatabase).toBe(true);
			expect(parsed.qualification.status).toBe(status);
		}
	});

	it.each([null, 'true', 1, {}, []])('rejects a non-boolean capability: %j', (value) => {
		expect(() => parseWasiGccManifest(fixture(value))).toThrow(/capability: timezoneDatabase/);
	});

	it.each(['cpp', 'libstdcxx', 'libc', 'staticInitialization'] as const)(
		'rejects timezone support without %s',
		(name) => {
			const value = fixture(true);
			value.capabilities[name] = false;
			expect(() => parseWasiGccManifest(value)).toThrow();
		}
	);

	it('adds no flags or link paths to ordinary or exception requests', () => {
		for (const exceptions of [false, true]) {
			const plans = [undefined, false, true].map((capability) => {
				const value = fixture(capability);
				value.capabilities.exceptions = exceptions;
				value.qualification.status = 'verified';
				return wasiGccCompilePlan(
					{ language: 'cpp', standard: 'c++20', code: 'int main() {}', exceptions },
					parseWasiGccManifest(value)
				);
			});
			expect(plans[1]).toEqual(plans[0]);
			expect(plans[2]).toEqual(plans[0]);
		}
	});

	it.each(['missing', 'empty'])('rejects a %s GNU archive before loading tools', async (kind) => {
		const value = fixture(true),
			files = new Map<string, Uint8Array>();
		for (const [name, asset] of Object.entries(value.assets)) {
			const bytes =
				name === 'sysroot'
					? tar(
							kind === 'missing' ? 'include/stdio.h' : 'lib/wasm32-wasi/libstdc++.a',
							new Uint8Array()
						)
					: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
			files.set(asset.path, bytes);
			asset.bytes = bytes.length;
			asset.sha256 = digest(bytes);
		}
		const manifest = encoder.encode(JSON.stringify(value));
		files.set('manifest.json', manifest);
		const compile = vi.spyOn(WebAssembly, 'compile');
		try {
			await expect(
				createGccCompiler({
					target: 'wasm32-wasi',
					manifestUrl: 'https://example.test/manifest.json',
					manifestSha256: digest(manifest),
					fetchImpl: async (url) =>
						new Response(
							Uint8Array.from(files.get(new URL(String(url)).pathname.slice(1))!)
						)
				})
			).rejects.toThrow('timezone bundle is missing its GNU libstdc++ archive');
			expect(compile).not.toHaveBeenCalled();
		} finally {
			compile.mockRestore();
		}
	});
});
