import type {
	CrossGccAsset,
	CrossGccAssetName,
	CrossGccManifest,
	GccSourceRevision,
	WasiGccAssetName,
	WasiGccManifest
} from './types.js';

export const gccAssetPaths = Object.freeze({
	cc1Js: 'cc1.mjs',
	cc1Wasm: 'cc1.wasm',
	cc1plusJs: 'cc1plus.mjs',
	cc1plusWasm: 'cc1plus.wasm',
	asJs: 'as.mjs',
	asWasm: 'as.wasm',
	ldJs: 'ld.mjs',
	ldWasm: 'ld.wasm',
	sysroot: 'sysroot.tar'
} satisfies Record<CrossGccAssetName, string>);

const fixed = {
	schemaVersion: 1,
	kind: 'gcc-x86_64-linux-gnu',
	host: 'wasm32-emscripten',
	target: 'x86_64-linux-gnu',
	linkMode: 'static',
	sysrootPath: '/sysroot'
} as const;

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`Invalid GCC ${label}`);
	return value as Record<string, unknown>;
}

export function gccDigest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
		throw new Error('Invalid GCC SHA-256');
	return value;
}

function text(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/u.test(value))
		throw new Error('Invalid GCC manifest text');
	return value;
}

function parseAssets(value: unknown, wasi = false) {
	const inputAssets = record(value, 'assets');
	return Object.freeze(
		Object.fromEntries(
			Object.entries(gccAssetPaths)
				.filter(([key]) => !wasi || key !== 'ldJs')
				.map(([key, path]) => {
					const asset = record(inputAssets[key], `${key} asset`);
					if (
						asset.path !== path ||
						!Number.isSafeInteger(asset.bytes) ||
						(asset.bytes as number) < 8
					)
						throw new Error(`Invalid GCC ${key} asset`);
					return [
						key,
						Object.freeze({
							path,
							bytes: asset.bytes as number,
							sha256: gccDigest(asset.sha256)
						})
					];
				})
		) as Record<CrossGccAssetName, CrossGccAsset>
	);
}

function parseQualification(value: unknown) {
	const status = record(value, 'qualification').status;
	if (status !== 'verified' && status !== 'unverified')
		throw new Error('Invalid GCC qualification');
	return Object.freeze({ status });
}

/** Accept only the pinned producer's supported GCC/host/target profile. */
export function parseCrossGccManifest(value: unknown): CrossGccManifest {
	const input = record(value, 'manifest');
	for (const [key, expected] of Object.entries(fixed)) {
		if (input[key] !== expected) throw new Error(`Unsupported GCC manifest ${key}`);
	}
	const compiler = record(input.compiler, 'compiler');
	if (
		compiler.family !== 'gcc' ||
		(compiler.version !== '13.3.0' && compiler.version !== '16.2.0')
	)
		throw new Error('Unsupported GCC compiler version');
	const major = compiler.version === '13.3.0' ? '13' : '16';
	const gccInstallation = `/sysroot/usr/lib/gcc/x86_64-linux-gnu/${major}` as const;
	const resourceDir = `${gccInstallation}/include` as const;
	if (input.gccInstallation !== gccInstallation || input.resourceDir !== resourceDir)
		throw new Error('Unsupported GCC installation paths');
	if (
		!Array.isArray(input.cpuProfiles) ||
		input.cpuProfiles.length !== 2 ||
		input.cpuProfiles[0] !== 'x86-64' ||
		input.cpuProfiles[1] !== 'avx2-fma'
	)
		throw new Error('Unsupported GCC CPU profiles');
	const assets = parseAssets(input.assets);
	const gnu = record(input.gnu, 'GNU provenance');
	if (gnu.gccVersion !== major) throw new Error('Unsupported GCC target library version');
	const qualification = parseQualification(input.qualification);
	return Object.freeze({
		...fixed,
		compiler: Object.freeze({ family: 'gcc', version: compiler.version }),
		gccInstallation,
		resourceDir,
		cpuProfiles: Object.freeze(['x86-64', 'avx2-fma'] as const),
		assets: Object.freeze(assets),
		gnu: Object.freeze({
			gccVersion: text(gnu.gccVersion),
			glibcVersion: text(gnu.glibcVersion),
			distribution: text(gnu.distribution)
		}),
		qualification
	});
}

function revision<Family extends string>(
	value: unknown,
	family: Family
): GccSourceRevision & { readonly family: Family } {
	const source = record(value, `${family} provenance`);
	if (
		source.family !== family ||
		typeof source.commit !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(source.commit)
	)
		throw new Error(`Invalid GCC ${family} source revision`);
	const repository = text(source.repository);
	if (!repository.startsWith('https://')) throw new Error(`Invalid GCC ${family} repository`);
	return Object.freeze({
		family,
		repository,
		commit: source.commit,
		version: text(source.version)
	});
}

/** The Wasm output backend has its own schema and retains the x86 contract. */
export function parseWasiGccManifest(value: unknown): WasiGccManifest {
	const input = record(value, 'WASI manifest');
	const wasmFixed = {
		schemaVersion: 2,
		kind: 'gcc-wasm32-wasi',
		host: 'wasm32-emscripten',
		target: 'wasm32-wasi',
		abi: 'wasm32-wasi-preview1',
		linkMode: 'static',
		sysrootPath: '/sysroot'
	} as const;
	for (const [key, expected] of Object.entries(wasmFixed))
		if (input[key] !== expected) throw new Error(`Unsupported GCC WASI manifest ${key}`);
	const compiler = revision(input.compiler, 'gcc');
	if (!/^17\.\d+\.\d+$/u.test(compiler.version))
		throw new Error('Unsupported GCC WASI compiler version');
	const gccInstallation = `/sysroot/lib/gcc/wasm32-wasi/${compiler.version}`;
	if (
		input.gccInstallation !== gccInstallation ||
		input.resourceDir !== `${gccInstallation}/include`
	)
		throw new Error('Unsupported GCC WASI installation paths');
	const capabilityInput = record(input.capabilities, 'WASI capabilities');
	const capabilities = {} as Record<string, boolean>;
	for (const name of ['c', 'cpp', 'libc', 'libm', 'libstdcxx', 'staticInitialization']) {
		if (typeof capabilityInput[name] !== 'boolean')
			throw new Error(`Invalid GCC WASI capability: ${name}`);
		capabilities[name] = capabilityInput[name] as boolean;
	}
	if (!capabilities.c || (capabilities.libstdcxx && !capabilities.cpp))
		throw new Error('Invalid GCC WASI language capabilities');
	for (const name of ['exceptions', 'rtti', 'threads', 'dynamicLinking']) {
		if (capabilityInput[name] !== false)
			throw new Error(`Unsupported GCC WASI capability: ${name}`);
		capabilities[name] = false;
	}
	if (typeof capabilityInput.simd !== 'boolean')
		throw new Error('Invalid GCC WASI capability: simd');
	capabilities.simd = capabilityInput.simd;
	for (const name of ['longDouble', 'int128']) {
		if (capabilityInput[name] !== undefined && typeof capabilityInput[name] !== 'boolean')
			throw new Error(`Invalid GCC WASI capability: ${name}`);
		capabilities[name] = (capabilityInput[name] ?? false) as boolean;
	}
	if (capabilities.longDouble && (!capabilities.libc || !capabilities.libm))
		throw new Error('GCC WASI longDouble requires libc and libm');
	if (!Array.isArray(input.runtimeLibraries) || input.runtimeLibraries.length > 16)
		throw new Error('Invalid GCC WASI runtime libraries');
	const runtimeLibraries = input.runtimeLibraries.map((path: unknown) => {
		if (
			typeof path !== 'string' ||
			!/^\/sysroot\/lib\/(?:[a-zA-Z0-9_.+-]+\/)*[a-zA-Z0-9_+-][a-zA-Z0-9_.+-]*\.a$/u.test(
				path
			) ||
			path.split('/').some((part) => part === '..' || part === '.')
		)
			throw new Error('Invalid GCC WASI runtime library path');
		return path;
	});
	if (record(input.linker, 'WASI linker').host !== 'wasm32-wasi')
		throw new Error('Unsupported GCC WASI linker host');
	return Object.freeze({
		...wasmFixed,
		compiler,
		assembler: revision(input.assembler, 'wabt'),
		linker: Object.freeze({ ...revision(input.linker, 'lld'), host: 'wasm32-wasi' }),
		sysroot: revision(input.sysroot, 'wasi-libc'),
		gccInstallation,
		resourceDir: `${gccInstallation}/include`,
		assets: parseAssets(input.assets, true) as Readonly<
			Record<WasiGccAssetName, CrossGccAsset>
		>,
		runtimeLibraries: Object.freeze(runtimeLibraries),
		capabilities: Object.freeze(capabilities) as unknown as WasiGccManifest['capabilities'],
		qualification: parseQualification(input.qualification)
	});
}
