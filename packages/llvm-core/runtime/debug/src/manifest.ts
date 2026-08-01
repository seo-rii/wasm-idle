import { parseRuntimeManifest } from '../../clang/src/runtime-manifest.js';
import type { RuntimeManifestV1 } from '../../clang/src/types.js';
import type {
	DebugRuntimeAssets,
	RuntimeDebugAsset,
	RuntimeDebugCapabilities,
	RuntimeDebuggerConfig,
	RuntimeManifestV2
} from './types.js';

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm debug runtime manifest`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm debug runtime manifest`);
	}
	return value;
}

function expectSha256(value: unknown, label: string) {
	const hash = expectString(value, label);
	if (!/^[\da-f]{64}$/u.test(hash)) {
		throw new Error(`invalid ${label} in wasm debug runtime manifest`);
	}
	return hash;
}

function expectBoolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') {
		throw new Error(`invalid ${label} in wasm debug runtime manifest`);
	}
	return value;
}

function parseAsset(value: unknown, label: string): RuntimeDebugAsset {
	const asset = expectObject(value, label);
	const paths = {
		js: expectString(asset.js, `${label}.js`),
		wasm: expectString(asset.wasm, `${label}.wasm`),
		worker: expectString(asset.worker, `${label}.worker`)
	};
	for (const [kind, path] of Object.entries(paths)) {
		const segments = path.split('/');
		let decodedSegments: string[];
		try {
			decodedSegments = segments.map((segment) => decodeURIComponent(segment));
		} catch {
			throw new Error(`invalid ${label}.${kind} asset path in wasm debug runtime manifest`);
		}
		if (
			path.startsWith('/') ||
			path.includes('\\') ||
			path.includes('\0') ||
			path.includes(':') ||
			path.includes('?') ||
			path.includes('#') ||
			segments.some(
				(segment) => segment.length === 0 || segment === '.' || segment === '..'
			) ||
			decodedSegments.some(
				(segment) =>
					segment.length === 0 ||
					segment === '.' ||
					segment === '..' ||
					segment.includes('/') ||
					segment.includes('\\') ||
					segment.includes('\0')
			)
		) {
			throw new Error(`invalid ${label}.${kind} asset path in wasm debug runtime manifest`);
		}
	}
	return {
		...paths,
		jsSha256: expectSha256(asset.jsSha256, `${label}.jsSha256`),
		wasmSha256: expectSha256(asset.wasmSha256, `${label}.wasmSha256`),
		workerSha256: expectSha256(asset.workerSha256, `${label}.workerSha256`)
	};
}

function parseCapabilities(value: unknown): RuntimeDebugCapabilities {
	const capabilities = expectObject(value, 'root.debugger.capabilities');
	return {
		breakpoints: expectBoolean(
			capabilities.breakpoints,
			'root.debugger.capabilities.breakpoints'
		),
		stepping: expectBoolean(capabilities.stepping, 'root.debugger.capabilities.stepping'),
		stackTrace: expectBoolean(capabilities.stackTrace, 'root.debugger.capabilities.stackTrace'),
		locals: expectBoolean(capabilities.locals, 'root.debugger.capabilities.locals'),
		globals: expectBoolean(capabilities.globals, 'root.debugger.capabilities.globals'),
		readMemory: expectBoolean(capabilities.readMemory, 'root.debugger.capabilities.readMemory'),
		evaluateExpressions: expectBoolean(
			capabilities.evaluateExpressions,
			'root.debugger.capabilities.evaluateExpressions'
		),
		dataBreakpoints: expectBoolean(
			capabilities.dataBreakpoints,
			'root.debugger.capabilities.dataBreakpoints'
		),
		wasmThreads: expectBoolean(
			capabilities.wasmThreads,
			'root.debugger.capabilities.wasmThreads'
		)
	};
}

function parseDebugger(value: unknown): RuntimeDebuggerConfig {
	const debuggerConfig = expectObject(value, 'root.debugger');
	if (debuggerConfig.protocolVersion !== 1) {
		throw new Error('invalid root.debugger.protocolVersion in wasm debug runtime manifest');
	}
	if (debuggerConfig.transport !== 'shared-ring-v1') {
		throw new Error('invalid root.debugger.transport in wasm debug runtime manifest');
	}
	const lldbObject = expectObject(debuggerConfig.lldb, 'root.debugger.lldb');
	const targetObject = expectObject(debuggerConfig.targetRuntime, 'root.debugger.targetRuntime');
	const lldbAsset = parseAsset(lldbObject, 'root.debugger.lldb');
	const targetAsset = parseAsset(targetObject, 'root.debugger.targetRuntime');
	if (targetObject.name !== 'wamr') {
		throw new Error('invalid root.debugger.targetRuntime.name in wasm debug runtime manifest');
	}
	return {
		protocolVersion: 1,
		transport: 'shared-ring-v1',
		lldb: {
			...lldbAsset,
			llvmVersion: expectString(lldbObject.llvmVersion, 'root.debugger.lldb.llvmVersion'),
			llvmRevision: expectString(lldbObject.llvmRevision, 'root.debugger.lldb.llvmRevision'),
			patchesSha256: expectSha256(
				lldbObject.patchesSha256,
				'root.debugger.lldb.patchesSha256'
			)
		},
		targetRuntime: {
			...targetAsset,
			name: 'wamr',
			revision: expectString(targetObject.revision, 'root.debugger.targetRuntime.revision')
		},
		capabilities: parseCapabilities(debuggerConfig.capabilities)
	};
}

export function parseDebugRuntimeManifest(value: unknown): RuntimeManifestV2 {
	const root = expectObject(value, 'root');
	if (root.manifestVersion !== 2) {
		throw new Error('invalid root.manifestVersion in wasm debug runtime manifest');
	}
	const compilerManifest: RuntimeManifestV1 = parseRuntimeManifest({
		...root,
		manifestVersion: 1
	});
	if (!compilerManifest.compiler.provenance) {
		throw new Error('root.compiler.provenance is required for LLDB artifacts');
	}
	const debuggerConfig = parseDebugger(root.debugger);
	if (compilerManifest.compiler.provenance.revision !== debuggerConfig.lldb.llvmRevision) {
		throw new Error(
			'root.compiler.provenance.revision must match root.debugger.lldb.llvmRevision'
		);
	}
	return {
		...compilerManifest,
		manifestVersion: 2,
		debugger: debuggerConfig
	};
}

export function resolveDebugRuntimeAssets(
	manifest: RuntimeManifestV2,
	runtimeBaseUrl: string | URL
): DebugRuntimeAssets {
	const base = new URL(
		typeof runtimeBaseUrl === 'string' && !runtimeBaseUrl.endsWith('/')
			? `${runtimeBaseUrl}/`
			: runtimeBaseUrl
	);
	return {
		lldb: {
			js: new URL(manifest.debugger.lldb.js, base),
			wasm: new URL(manifest.debugger.lldb.wasm, base),
			worker: new URL(manifest.debugger.lldb.worker, base)
		},
		targetRuntime: {
			js: new URL(manifest.debugger.targetRuntime.js, base),
			wasm: new URL(manifest.debugger.targetRuntime.wasm, base),
			worker: new URL(manifest.debugger.targetRuntime.worker, base)
		}
	};
}

export async function preflightDebugRuntimeAssets(
	manifest: RuntimeManifestV2,
	runtimeBaseUrl: string | URL,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal
) {
	const assets = resolveDebugRuntimeAssets(manifest, runtimeBaseUrl);
	const checks = [
		[assets.lldb.js, manifest.debugger.lldb.jsSha256, 'LLDB JavaScript'],
		[assets.lldb.wasm, manifest.debugger.lldb.wasmSha256, 'LLDB WebAssembly'],
		[assets.lldb.worker, manifest.debugger.lldb.workerSha256, 'LLDB pthread worker'],
		[assets.targetRuntime.js, manifest.debugger.targetRuntime.jsSha256, 'WAMR JavaScript'],
		[assets.targetRuntime.wasm, manifest.debugger.targetRuntime.wasmSha256, 'WAMR WebAssembly'],
		[
			assets.targetRuntime.worker,
			manifest.debugger.targetRuntime.workerSha256,
			'WAMR pthread worker'
		]
	] as const;
	for (const [url, expectedSha256, label] of checks) {
		const response = await fetchImpl(url, { signal });
		if (!response.ok) {
			throw new Error(`Unable to load ${label} debug asset (${response.status}) from ${url}`);
		}
		await verifyAssetSha256(await response.arrayBuffer(), expectedSha256, label);
	}
	return assets;
}

export async function sha256Hex(value: Uint8Array | ArrayBuffer) {
	const input = value instanceof Uint8Array ? value : new Uint8Array(value);
	const bytes = new Uint8Array(input.byteLength);
	bytes.set(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

export async function verifyAssetSha256(
	value: Uint8Array | ArrayBuffer,
	expectedSha256: string,
	label: string
) {
	const actualSha256 = await sha256Hex(value);
	if (actualSha256 !== expectedSha256) {
		throw new Error(
			`${label} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`
		);
	}
}
