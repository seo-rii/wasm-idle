import { DEFAULT_MAX_RUNTIME_JSON_BYTES, fetchRuntimeJson } from '../../core/src/wasm.js';
import { resolveHostedRuntimeUrl, runtimeManifestUrl } from './url.js';
import type {
	RuntimeClangdConfig,
	RuntimeCompilerConfig,
	RuntimeCompilerProvenance,
	RuntimeManifestV1,
	RuntimeManifestTarget,
	SupportedClangTarget
} from './types.js';

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-clang runtime manifest`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-clang runtime manifest`);
	}
	return value;
}

function expectTarget(value: unknown, label: string): SupportedClangTarget {
	if (value !== 'wasm32-wasi') {
		throw new Error(`invalid ${label} in wasm-clang runtime manifest`);
	}
	return value;
}

function parseCompilerProvenance(value: unknown): RuntimeCompilerProvenance {
	const provenance = expectObject(value, 'root.compiler.provenance');
	if (provenance.name !== 'clang') {
		throw new Error('invalid root.compiler.provenance.name in wasm-clang runtime manifest');
	}
	return {
		name: 'clang',
		version: expectString(provenance.version, 'root.compiler.provenance.version'),
		revision: expectString(provenance.revision, 'root.compiler.provenance.revision')
	};
}

function parseSysrootProfiles(
	value: unknown
): NonNullable<RuntimeCompilerConfig['sysroot']['profiles']> {
	const profiles = expectObject(value, 'root.compiler.sysroot.profiles');
	return {
		c: {
			asset: expectString(
				expectObject(profiles.c, 'root.compiler.sysroot.profiles.c').asset,
				'root.compiler.sysroot.profiles.c.asset'
			)
		},
		cppAddon: {
			asset: expectString(
				expectObject(profiles.cppAddon, 'root.compiler.sysroot.profiles.cppAddon').asset,
				'root.compiler.sysroot.profiles.cppAddon.asset'
			)
		}
	};
}

function parseCompilerConfig(value: unknown): RuntimeCompilerConfig {
	const compiler = expectObject(value, 'root.compiler');
	const sysroot = expectObject(compiler.sysroot, 'root.compiler.sysroot');
	return {
		memfs: {
			asset: expectString(
				expectObject(compiler.memfs, 'root.compiler.memfs').asset,
				'root.compiler.memfs.asset'
			),
			argv0: expectString(
				expectObject(compiler.memfs, 'root.compiler.memfs').argv0,
				'root.compiler.memfs.argv0'
			)
		},
		clang: {
			asset: expectString(
				expectObject(compiler.clang, 'root.compiler.clang').asset,
				'root.compiler.clang.asset'
			),
			argv0: expectString(
				expectObject(compiler.clang, 'root.compiler.clang').argv0,
				'root.compiler.clang.argv0'
			)
		},
		lld: {
			asset: expectString(
				expectObject(compiler.lld, 'root.compiler.lld').asset,
				'root.compiler.lld.asset'
			),
			argv0: expectString(
				expectObject(compiler.lld, 'root.compiler.lld').argv0,
				'root.compiler.lld.argv0'
			)
		},
		sysroot: {
			asset: expectString(sysroot.asset, 'root.compiler.sysroot.asset'),
			...(sysroot.printscanLongDouble === undefined
				? {}
				: {
						printscanLongDouble: {
							asset: expectString(
								expectObject(
									sysroot.printscanLongDouble,
									'root.compiler.sysroot.printscanLongDouble'
								).asset,
								'root.compiler.sysroot.printscanLongDouble.asset'
							)
						}
					}),
			...(typeof sysroot.runtimeRoot === 'string'
				? { runtimeRoot: sysroot.runtimeRoot }
				: {}),
			...(sysroot.profiles === undefined
				? {}
				: { profiles: parseSysrootProfiles(sysroot.profiles) })
		},
		...(compiler.resourceDir !== undefined
			? { resourceDir: expectString(compiler.resourceDir, 'root.compiler.resourceDir') }
			: {}),
		...(compiler.compilerRuntimeLibDir !== undefined
			? {
					compilerRuntimeLibDir: expectString(
						compiler.compilerRuntimeLibDir,
						'root.compiler.compilerRuntimeLibDir'
					)
				}
			: {}),
		...(typeof compiler.defaultCppStandard === 'string'
			? { defaultCppStandard: compiler.defaultCppStandard }
			: {}),
		...(typeof compiler.defaultCStandard === 'string'
			? { defaultCStandard: compiler.defaultCStandard }
			: {}),
		...(compiler.provenance !== undefined
			? { provenance: parseCompilerProvenance(compiler.provenance) }
			: {})
	};
}

function parseClangdHeaders(value: unknown): NonNullable<RuntimeClangdConfig['headers']> {
	const headers = expectObject(value, 'root.clangd.headers');
	const invalid = (field: string) => {
		throw new Error(`invalid root.clangd.headers.${field} in wasm-clang runtime manifest`);
	};
	if (headers.asset !== 'clangd/clangd.headers.json.gz') invalid('asset');
	if (headers.format !== 'clangd-headers-v1') invalid('format');
	for (const field of ['sha256', 'uncompressedSha256', 'version']) {
		if (typeof headers[field] !== 'string' || !/^[a-f0-9]{64}$/.test(headers[field]))
			invalid(field);
	}
	if (headers.version !== headers.uncompressedSha256) invalid('version');
	for (const field of ['bytes', 'uncompressedBytes']) {
		if (
			!Number.isSafeInteger(headers[field]) ||
			(headers[field] as number) <= 0 ||
			(headers[field] as number) > 128 * 1024 * 1024
		)
			invalid(field);
	}
	const resourceDir = expectString(headers.resourceDir, 'root.clangd.headers.resourceDir');
	if (
		!/^\/lib\/clang\/[a-zA-Z0-9_.-]+$/.test(resourceDir) ||
		['.', '..'].includes(resourceDir.split('/').at(-1)!)
	)
		invalid('resourceDir');
	return {
		asset: 'clangd/clangd.headers.json.gz',
		format: 'clangd-headers-v1',
		version: headers.version as string,
		targetTriple: expectTarget(headers.targetTriple, 'root.clangd.headers.targetTriple'),
		resourceDir,
		bytes: headers.bytes as number,
		sha256: headers.sha256 as string,
		uncompressedBytes: headers.uncompressedBytes as number,
		uncompressedSha256: headers.uncompressedSha256 as string
	};
}

function parseClangdConfig(value: unknown): RuntimeClangdConfig {
	const clangd = expectObject(value, 'root.clangd');
	return {
		js: expectString(clangd.js, 'root.clangd.js'),
		wasm: expectString(clangd.wasm, 'root.clangd.wasm'),
		...(clangd.headers === undefined ? {} : { headers: parseClangdHeaders(clangd.headers) })
	};
}

function parseTargetConfig(value: unknown, label: string): RuntimeManifestTarget {
	const target = expectObject(value, label);
	const execution = expectObject(target.execution, `${label}.execution`);
	if (execution.kind !== 'wasi-preview1') {
		throw new Error(`invalid ${label}.execution.kind in wasm-clang runtime manifest`);
	}
	if (target.artifactFormat !== 'wasi-core-wasm') {
		throw new Error(`invalid ${label}.artifactFormat in wasm-clang runtime manifest`);
	}
	return {
		artifactFormat: 'wasi-core-wasm',
		execution: {
			kind: 'wasi-preview1'
		}
	};
}

function parseTargets(value: unknown): Record<SupportedClangTarget, RuntimeManifestTarget> {
	const targetsObject = expectObject(value, 'root.targets');
	return {
		'wasm32-wasi': parseTargetConfig(targetsObject['wasm32-wasi'], 'root.targets.wasm32-wasi')
	};
}

export function parseRuntimeManifest(value: unknown): RuntimeManifestV1 {
	const root = expectObject(value, 'root');
	if (root.manifestVersion !== 1) {
		throw new Error('invalid root.manifestVersion in wasm-clang runtime manifest');
	}
	const compiler = parseCompilerConfig(root.compiler);
	const clangd = parseClangdConfig(root.clangd);
	if (
		clangd.headers &&
		compiler.resourceDir &&
		clangd.headers.resourceDir !== compiler.resourceDir
	) {
		throw new Error(
			'root.clangd.headers.resourceDir does not match the compiler in wasm-clang runtime manifest'
		);
	}
	return {
		manifestVersion: 1,
		version: expectString(root.version, 'root.version'),
		defaultTarget: expectTarget(root.defaultTarget, 'root.defaultTarget'),
		compiler,
		clangd,
		targets: parseTargets(root.targets)
	};
}

export function normalizeRuntimeManifest(value: RuntimeManifestV1 | unknown): RuntimeManifestV1 {
	return parseRuntimeManifest(value);
}

export async function loadRuntimeManifest(
	manifestUrl: string | URL,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal,
	maxBytes = DEFAULT_MAX_RUNTIME_JSON_BYTES
): Promise<RuntimeManifestV1> {
	const resolvedUrl = resolveHostedRuntimeUrl(manifestUrl, 'wasm-clang runtime manifest URL');
	return parseRuntimeManifest(
		await fetchRuntimeJson(resolvedUrl, {
			fetchImpl,
			label: 'wasm-clang runtime manifest',
			maxBytes: Math.min(maxBytes, DEFAULT_MAX_RUNTIME_JSON_BYTES),
			signal
		})
	);
}

export function resolveRuntimeManifestUrl(baseUrl: string | URL) {
	return runtimeManifestUrl(baseUrl);
}
