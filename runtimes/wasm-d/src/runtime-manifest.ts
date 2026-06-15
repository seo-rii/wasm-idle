import { runtimeManifestUrl } from './asset-url.js';
import { defaultFetch, fetchRuntimeAssetJson } from './runtime-asset.js';
import type { RuntimeManifestV1 } from './types.js';

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-d runtime manifest`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-d runtime manifest`);
	}
	return value;
}

function expectCompression(value: unknown, label: string) {
	if (value === undefined) return undefined;
	if (value !== 'gzip') {
		throw new Error(`invalid ${label} in wasm-d runtime manifest`);
	}
	return value;
}

export function parseRuntimeManifest(value: unknown): RuntimeManifestV1 {
	const root = expectObject(value, 'root');
	if (root.manifestVersion !== 1)
		throw new Error('invalid root.manifestVersion in wasm-d runtime manifest');
	if (root.name !== 'wasm-d') throw new Error('invalid root.name in wasm-d runtime manifest');
	const compiler = expectObject(root.compiler, 'root.compiler');
	const ldc2 = expectObject(compiler.ldc2, 'root.compiler.ldc2');
	const toolchain = expectObject(compiler.toolchain, 'root.compiler.toolchain');
	const linker = expectObject(compiler.linker, 'root.compiler.linker');
	const linkerJs = expectObject(linker.js, 'root.compiler.linker.js');
	const linkerWasm = expectObject(linker.wasm, 'root.compiler.linker.wasm');
	const linkerData = expectObject(linker.data, 'root.compiler.linker.data');
	if (linker.kind !== 'emscripten-lld') {
		throw new Error('invalid root.compiler.linker.kind in wasm-d runtime manifest');
	}
	const targets = expectObject(root.targets, 'root.targets');
	const wasmTarget = expectObject(targets['wasm32-wasi'], 'root.targets.wasm32-wasi');
	if (wasmTarget.artifactFormat !== 'wasi-core-wasm') {
		throw new Error(
			'invalid root.targets.wasm32-wasi.artifactFormat in wasm-d runtime manifest'
		);
	}
	const execution = expectObject(wasmTarget.execution, 'root.targets.wasm32-wasi.execution');
	if (execution.kind !== 'wasi-preview1') {
		throw new Error(
			'invalid root.targets.wasm32-wasi.execution.kind in wasm-d runtime manifest'
		);
	}
	return {
		manifestVersion: 1,
		name: 'wasm-d',
		version: expectString(root.version, 'root.version'),
		defaultTarget: 'wasm32-wasi',
		compiler: {
			ldc2: {
				asset: expectString(ldc2.asset, 'root.compiler.ldc2.asset'),
				argv0: typeof ldc2.argv0 === 'string' ? ldc2.argv0 : 'ldc2',
				compression: expectCompression(ldc2.compression, 'root.compiler.ldc2.compression')
			},
			toolchain: {
				asset: expectString(toolchain.asset, 'root.compiler.toolchain.asset'),
				compression: expectCompression(
					toolchain.compression,
					'root.compiler.toolchain.compression'
				)
			},
			linker: {
				kind: 'emscripten-lld',
				argv0: typeof linker.argv0 === 'string' ? linker.argv0 : 'wasm-ld',
				js: {
					asset: expectString(linkerJs.asset, 'root.compiler.linker.js.asset'),
					compression: expectCompression(
						linkerJs.compression,
						'root.compiler.linker.js.compression'
					)
				},
				wasm: {
					asset: expectString(linkerWasm.asset, 'root.compiler.linker.wasm.asset'),
					compression: expectCompression(
						linkerWasm.compression,
						'root.compiler.linker.wasm.compression'
					)
				},
				data: {
					asset: expectString(linkerData.asset, 'root.compiler.linker.data.asset'),
					compression: expectCompression(
						linkerData.compression,
						'root.compiler.linker.data.compression'
					)
				}
			}
		},
		targets: {
			'wasm32-wasi': {
				artifactFormat: 'wasi-core-wasm',
				execution: {
					kind: 'wasi-preview1'
				}
			}
		}
	};
}

export async function loadRuntimeManifest(
	baseUrl?: string | URL,
	fetchImpl: typeof fetch = defaultFetch,
	reportProgress?: (loaded: number, total?: number) => void
) {
	return parseRuntimeManifest(
		await fetchRuntimeAssetJson<unknown>(
			runtimeManifestUrl(baseUrl),
			'',
			'wasm-d runtime manifest',
			fetchImpl,
			reportProgress
		)
	);
}
