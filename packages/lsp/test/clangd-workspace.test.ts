import { describe, expect, it } from 'vitest';
import {
	ClangdWorkspaceFileRegistry,
	normalizeClangdWorkspaceFilePath
} from '../src/clangd/workspace.js';

describe('clangd workspace file boundary', () => {
	it.each([
		['problem.cpp', '/workspace/problem.cpp'],
		['src/problem.cpp', '/workspace/src/problem.cpp'],
		['src\\problem.cpp', '/workspace/src/problem.cpp'],
		['/workspace/problem.cpp', '/workspace/problem.cpp']
	])('canonicalizes %s as %s', (input, expected) => {
		expect(normalizeClangdWorkspaceFilePath(input)).toBe(expected);
	});

	it.each([
		'',
		'/workspace',
		'/workspace/',
		'../usr/include/injected.hpp',
		'/workspace/../../usr/include/injected.hpp',
		'/workspace//nested.cpp',
		'/workspaceevil/prefix.cpp',
		'/tmp/outside.cpp',
		'C:\\outside.cpp',
		'\\\\server\\share\\outside.cpp',
		'file:///workspace/remote.cpp',
		'include/./nested.hpp',
		'include/bad\0.hpp'
	])('rejects an unsafe path %s', (path) => {
		expect(() => normalizeClangdWorkspaceFilePath(path)).toThrowError(
			expect.objectContaining({ name: 'WorkspaceValidationError', code: 'invalid-path' })
		);
	});

	it('rejects paths over the shared workspace byte limit', () => {
		const path = `${'a'.repeat(1021)}.cpp`;

		expect(() => normalizeClangdWorkspaceFilePath(path)).toThrowError(
			expect.objectContaining({
				name: 'WorkspaceValidationError',
				code: 'path-size-limit',
				limit: 1024,
				actual: 1025
			})
		);
	});

	it('bounds unique files while allowing idempotent synchronization and rollback', () => {
		const files = new ClangdWorkspaceFileRegistry(2);
		expect(files.register('main.cpp')).toEqual({
			path: '/workspace/main.cpp',
			added: false
		});
		expect(files.register('header.hpp')).toEqual({
			path: '/workspace/header.hpp',
			added: true
		});
		expect(files.register('/workspace/header.hpp')).toEqual({
			path: '/workspace/header.hpp',
			added: false
		});
		expect(() => files.register('overflow.cpp')).toThrowError(
			expect.objectContaining({
				name: 'WorkspaceValidationError',
				code: 'file-count-limit',
				limit: 2,
				actual: 3
			})
		);

		files.unregister('/workspace/header.hpp');
		expect(files.register('overflow.cpp')).toEqual({
			path: '/workspace/overflow.cpp',
			added: true
		});
	});
});
