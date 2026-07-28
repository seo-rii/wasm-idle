import { describe, expect, it } from 'vitest';

import {
	parseDebugRuntimeManifest,
	resolveDebugRuntimeAssets,
	verifyAssetSha256
} from '../src/manifest.js';

const hash = 'a'.repeat(64);

function manifest() {
	return {
		manifestVersion: 2,
		version: 'debug-fixture',
		defaultTarget: 'wasm32-wasi',
		compiler: {
			memfs: { asset: 'memfs.zip', argv0: 'memfs' },
			clang: { asset: 'clang.zip', argv0: 'clang' },
			lld: { asset: 'lld.zip', argv0: 'wasm-ld' },
			sysroot: { asset: 'sysroot.tar.zip' },
			provenance: {
				name: 'clang',
				version: '22.1.8',
				revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1'
			}
		},
		targets: {
			'wasm32-wasi': {
				artifactFormat: 'wasi-core-wasm',
				execution: { kind: 'wasi-preview1' }
			}
		},
		clangd: { js: 'clangd.js', wasm: 'clangd.wasm' },
		debugger: {
			protocolVersion: 1,
			transport: 'shared-ring-v1',
			lldb: {
				js: 'debug/lldb.js',
				wasm: 'debug/lldb.wasm',
				worker: 'debug/lldb.pthread.mjs',
				jsSha256: hash,
				wasmSha256: hash,
				workerSha256: hash,
				llvmVersion: '22.1.8',
				llvmRevision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1',
				patchesSha256: hash
			},
			targetRuntime: {
				name: 'wamr',
				js: 'debug/wamr.js',
				wasm: 'debug/wamr.wasm',
				worker: 'debug/wamr.worker.mjs',
				jsSha256: hash,
				wasmSha256: hash,
				workerSha256: hash,
				revision: '25bd7eb63e828e4bd242cc9b38d260b4b31c6605'
			},
			capabilities: {
				breakpoints: true,
				stepping: true,
				stackTrace: true,
				locals: true,
				globals: true,
				readMemory: true,
				evaluateExpressions: false,
				dataBreakpoints: false,
				wasmThreads: false
			}
		}
	};
}

describe('debug runtime manifest', () => {
	it('parses pinned LLDB/WAMR assets and resolves their URLs', () => {
		const parsed = parseDebugRuntimeManifest(manifest());
		expect(parsed.debugger.lldb.llvmVersion).toBe('22.1.8');
		expect(parsed.debugger.targetRuntime.name).toBe('wamr');
		expect(parsed.debugger.capabilities.evaluateExpressions).toBe(false);
		expect(resolveDebugRuntimeAssets(parsed, 'https://cdn.example/runtime')).toEqual({
			lldb: {
				js: new URL('https://cdn.example/runtime/debug/lldb.js'),
				wasm: new URL('https://cdn.example/runtime/debug/lldb.wasm'),
				worker: new URL('https://cdn.example/runtime/debug/lldb.pthread.mjs')
			},
			targetRuntime: {
				js: new URL('https://cdn.example/runtime/debug/wamr.js'),
				wasm: new URL('https://cdn.example/runtime/debug/wamr.wasm'),
				worker: new URL('https://cdn.example/runtime/debug/wamr.worker.mjs')
			}
		});
	});

	it('rejects missing provenance and unsupported transports', () => {
		const missingProvenance = manifest();
		delete (missingProvenance.compiler as Record<string, unknown>).provenance;
		expect(() => parseDebugRuntimeManifest(missingProvenance)).toThrow(/provenance/u);

		const unsupported = manifest();
		unsupported.debugger.transport = 'socket';
		expect(() => parseDebugRuntimeManifest(unsupported)).toThrow(/transport/u);

		const mismatchedRevision = manifest();
		mismatchedRevision.compiler.provenance.revision = 'different';
		expect(() => parseDebugRuntimeManifest(mismatchedRevision)).toThrow(/must match/u);
	});

	it('rejects debug assets that escape the configured runtime root', () => {
		for (const path of [
			'https://other.example/lldb.js',
			'/absolute/lldb.js',
			'../lldb.js',
			'debug/./lldb.js',
			'debug\\lldb.js'
		]) {
			const escaped = manifest();
			escaped.debugger.lldb.js = path;
			expect(() => parseDebugRuntimeManifest(escaped), path).toThrow(/asset path/u);
		}
	});

	it('verifies asset hashes', async () => {
		const bytes = new TextEncoder().encode('lldb');
		await expect(
			verifyAssetSha256(
				bytes,
				'87b4ff72193ca25aed4e0d735b2409146082702072e54d36d8bbc66d331f902a',
				'lldb'
			)
		).resolves.toBeUndefined();
		await expect(verifyAssetSha256(bytes, hash, 'lldb')).rejects.toThrow(/mismatch/u);
	});
});
