import { parseRuntimeManifest } from '../../clang/src/runtime-manifest.js';
import type { RuntimeManifestV1 } from '../../clang/src/types.js';
import type {
	DebugRuntimeAssets,
	RuntimeDebugAsset,
	RuntimeDebugCapabilities,
	RuntimeDebuggerConfig,
	RuntimeManifestV2,
	VerifiedDebugRuntimeAssets
} from './types.js';

const MAX_DEBUG_RUNTIME_ASSET_COUNT = 10;
const MAX_DEBUG_RUNTIME_ASSET_BYTES = 55_000_000;

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
		writeMemory: expectBoolean(
			capabilities.writeMemory,
			'root.debugger.capabilities.writeMemory'
		),
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
	if (checks.length > MAX_DEBUG_RUNTIME_ASSET_COUNT) {
		throw new Error(
			`wasm debug runtime manifest exceeds the ${MAX_DEBUG_RUNTIME_ASSET_COUNT} asset limit`
		);
	}
	const verified: VerifiedDebugRuntimeAssets = {
		lldb: { js: new ArrayBuffer(0), wasm: new ArrayBuffer(0), worker: new ArrayBuffer(0) },
		targetRuntime: {
			js: new ArrayBuffer(0),
			wasm: new ArrayBuffer(0),
			worker: new ArrayBuffer(0)
		}
	};
	const destinations = [
		[verified.lldb, 'js'],
		[verified.lldb, 'wasm'],
		[verified.lldb, 'worker'],
		[verified.targetRuntime, 'js'],
		[verified.targetRuntime, 'wasm'],
		[verified.targetRuntime, 'worker']
	] as const;
	let totalBytes = 0;
	let index = 0;
	for (const [url, expectedSha256, label] of checks) {
		if (signal?.aborted) {
			throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
		}
		const response = await fetchImpl(url, { signal });
		if (!response.ok) {
			try {
				await response.body?.cancel();
			} catch {
				// Preserve the HTTP failure when response cancellation also fails.
			}
			throw new Error(`Unable to load ${label} debug asset (${response.status}) from ${url}`);
		}
		const remainingBytes = MAX_DEBUG_RUNTIME_ASSET_BYTES - totalBytes;
		const rawContentLength = response.headers.get('content-length');
		let declaredBytes: number | undefined;
		if (rawContentLength !== null) {
			if (!/^(?:0|[1-9]\d*)$/u.test(rawContentLength)) {
				const error = new Error(`${label} has an invalid content-length header`);
				try {
					await response.body?.cancel(error);
				} catch {
					// Preserve the validation failure when response cancellation also fails.
				}
				throw error;
			}
			declaredBytes = Number(rawContentLength);
			if (!Number.isSafeInteger(declaredBytes)) {
				const error = new Error(`${label} has an invalid content-length header`);
				try {
					await response.body?.cancel(error);
				} catch {
					// Preserve the validation failure when response cancellation also fails.
				}
				throw error;
			}
		}
		if (declaredBytes !== undefined && declaredBytes > remainingBytes) {
			const error = new Error(
				`${label} exceeds the ${MAX_DEBUG_RUNTIME_ASSET_BYTES.toLocaleString('en-US')} byte budget`
			);
			try {
				await response.body?.cancel(error);
			} catch {
				// Preserve the budget failure when response cancellation also fails.
			}
			throw error;
		}
		if (signal?.aborted) {
			const error =
				signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
			try {
				await response.body?.cancel(error);
			} catch {
				// Preserve the lifecycle failure when response cancellation also fails.
			}
			throw error;
		}
		let bytes: ArrayBuffer;
		if (!response.body) {
			bytes = new ArrayBuffer(0);
		} else {
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let length = 0;
			const cancelOnAbort = () => {
				void reader
					.cancel(
						signal?.reason ??
							new DOMException('The operation was aborted', 'AbortError')
					)
					.catch(() => undefined);
			};
			signal?.addEventListener('abort', cancelOnAbort, { once: true });
			try {
				while (true) {
					if (signal?.aborted) {
						throw (
							signal.reason ??
							new DOMException('The operation was aborted', 'AbortError')
						);
					}
					const result = await reader.read();
					if (signal?.aborted) {
						throw (
							signal.reason ??
							new DOMException('The operation was aborted', 'AbortError')
						);
					}
					if (result.done) break;
					if (!(result.value instanceof Uint8Array)) {
						const error = new TypeError(`${label} response body yielded invalid bytes`);
						await reader.cancel(error);
						throw error;
					}
					if (result.value.byteLength > remainingBytes - length) {
						const error = new Error(
							`${label} exceeds the ${MAX_DEBUG_RUNTIME_ASSET_BYTES.toLocaleString('en-US')} byte budget`
						);
						await reader.cancel(error);
						throw error;
					}
					const owned = new Uint8Array(result.value.byteLength);
					owned.set(result.value);
					chunks.push(owned);
					length += owned.byteLength;
				}
			} finally {
				signal?.removeEventListener('abort', cancelOnAbort);
				reader.releaseLock();
			}
			const combined = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				combined.set(chunk, offset);
				offset += chunk.byteLength;
			}
			bytes = combined.buffer;
		}
		totalBytes += bytes.byteLength;
		await verifyAssetSha256(bytes, expectedSha256, label);
		const [destination, key] = destinations[index++]!;
		destination[key] = bytes;
	}
	return verified;
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
