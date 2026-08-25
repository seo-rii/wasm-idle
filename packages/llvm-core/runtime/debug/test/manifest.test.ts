import { describe, expect, it } from 'vitest';

import {
	parseDebugRuntimeManifest,
	preflightDebugRuntimeAssets,
	resolveDebugRuntimeAssets,
	verifyAssetSha256
} from '../src/manifest.js';

const hash = 'a'.repeat(64);
const debugAssetHash = 'a647260c0a2f386cdb893fdc303169041dcf2955da1fa881501863ec8b968785';

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
				writeMemory: true,
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
		expect(parsed.debugger.capabilities.writeMemory).toBe(true);
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

		const missingWriteMemory = manifest();
		delete (missingWriteMemory.debugger.capabilities as Record<string, unknown>).writeMemory;
		expect(() => parseDebugRuntimeManifest(missingWriteMemory)).toThrow(/writeMemory/u);
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

	it.each([
		'%2e%2e/lldb.js',
		'.%2e/lldb.js',
		'%2e./lldb.js',
		'debug/%2fescape/lldb.js',
		'debug/%5cescape/lldb.js'
	])('rejects encoded debug asset traversal path %s', (path) => {
		const escaped = manifest();
		escaped.debugger.lldb.js = path;

		expect(() => parseDebugRuntimeManifest(escaped)).toThrow(/asset path/u);
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

	it('preflights every LLDB/WAMR asset in order before workers are created', async () => {
		const parsed = parseDebugRuntimeManifest(manifest());
		for (const asset of [parsed.debugger.lldb, parsed.debugger.targetRuntime]) {
			asset.jsSha256 = debugAssetHash;
			asset.wasmSha256 = debugAssetHash;
			asset.workerSha256 = debugAssetHash;
		}
		const requests: string[] = [];

		await expect(
			preflightDebugRuntimeAssets(parsed, 'https://cdn.example/runtime/', async (url) => {
				requests.push(String(url));
				return new Response('debug-asset');
			})
		).resolves.toEqual(resolveDebugRuntimeAssets(parsed, 'https://cdn.example/runtime/'));
		expect(requests).toEqual([
			'https://cdn.example/runtime/debug/lldb.js',
			'https://cdn.example/runtime/debug/lldb.wasm',
			'https://cdn.example/runtime/debug/lldb.pthread.mjs',
			'https://cdn.example/runtime/debug/wamr.js',
			'https://cdn.example/runtime/debug/wamr.wasm',
			'https://cdn.example/runtime/debug/wamr.worker.mjs'
		]);
	});

	it('rejects a missing or corrupt asset during preflight', async () => {
		const parsed = parseDebugRuntimeManifest(manifest());
		parsed.debugger.lldb.jsSha256 = debugAssetHash;

		await expect(
			preflightDebugRuntimeAssets(parsed, 'https://cdn.example/runtime/', async (url) =>
				String(url).endsWith('lldb.wasm')
					? new Response(null, { status: 404 })
					: new Response('debug-asset')
			)
		).rejects.toThrow(/LLDB WebAssembly.*404/u);
		await expect(
			preflightDebugRuntimeAssets(
				parsed,
				'https://cdn.example/runtime/',
				async () => new Response('corrupt')
			)
		).rejects.toThrow(/SHA-256 mismatch/u);
	});
});
