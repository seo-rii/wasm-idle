import type { CrossGccAsset, CrossGccAssetName, CrossGccManifest } from './types.js';

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
	sysrootPath: '/sysroot',
	gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/16',
	resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/16/include'
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

/** Accept only the pinned producer's supported GCC/host/target profile. */
export function parseCrossGccManifest(value: unknown): CrossGccManifest {
	const input = record(value, 'manifest');
	for (const [key, expected] of Object.entries(fixed)) {
		if (input[key] !== expected) throw new Error(`Unsupported GCC manifest ${key}`);
	}
	const compiler = record(input.compiler, 'compiler');
	if (compiler.family !== 'gcc' || compiler.version !== '16.2.0')
		throw new Error('Unsupported GCC compiler version');
	if (
		!Array.isArray(input.cpuProfiles) ||
		input.cpuProfiles.length !== 2 ||
		input.cpuProfiles[0] !== 'x86-64' ||
		input.cpuProfiles[1] !== 'avx2-fma'
	)
		throw new Error('Unsupported GCC CPU profiles');
	const inputAssets = record(input.assets, 'assets');
	const assets = Object.fromEntries(
		Object.entries(gccAssetPaths).map(([key, path]) => {
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
	) as Record<CrossGccAssetName, CrossGccAsset>;
	const gnu = record(input.gnu, 'GNU provenance');
	if (gnu.gccVersion !== '16') throw new Error('Unsupported GCC target library version');
	const capabilities =
		input.capabilities === undefined ? {} : record(input.capabilities, 'capabilities');
	if (
		capabilities.precompiledHeaders !== undefined &&
		typeof capabilities.precompiledHeaders !== 'boolean'
	)
		throw new Error('Invalid GCC precompiled header capability');
	const status = record(input.qualification, 'qualification').status;
	if (status !== 'verified' && status !== 'unverified')
		throw new Error('Invalid GCC qualification');
	return Object.freeze({
		...fixed,
		compiler: Object.freeze({ family: 'gcc', version: '16.2.0' }),
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
		qualification: Object.freeze({ status })
	});
}
