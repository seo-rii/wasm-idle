import { createHash } from 'node:crypto';
import { gccAssetPaths } from '../src/manifest.js';
import { gccStdModulesAssetPaths, gccStdModulesProfile } from '../src/std-modules.js';

const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const identity = (bytes: Uint8Array) => ({ bytes: bytes.length, sha256: digest(bytes) });

// Synthetic descriptor/transport bytes only. These are not GCC BMIs or module qualification.
export function stdModulesFixture<
	T extends {
		compiler: { commit: string };
		assets: Record<string, { bytes: number; sha256: string }>;
		capabilities: Record<string, boolean>;
		qualification: { status: string };
	}
>(parent: T, object = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)) {
	const chunks = [encoder.encode('!<arch>\n')];
	for (const [name, bytes] of [
		['/', new Uint8Array(4)],
		['std.o/', object],
		['std.compat.o/', object]
	] as const) {
		chunks.push(
			encoder.encode(
				`${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'644'.padEnd(8)}${String(bytes.length).padEnd(10)}\x60\n`
			),
			bytes
		);
		if (bytes.length % 2) chunks.push(Uint8Array.of(10));
	}
	const archive = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		archive.set(chunk, offset);
		offset += chunk.length;
	}
	const files = new Map<string, Uint8Array>([
		[gccStdModulesAssetPaths.std, encoder.encode('synthetic-BMI:std')],
		[gccStdModulesAssetPaths.stdCompat, encoder.encode('synthetic-BMI:std.compat')],
		[gccStdModulesAssetPaths.initializers, archive],
		[gccStdModulesAssetPaths.signal, Uint8Array.from(archive)]
	]);
	const asset = (path: string) => ({ path, ...identity(files.get(path)!) });
	const gccSource = {
		gccCommit: parent.compiler.commit,
		sourceDiffSha256: 'b'.repeat(64),
		patches: ['first', 'second'].map((name) => ({
			path: `patches/${name}.patch`,
			purpose: 'Synthetic source identity',
			sha256: digest(encoder.encode(name))
		}))
	};
	const source = identity(encoder.encode('synthetic-interface-source'));
	const manifest = {
		...parent,
		provenance: { gccSource },
		capabilities: {
			...parent.capabilities,
			libstdcxx: true,
			staticInitialization: true,
			stdModules: true
		},
		qualification: { status: 'verified' },
		stdModules: {
			schemaVersion: 1,
			kind: 'gnu-libstdcxx-std-modules',
			compilerHost: 'wasm32-unknown-emscripten',
			target: 'wasm32-wasi',
			abi: 'wasm32-wasi-preview1',
			bindings: {
				gccSource: structuredClone(gccSource),
				...Object.fromEntries(
					['cc1plusJs', 'cc1plusWasm', 'sysroot'].map((name) => [
						name,
						{ bytes: parent.assets[name].bytes, sha256: parent.assets[name].sha256 }
					])
				)
			},
			profile: structuredClone(gccStdModulesProfile),
			interfaces: {
				sources: {
					'std.cc.in': { ...source },
					'std.compat.cc.in': { ...source },
					'std-clib.cc.in': { ...source }
				},
				std: { ...source },
				stdCompat: { ...source }
			},
			modules: [
				{ name: 'std', requires: [] as string[], bmi: asset(gccStdModulesAssetPaths.std) },
				{
					name: 'std.compat',
					requires: ['std'],
					bmi: asset(gccStdModulesAssetPaths.stdCompat)
				}
			],
			initializerArchive: {
				asset: asset(gccStdModulesAssetPaths.initializers),
				members: ['std.o', 'std.compat.o'].map((name) => ({ name, ...identity(object) }))
			},
			signalArchive: asset(gccStdModulesAssetPaths.signal),
			qualification: { status: 'verified' }
		}
	};
	return { manifest, files };
}

export function stdModulesManifestFixture() {
	const revision = (family: string) => ({
		family,
		repository: `https://example.test/${family}`,
		version: family === 'gcc' ? '17.0.0' : '1.0.0',
		commit: 'a'.repeat(40)
	});
	return stdModulesFixture({
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
			rtti: false,
			threads: false,
			dynamicLinking: false,
			simd: true,
			relaxedSimd: true,
			atomics: false,
			tls: false
		},
		assets: Object.fromEntries(
			Object.entries(gccAssetPaths)
				.filter(([name]) => name !== 'ldJs')
				.map(([name, path]) => [name, { path, bytes: 8, sha256: 'a'.repeat(64) }])
		),
		qualification: { status: 'unverified' }
	}).manifest;
}
