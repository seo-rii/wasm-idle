import { describe, it } from 'vitest';
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
	it('reuses only successful inserted artifacts and tracks misses', () => {
		const cache = new CompiledArtifactCache();
		assert.equal(cache.get('failed'), undefined);
		assert.equal(cache.get('failed'), undefined);
		const compiled = artifact();
		cache.set('success', compiled);
		assert.equal(cache.get('success'), compiled);
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
