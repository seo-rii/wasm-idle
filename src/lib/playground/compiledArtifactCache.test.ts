import { describe, expect, it } from 'vitest';
import assert from 'node:assert/strict';
import { CompiledArtifactCache, clangCompileKey } from './compiledArtifactCache';

const artifact = (size = 8) => ({
	bytes: new Uint8Array(size),
	target: 'wasm32-wasi' as const,
	format: 'wasi-core-wasm' as const
});
const request = {
	language: 'C' as const,
	code: 'int main() {}',
	compileArgs: [],
	activePath: 'main.c',
	workspaceFiles: []
};

describe('compiled artifact cache', () => {
	it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid cache limits: %s',
		(limit) => {
			expect(() => new CompiledArtifactCache(limit, 100)).toThrow(TypeError);
			expect(() => new CompiledArtifactCache(1, limit)).toThrow(TypeError);
		}
	);
	it.each([
		[0, 100],
		[1, 0]
	])('treats zero limits as disabled retention (%i, %i)', (entries, bytes) => {
		const cache = new CompiledArtifactCache(entries, bytes);
		cache.set('a', artifact());
		expect(cache.get('a')).toBeUndefined();
		expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
	});
	it('owns exact-sized bytes and isolates input, output and nested metadata', () => {
		const cache = new CompiledArtifactCache(1, 16);
		const buffer = new Uint8Array(1024 * 1024);
		buffer[99] = 7;
		const compiled = {
			...artifact(),
			bytes: buffer.subarray(99, 100),
			debugMetadata: {
				variableMetadata: {},
				globalVariableMetadata: [],
				functionMetadata: { 1: 'main' }
			}
		};
		cache.set('a', compiled);
		buffer.fill(0);
		compiled.debugMetadata.functionMetadata[1] = 'changed';
		const first = cache.get('a')!;
		expect(first.bytes).toEqual(new Uint8Array([7]));
		expect((first.bytes as Uint8Array).buffer.byteLength).toBe(1);
		expect(cache.stats().bytes).toBe(3);
		expect(first.debugMetadata!.functionMetadata[1]).toBe('main');
		(first.bytes as Uint8Array).fill(42);
		first.debugMetadata!.functionMetadata[1] = 'changed again';
		const second = cache.get('a')!;
		expect(second.bytes).toEqual(new Uint8Array([7]));
		expect(second.debugMetadata!.functionMetadata[1]).toBe('main');
	});
	it('copies ArrayBuffer artifacts on insertion and retrieval', () => {
		const cache = new CompiledArtifactCache();
		const bytes = new Uint8Array([1, 2, 3]);
		cache.set('a', { ...artifact(), bytes: bytes.buffer });
		bytes.fill(0);
		const first = cache.get('a')!.bytes as ArrayBuffer;
		expect(new Uint8Array(first)).toEqual(new Uint8Array([1, 2, 3]));
		new Uint8Array(first).fill(9);
		expect(new Uint8Array(cache.get('a')!.bytes as ArrayBuffer)).toEqual(
			new Uint8Array([1, 2, 3])
		);
	});
	it('snapshots warning metadata, isolates readers and counts its size against the byte budget', () => {
		const cache = new CompiledArtifactCache(2, 1024);
		const warning = {
			lineNumber: 1,
			severity: 'warning' as const,
			message: 'original warning'
		};
		cache.set('a', artifact(), [warning]);
		const expectedBytes = 8 + 2 + JSON.stringify([warning]).length * 2;
		warning.message = 'mutated input';
		const replay = cache.getDiagnostics('a');
		expect(replay[0].message).toBe('original warning');
		replay[0].message = 'mutated replay';
		expect(cache.getDiagnostics('a')[0].message).toBe('original warning');
		expect(cache.stats().bytes).toBe(expectedBytes);
		const small = new CompiledArtifactCache(2, 32);
		small.set('a', artifact(), [warning]);
		expect(small.stats().entries).toBe(0);
	});
	it('reuses only successful inserted artifacts and tracks misses', () => {
		const cache = new CompiledArtifactCache();
		assert.equal(cache.get('failed'), undefined);
		assert.equal(cache.get('failed'), undefined);
		const compiled = artifact();
		cache.set('success', compiled);
		assert.deepEqual(cache.get('success'), { ...compiled, wasm: undefined });
		assert.deepEqual(cache.stats(), { hits: 1, misses: 2, entries: 1, bytes: 22 });
	});
	it('evicts least recently used entries and bounds bytes including source keys', () => {
		const cache = new CompiledArtifactCache(2, 100);
		cache.set('a', artifact());
		cache.set('b', artifact());
		cache.get('a');
		cache.set('c', artifact());
		assert.equal(cache.get('b'), undefined);
		assert.ok(cache.get('a'));
		cache.set('d', artifact(90));
		assert.equal(cache.stats().entries, 1);
		assert.equal(cache.stats().bytes, 92);
		cache.set('too large', artifact(100));
		assert.equal(cache.stats().entries, 1);
	});
	it('accounts for replacement without leaking the old size', () => {
		const cache = new CompiledArtifactCache(2, 100);
		cache.set('a', artifact(20));
		cache.set('a', artifact(10));
		assert.equal(cache.stats().bytes, 12);
	});
	it('keys every compile input and runtime identity', () => {
		const key = clangCompileKey('https://assets/v1/clang/', 1024, request);
		for (const change of [
			{ code: 'int main() { return 1; }' },
			{ language: 'CPP' as const },
			{ activePath: 'other.c' },
			{ compileArgs: ['-DVALUE=2'] },
			{ cVersion: 'c11' },
			{ cppVersion: 'c++20' },
			{ workspaceFiles: [{ path: 'lib.h', content: 'new' }] }
		])
			assert.notEqual(
				clangCompileKey('https://assets/v1/clang/', 1024, { ...request, ...change }),
				key
			);
		assert.notEqual(clangCompileKey('https://assets/v2/clang/', 1024, request), key);
		assert.notEqual(clangCompileKey('https://assets/v1/clang/', 512, request), key);
	});
	it('normalizes workspace file order but not contents', () => {
		const files = [
			{ path: 'a.h', content: 'a' },
			{ path: 'b.h', content: 'b' }
		];
		assert.equal(
			clangCompileKey('runtime', 1024, { ...request, workspaceFiles: files }),
			clangCompileKey('runtime', 1024, { ...request, workspaceFiles: files.toReversed() })
		);
	});
});
