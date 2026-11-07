import type {
	CrossGccAsset,
	CrossGccAssetName,
	CrossGccManifest,
	GccSourceRevision,
	GccStdModulesManifest,
	WasiGccAssetName,
	WasiGccManifest
} from './types.js';
import { gccStdModulesAssetPaths, gccStdModulesProfile } from './std-modules.js';

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

export const gccTlsIncludePath = '/sysroot/include/wasm32-wasi-tls';

export const gccExceptionRuntimePaths = Object.freeze({
	libstdcxx: '/sysroot/lib/wasm32-wasi-eh/libstdc++.a',
	libsupcxx: '/sysroot/lib/wasm32-wasi-eh/libsupc++.a',
	libunwind: '/sysroot/lib/wasm32-wasi-eh/libunwind.a'
});

// These opt-in providers are inside the integrity-bound sysroot, never in the
// global runtimeLibraries list used by legacy/default compilation.
export const gccTlsRuntimePaths = Object.freeze({
	ordinary: '/sysroot/lib/wasm32-wasi-tls/libgcc-wasi-tls.a',
	ordinaryLibc: '/sysroot/lib/wasm32-wasi-tls/libc.a',
	ordinaryLibm: '/sysroot/lib/wasm32-wasi-tls/libm.a',
	ordinaryBuiltins: '/sysroot/lib/wasm32-wasi-tls/libclang_rt.builtins-wasm32.a',
	ordinaryLongDouble: '/sysroot/lib/wasm32-wasi-tls/libc-printscan-long-double.a',
	shared: '/sysroot/lib/wasm32-wasi-threads/libgcc-wasi-tls-shared.a',
	libc: '/sysroot/lib/wasm32-wasi-threads/libc.a',
	libm: '/sysroot/lib/wasm32-wasi-threads/libm.a',
	builtins: '/sysroot/lib/wasm32-wasi-threads/libclang_rt.builtins-wasm32.a'
});

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
	const capabilities =
		input.capabilities === undefined ? {} : record(input.capabilities, 'capabilities');
	if (
		capabilities.precompiledHeaders !== undefined &&
		typeof capabilities.precompiledHeaders !== 'boolean'
	)
		throw new Error('Invalid GCC precompiled header capability');
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
		capabilities: Object.freeze({
			precompiledHeaders: capabilities.precompiledHeaders === true
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

function moduleRecord(value: unknown, keys: readonly string[], label: string) {
	const parsed = record(value, `std modules ${label}`);
	if (Object.keys(parsed).some((key) => !keys.includes(key)))
		throw new Error(`Unsupported GCC std modules ${label} field`);
	return parsed;
}

function moduleIdentity(value: unknown, label: string) {
	const identity = moduleRecord(value, ['bytes', 'sha256'], label);
	if (!Number.isSafeInteger(identity.bytes) || (identity.bytes as number) < 8)
		throw new Error(`Invalid GCC std modules ${label} size`);
	return Object.freeze({ bytes: identity.bytes as number, sha256: gccDigest(identity.sha256) });
}

function moduleAsset(value: unknown, path: string) {
	const asset = moduleRecord(value, ['path', 'bytes', 'sha256'], 'asset');
	if (asset.path !== path) throw new Error('Unsupported GCC std modules asset path');
	return Object.freeze({
		path,
		...moduleIdentity({ bytes: asset.bytes, sha256: asset.sha256 }, path)
	});
}

function moduleSource(value: unknown) {
	const source = moduleRecord(value, ['gccCommit', 'sourceDiffSha256', 'patches'], 'GCC source');
	if (typeof source.gccCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(source.gccCommit))
		throw new Error('Invalid GCC std modules compiler revision');
	if (!Array.isArray(source.patches) || !source.patches.length || source.patches.length > 256)
		throw new Error('Invalid GCC std modules compiler patches');
	const patches = source.patches.map((value: unknown) => {
		const patch = moduleRecord(value, ['path', 'purpose', 'sha256'], 'compiler patch');
		const path = text(patch.path);
		if (
			path.startsWith('/') ||
			path.split('/').some((part) => !part || part === '..' || part === '.')
		)
			throw new Error('Invalid GCC std modules compiler patch path');
		return Object.freeze({
			path,
			purpose: text(patch.purpose),
			sha256: gccDigest(patch.sha256)
		});
	});
	if (new Set(patches.map((patch) => patch.path)).size !== patches.length)
		throw new Error('Duplicate GCC std modules compiler patch');
	return Object.freeze({
		gccCommit: source.gccCommit,
		sourceDiffSha256: gccDigest(source.sourceDiffSha256),
		patches: Object.freeze(patches)
	});
}

function parseStdModules(
	value: unknown,
	parent: Record<string, unknown>,
	compiler: GccSourceRevision,
	assets: Readonly<Record<WasiGccAssetName, CrossGccAsset>>
): GccStdModulesManifest {
	const input = moduleRecord(
		value,
		[
			'schemaVersion',
			'kind',
			'compilerHost',
			'target',
			'abi',
			'bindings',
			'profile',
			'interfaces',
			'modules',
			'initializerArchive',
			'signalArchive',
			'qualification'
		],
		'descriptor'
	);
	const fixed = {
		schemaVersion: 1,
		kind: 'gnu-libstdcxx-std-modules',
		compilerHost: 'wasm32-unknown-emscripten',
		target: 'wasm32-wasi',
		abi: 'wasm32-wasi-preview1'
	} as const;
	for (const [key, expected] of Object.entries(fixed))
		if (input[key] !== expected) throw new Error(`Unsupported GCC std modules ${key}`);
	const bindings = moduleRecord(
		input.bindings,
		['gccSource', 'cc1plusJs', 'cc1plusWasm', 'sysroot'],
		'bindings'
	);
	const gccSource = moduleSource(bindings.gccSource);
	const parentSource = moduleSource(record(parent.provenance, 'provenance').gccSource);
	if (
		gccSource.gccCommit !== compiler.commit ||
		JSON.stringify(gccSource) !== JSON.stringify(parentSource)
	)
		throw new Error('GCC std modules compiler source identity mismatch');
	const identities = Object.fromEntries(
		['cc1plusJs', 'cc1plusWasm', 'sysroot'].map((key) => {
			const identity = moduleIdentity(bindings[key], key),
				asset = assets[key as WasiGccAssetName];
			if (identity.sha256 !== asset.sha256 || identity.bytes !== asset.bytes)
				throw new Error(`GCC std modules ${key} identity mismatch`);
			return [key, identity];
		})
	) as Pick<GccStdModulesManifest['bindings'], 'cc1plusJs' | 'cc1plusWasm' | 'sysroot'>;
	const profile = moduleRecord(input.profile, Object.keys(gccStdModulesProfile), 'profile');
	for (const [key, expected] of Object.entries(gccStdModulesProfile))
		if (
			Array.isArray(expected)
				? !Array.isArray(profile[key]) ||
					JSON.stringify(profile[key]) !== JSON.stringify(expected)
				: profile[key] !== expected
		)
			throw new Error(`Unsupported GCC std modules profile: ${key}`);
	const interfaces = moduleRecord(
		input.interfaces,
		['sources', 'std', 'stdCompat'],
		'interfaces'
	);
	const sourceNames = ['std.cc.in', 'std.compat.cc.in', 'std-clib.cc.in'] as const;
	const sources = moduleRecord(interfaces.sources, sourceNames, 'interface sources');
	const parsedSources = Object.fromEntries(
		sourceNames.map((name) => [name, moduleIdentity(sources[name], name)])
	) as GccStdModulesManifest['interfaces']['sources'];
	if (!Array.isArray(input.modules) || input.modules.length !== 2)
		throw new Error('GCC std modules require both std and std.compat');
	const modules = input.modules.map((value: unknown, index: number) => {
		const module = moduleRecord(value, ['name', 'requires', 'bmi'], 'module');
		const name = index ? 'std.compat' : 'std',
			requires = index ? ['std'] : [];
		if (
			module.name !== name ||
			!Array.isArray(module.requires) ||
			JSON.stringify(module.requires) !== JSON.stringify(requires)
		)
			throw new Error('Unsupported GCC std modules dependency graph');
		return Object.freeze({
			name,
			requires: Object.freeze(requires),
			bmi: moduleAsset(
				module.bmi,
				index ? gccStdModulesAssetPaths.stdCompat : gccStdModulesAssetPaths.std
			)
		});
	});
	const initializer = moduleRecord(
		input.initializerArchive,
		['asset', 'members'],
		'initializer archive'
	);
	if (!Array.isArray(initializer.members) || initializer.members.length !== 2)
		throw new Error('GCC std modules require both initializer objects');
	const members = initializer.members.map((value: unknown, index: number) => {
		const member = moduleRecord(value, ['name', 'bytes', 'sha256'], 'initializer member');
		const name = index ? 'std.compat.o' : 'std.o';
		if (member.name !== name) throw new Error('Unsupported GCC std modules initializer member');
		return Object.freeze({
			name,
			...moduleIdentity({ bytes: member.bytes, sha256: member.sha256 }, name)
		});
	});
	return Object.freeze({
		...fixed,
		bindings: Object.freeze({ gccSource, ...identities }),
		profile: gccStdModulesProfile,
		interfaces: Object.freeze({
			sources: Object.freeze(parsedSources),
			std: moduleIdentity(interfaces.std, 'std interface'),
			stdCompat: moduleIdentity(interfaces.stdCompat, 'std.compat interface')
		}),
		modules: Object.freeze(modules) as unknown as GccStdModulesManifest['modules'],
		initializerArchive: Object.freeze({
			asset: moduleAsset(initializer.asset, gccStdModulesAssetPaths.initializers),
			members: Object.freeze(members)
		}),
		signalArchive: moduleAsset(input.signalArchive, gccStdModulesAssetPaths.signal),
		qualification: parseQualification(input.qualification)
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
	if (typeof capabilityInput.exceptions !== 'boolean')
		throw new Error('Invalid GCC WASI capability: exceptions');
	capabilities.exceptions = capabilityInput.exceptions;
	for (const name of ['threads', 'dynamicLinking']) {
		if (capabilityInput[name] !== false)
			throw new Error(`Unsupported GCC WASI capability: ${name}`);
		capabilities[name] = false;
	}
	if (typeof capabilityInput.rtti !== 'boolean')
		throw new Error('Invalid GCC WASI capability: rtti');
	capabilities.rtti = capabilityInput.rtti;
	if (capabilities.rtti && (!capabilities.cpp || !capabilities.libstdcxx))
		throw new Error('GCC WASI RTTI requires C++ and a qualified GNU libstdc++ runtime');
	if (typeof capabilityInput.simd !== 'boolean')
		throw new Error('Invalid GCC WASI capability: simd');
	capabilities.simd = capabilityInput.simd;
	for (const name of [
		'longDouble',
		'int128',
		'coverage',
		'debug',
		'debugger',
		'relaxedSimd',
		'atomics',
		'sharedMemory'
	]) {
		if (capabilityInput[name] !== undefined && typeof capabilityInput[name] !== 'boolean')
			throw new Error(`Invalid GCC WASI capability: ${name}`);
		capabilities[name] = (capabilityInput[name] ?? false) as boolean;
	}
	if (capabilities.relaxedSimd && !capabilities.simd)
		throw new Error('GCC WASI relaxed SIMD requires the SIMD capability');
	// Preserve legacy parsed shapes as well as the absence=false behavior.
	for (const name of ['tls', 'timezoneDatabase', 'stdModules'])
		if (capabilityInput[name] !== undefined) {
			if (typeof capabilityInput[name] !== 'boolean')
				throw new Error(`Invalid GCC WASI capability: ${name}`);
			capabilities[name] = capabilityInput[name] as boolean;
		}
	for (const name of ['exceptions', 'timezoneDatabase', 'stdModules'])
		if (
			capabilities[name] &&
			(!capabilities.cpp ||
				!capabilities.libstdcxx ||
				!capabilities.libc ||
				!capabilities.staticInitialization)
		)
			throw new Error(`GCC ${name} require C++ and the qualified GNU runtime`);
	if (capabilities.sharedMemory && !capabilities.atomics)
		throw new Error('GCC shared memory requires the atomics capability');
	if (capabilities.longDouble && (!capabilities.libc || !capabilities.libm))
		throw new Error('GCC WASI longDouble requires libc and libm');
	if (capabilities.coverage && (!capabilities.libc || !capabilities.staticInitialization))
		throw new Error('GCC WASI coverage requires libc and static initialization');
	if (capabilities.debugger && (!capabilities.cpp || !capabilities.libstdcxx))
		throw new Error('GCC WASI debugger requires C++ and a qualified GNU libstdc++ runtime');
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
	const atomicLibraries = runtimeLibraries.filter((path) => path.endsWith('/libatomic.a'));
	if (runtimeLibraries.some((path) => /\/wasm32-wasi-eh\//u.test(path)))
		throw new Error(
			'GCC exception runtime providers must remain separate from default runtimeLibraries'
		);
	if (
		runtimeLibraries.some(
			(path) =>
				/\/wasm32-wasi-(?:tls|threads)\//u.test(path) ||
				/\/libgcc-wasi-tls(?:-shared)?\.a$/u.test(path)
		)
	)
		throw new Error(
			'GCC TLS runtime providers must remain separate from default runtimeLibraries'
		);
	if (
		capabilities.atomics
			? atomicLibraries.length !== 1 ||
				atomicLibraries[0] !== '/sysroot/lib/wasm32-wasi/libatomic.a'
			: atomicLibraries.length !== 0
	)
		throw new Error(
			'GCC atomics requires exactly its qualified /sysroot/lib/wasm32-wasi/libatomic.a provider'
		);
	if (capabilities.debugger)
		for (const library of [
			'/sysroot/lib/wasm32-wasi/libstdc++debugger.a',
			'/sysroot/lib/wasm32-wasi/libwasi-emulated-signal.a'
		])
			if (!runtimeLibraries.includes(library))
				throw new Error(`GCC WASI debugger requires runtime library: ${library}`);
	if (record(input.linker, 'WASI linker').host !== 'wasm32-wasi')
		throw new Error('Unsupported GCC WASI linker host');
	const assets = parseAssets(input.assets, true) as Readonly<
		Record<WasiGccAssetName, CrossGccAsset>
	>;
	if ((input.stdModules !== undefined) !== (capabilities.stdModules === true))
		throw new Error('GCC std modules capability requires its separate descriptor');
	const stdModules =
		input.stdModules === undefined
			? undefined
			: parseStdModules(input.stdModules, input, compiler, assets);
	return Object.freeze({
		...wasmFixed,
		compiler,
		assembler: revision(input.assembler, 'wabt'),
		linker: Object.freeze({ ...revision(input.linker, 'lld'), host: 'wasm32-wasi' }),
		sysroot: revision(input.sysroot, 'wasi-libc'),
		gccInstallation,
		resourceDir: `${gccInstallation}/include`,
		assets,
		...(stdModules ? { stdModules } : {}),
		runtimeLibraries: Object.freeze(runtimeLibraries),
		capabilities: Object.freeze(capabilities) as unknown as WasiGccManifest['capabilities'],
		qualification: parseQualification(input.qualification)
	});
}
