import { runtimeManifestUrl } from './url.js';
import type {
	RuntimeClangdConfig,
	RuntimeCompilerConfig,
	RuntimeManifestV1,
	RuntimeManifestTarget,
	SupportedClangTarget
} from './types.js';

const DEFAULT_RUNTIME_MANIFEST_URL = new URL('./runtime/runtime-manifest.v1.json', import.meta.url);

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

function parseCompilerConfig(value: unknown): RuntimeCompilerConfig {
	const compiler = expectObject(value, 'root.compiler');
	const sysroot = expectObject(compiler.sysroot, 'root.compiler.sysroot');
	return {
		memfs: {
			asset: expectString(expectObject(compiler.memfs, 'root.compiler.memfs').asset, 'root.compiler.memfs.asset'),
			argv0: expectString(expectObject(compiler.memfs, 'root.compiler.memfs').argv0, 'root.compiler.memfs.argv0')
		},
		clang: {
			asset: expectString(expectObject(compiler.clang, 'root.compiler.clang').asset, 'root.compiler.clang.asset'),
			argv0: expectString(expectObject(compiler.clang, 'root.compiler.clang').argv0, 'root.compiler.clang.argv0')
		},
		lld: {
			asset: expectString(expectObject(compiler.lld, 'root.compiler.lld').asset, 'root.compiler.lld.asset'),
			argv0: expectString(expectObject(compiler.lld, 'root.compiler.lld').argv0, 'root.compiler.lld.argv0')
		},
		sysroot: {
			asset: expectString(sysroot.asset, 'root.compiler.sysroot.asset'),
			...(typeof sysroot.runtimeRoot === 'string' ? { runtimeRoot: sysroot.runtimeRoot } : {})
		},
		...(typeof compiler.defaultCppStandard === 'string'
			? { defaultCppStandard: compiler.defaultCppStandard }
			: {}),
		...(typeof compiler.defaultCStandard === 'string'
			? { defaultCStandard: compiler.defaultCStandard }
			: {})
	};
}

function parseClangdConfig(value: unknown): RuntimeClangdConfig {
	const clangd = expectObject(value, 'root.clangd');
	return {
		js: expectString(clangd.js, 'root.clangd.js'),
		wasm: expectString(clangd.wasm, 'root.clangd.wasm')
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
	return {
		manifestVersion: 1,
		version: expectString(root.version, 'root.version'),
		defaultTarget: expectTarget(root.defaultTarget, 'root.defaultTarget'),
		compiler: parseCompilerConfig(root.compiler),
		clangd: parseClangdConfig(root.clangd),
		targets: parseTargets(root.targets)
	};
}

export function normalizeRuntimeManifest(value: RuntimeManifestV1 | unknown): RuntimeManifestV1 {
	return parseRuntimeManifest(value);
}

export async function loadRuntimeManifest(
	manifestUrl: string | URL = DEFAULT_RUNTIME_MANIFEST_URL,
	fetchImpl: typeof fetch = fetch
): Promise<RuntimeManifestV1> {
	const resolvedUrl = manifestUrl instanceof URL ? manifestUrl : new URL(manifestUrl, import.meta.url);
	if (resolvedUrl.protocol === 'file:') {
		const [{ readFile }, { fileURLToPath }] = await Promise.all([
			import('node:fs/promises'),
			import('node:url')
		]);
		return parseRuntimeManifest(
			JSON.parse(await readFile(fileURLToPath(resolvedUrl), 'utf8')) as unknown
		);
	}
	const response = await fetchImpl(resolvedUrl.toString());
	if (!response.ok) {
		throw new Error(
			`failed to load wasm-clang runtime manifest from ${resolvedUrl}: ${response.status}`
		);
	}
	return parseRuntimeManifest(await response.json());
}

export function resolveRuntimeManifestUrl(baseUrl: string | URL) {
	return runtimeManifestUrl(baseUrl);
}
