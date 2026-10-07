import { describe, expect, it, vi } from 'vitest';
import { mountClangdHeaders, parseClangdHeaders } from '../src/clangd/headers.js';

const fixture = () => ({
	schemaVersion: 1 as const,
	version: 'llvm22:commit',
	targetTriple: 'wasm32-wasi',
	resourceDir: '/lib/clang/22',
	files: {
		'/usr/include/wasm32-wasi/stdio.h': 'C headers',
		'/usr/include/c++/v1/vector': 'C++ headers',
		'/usr/include/wasm32-wasi/noeh/c++/v1/__config_site': 'selected target config',
		'/lib/clang/22/include/stddef.h': 'resource header'
	}
});
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('separate clangd header asset', () => {
	it('mounts all selected C/C++ and resource headers at their original paths', () => {
		const headers = parseClangdHeaders(encode(fixture()));
		const fs = { mkdirTree: vi.fn(), writeFile: vi.fn() };
		expect(mountClangdHeaders(fs, headers)).toBe('/lib/clang/22');
		for (const [path, source] of Object.entries(headers.files))
			expect(fs.writeFile).toHaveBeenCalledWith(path, source);
		expect(fs.mkdirTree).toHaveBeenCalledWith('/usr/include/wasm32-wasi/noeh/c++/v1');
	});
	it.each([
		'/usr/include/../outside',
		'/usr/include//bad',
		'/usr/include/./bad',
		'/workspace/overwrite.cpp',
		'/usr/include/bad\\path',
		'/usr/include/bad\0path'
	])('rejects unsafe %s before mounting any headers', (path) => {
		const tree = fixture();
		Object.assign(tree.files, { [path]: 'bad' });
		const fs = { mkdirTree: vi.fn(), writeFile: vi.fn() };
		expect(() => mountClangdHeaders(fs, tree)).toThrow('Invalid clangd header path');
		expect(fs.writeFile).not.toHaveBeenCalled();
	});
	it('rejects incomplete or mismatched selected-target assets', () => {
		const tree = fixture();
		tree.targetTriple = 'wasm32-wasip2';
		expect(() => parseClangdHeaders(encode(tree))).toThrow('Required clangd asset header');
		tree.resourceDir = '/workspace';
		expect(() => parseClangdHeaders(encode(tree))).toThrow('metadata');
	});
	it('rejects invalid UTF-8 and missing required resource or C++ header sentinels', () => {
		expect(() => parseClangdHeaders(Uint8Array.of(0xff))).toThrow();
		for (const file of [
			'/usr/include/wasm32-wasi/stdio.h',
			'/usr/include/c++/v1/vector',
			'/lib/clang/22/include/stddef.h'
		]) {
			const tree = fixture();
			delete (tree.files as Record<string, string>)[file];
			expect(() => parseClangdHeaders(encode(tree))).toThrow('Required clangd asset header');
		}
	});
	it.each([undefined, null, 42, Uint8Array.of(1)])(
		'rejects non-text contents at the worker boundary before any filesystem writes: %s',
		(contents) => {
			const tree = fixture();
			Object.assign(tree.files, { '/usr/include/untrusted.h': contents });
			const fs = { mkdirTree: vi.fn(), writeFile: vi.fn() };
			expect(() => mountClangdHeaders(fs, tree)).toThrow(
				'Invalid clangd header path or contents'
			);
			expect(fs.mkdirTree).not.toHaveBeenCalled();
			expect(fs.writeFile).not.toHaveBeenCalled();
		}
	);
	it('requires sentinel headers to be present in the mounted tree itself', () => {
		const tree = fixture();
		tree.files = Object.create(tree.files);
		const fs = { mkdirTree: vi.fn(), writeFile: vi.fn() };
		expect(() => mountClangdHeaders(fs, tree)).toThrow('Required clangd asset header');
		expect(fs.writeFile).not.toHaveBeenCalled();
	});
});
