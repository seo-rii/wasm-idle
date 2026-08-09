import { describe, expect, it } from 'vitest';
import { parseRuntimeManifest } from '../src/runtime-manifest.js';

const integrity = () => ({
	bytes: 10,
	sha256: 'a'.repeat(64),
	uncompressedBytes: 20,
	uncompressedSha256: 'b'.repeat(64)
});

const manifest = () => ({
	manifestVersion: 1,
	name: 'wasm-d',
	version: 'test',
	defaultTarget: 'wasm32-wasi',
	compiler: {
		ldc2: { asset: 'bin/ldc2.wasm.gz', compression: 'gzip', integrity: integrity() },
		toolchain: {
			asset: 'toolchain/toolchain.tar.gz',
			compression: 'gzip',
			integrity: integrity()
		},
		linker: {
			kind: 'emscripten-lld',
			js: { asset: 'bin/lld.js', integrity: integrity() },
			wasm: { asset: 'bin/lld.wasm.gz', compression: 'gzip', integrity: integrity() },
			data: { asset: 'bin/lld.data.gz', compression: 'gzip', integrity: integrity() }
		}
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: { kind: 'wasi-preview1' }
		}
	}
});

describe('D runtime manifest integrity', () => {
	it('requires and snapshots paired integrity metadata for every compiler asset', () => {
		const parsed = parseRuntimeManifest(manifest());

		expect(parsed.compiler.ldc2.integrity).toEqual(integrity());
		expect(parsed.compiler.toolchain.integrity).toEqual(integrity());
		expect(parsed.compiler.linker.js.integrity).toEqual(integrity());
		expect(parsed.compiler.linker.wasm.integrity).toEqual(integrity());
		expect(parsed.compiler.linker.data.integrity).toEqual(integrity());
		expect(Object.isFrozen(parsed.compiler.ldc2.integrity)).toBe(true);
	});

	it('rejects a missing asset receipt', () => {
		const value = manifest();
		delete (value.compiler.linker.data as { integrity?: unknown }).integrity;

		expect(() => parseRuntimeManifest(value)).toThrow(
			'invalid root.compiler.linker.data.integrity in wasm-d runtime manifest'
		);
	});

	it.each([
		['zero delivery bytes', { bytes: 0 }],
		['unsafe runtime bytes', { uncompressedBytes: Number.MAX_SAFE_INTEGER + 1 }],
		['uppercase delivery digest', { sha256: 'A'.repeat(64) }],
		['short runtime digest', { uncompressedSha256: 'b'.repeat(63) }]
	])('rejects %s', (_label, replacement) => {
		const value = manifest();
		Object.assign(value.compiler.ldc2.integrity, replacement);

		expect(() => parseRuntimeManifest(value)).toThrow(/wasm-d runtime manifest/u);
	});
});
