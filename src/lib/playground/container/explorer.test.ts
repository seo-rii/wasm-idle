import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import componentSource from './ContainerExplorer.svelte?raw';
import {
	buildExplorerModel,
	explorerBreadcrumbs,
	EXPLORER_PAGE_SIZE,
	resolveExplorerDirectory,
	visibleExplorerRows
} from './explorer';
import type { ContainerWorkspaceEntry } from './protocol';

const file = (path: string): ContainerWorkspaceEntry => ({ path, type: 'file', size: 12 });
const folder = (path: string): ContainerWorkspaceEntry => ({ path, type: 'directory', size: 0 });
const link = (path: string): ContainerWorkspaceEntry => ({ path, type: 'symlink', size: 4 });

describe('shared workspace folder explorer', () => {
	it('constructs implicit parents, keeps empty folders, and sorts directories before files', () => {
		const model = buildExplorerModel([
			file('CPP/src/main.cpp'),
			file('notes.txt'),
			folder('empty'),
			folder('CPP')
		]);
		expect(model.children.get('')?.map((entry) => entry.path)).toEqual([
			'CPP',
			'empty',
			'notes.txt'
		]);
		expect(model.entries.get('CPP/src')).toMatchObject({
			type: 'directory',
			implicit: true,
			parent: 'CPP'
		});
		expect(model.entries.get('CPP')?.implicit).toBeUndefined();
		expect(visibleExplorerRows(model, 'empty', new Set()).rows).toEqual([]);
	});

	it('navigates to a directory and resolves removed descendants to their closest parent', () => {
		const model = buildExplorerModel([
			file('CPP/src/main.cpp'),
			folder('empty'),
			file('README.md')
		]);
		expect(resolveExplorerDirectory(model, 'CPP/src')).toBe('CPP/src');
		expect(resolveExplorerDirectory(model, 'CPP/src/removed')).toBe('CPP/src');
		expect(resolveExplorerDirectory(model, 'README.md')).toBe('');
		expect(resolveExplorerDirectory(model, 'missing/folder')).toBe('');
		expect(
			visibleExplorerRows(model, 'CPP', new Set()).rows.map((row) => row.entry.path)
		).toEqual(['CPP/src']);
		expect(explorerBreadcrumbs('CPP/src')).toEqual([
			{ path: '', name: '/workspace' },
			{ path: 'CPP', name: 'CPP' },
			{ path: 'CPP/src', name: 'src' }
		]);
		expect(explorerBreadcrumbs('')).toEqual([{ path: '', name: '/workspace' }]);
	});

	it('expands only selected branches and restores child visibility after ancestor collapse', () => {
		const model = buildExplorerModel([
			file('CPP/src/main.cpp'),
			file('CPP/include/example.h'),
			file('notes.txt')
		]);
		expect(visibleExplorerRows(model, '', new Set()).rows.map((row) => row.entry.path)).toEqual(
			['CPP', 'notes.txt']
		);
		const expanded = new Set(['CPP', 'CPP/src']);
		expect(
			visibleExplorerRows(model, '', expanded).rows.map((row) => [
				row.entry.path,
				row.depth,
				row.expanded
			])
		).toEqual([
			['CPP', 0, true],
			['CPP/include', 1, false],
			['CPP/src', 1, true],
			['CPP/src/main.cpp', 2, false],
			['notes.txt', 0, false]
		]);
		expanded.delete('CPP');
		expect(visibleExplorerRows(model, '', expanded).rows.map((row) => row.entry.path)).toEqual([
			'CPP',
			'notes.txt'
		]);
		expanded.add('CPP');
		expect(
			visibleExplorerRows(model, '', expanded).rows.some(
				(row) => row.entry.path === 'CPP/src/main.cpp'
			)
		).toBe(true);
	});

	it('never follows symlinks or treats files as parents, even for inconsistent metadata', () => {
		const model = buildExplorerModel([
			link('shortcut'),
			file('shortcut/hidden.txt'),
			file('plain'),
			file('plain/subdir/hidden.txt'),
			folder('real')
		]);
		expect(model.entries.get('shortcut')?.type).toBe('symlink');
		expect(model.entries.has('shortcut/hidden.txt')).toBe(false);
		expect(model.entries.has('plain/subdir')).toBe(false);
		expect(model.entries.has('plain/subdir/hidden.txt')).toBe(false);
		expect(resolveExplorerDirectory(model, 'shortcut/hidden.txt')).toBe('');
		expect(
			visibleExplorerRows(model, '', new Set(['shortcut', 'plain'])).rows.map(
				(row) => row.entry.path
			)
		).toEqual(['real', 'plain', 'shortcut']);
	});

	it('keeps valid UTF-8, spaces and literal backslashes and rejects path traversal metadata', () => {
		const model = buildExplorerModel([
			file('CPP/한글 파일.c'),
			file('literal\\name'),
			file('../escape'),
			file('/absolute'),
			file('bad/./file'),
			file('nul\0name')
		]);
		expect(model.entries.has('CPP/한글 파일.c')).toBe(true);
		expect(model.entries.has('literal\\name')).toBe(true);
		expect([...model.entries.keys()].sort()).toEqual(
			['', 'CPP', 'CPP/한글 파일.c', 'literal\\name'].sort()
		);
		expect(resolveExplorerDirectory(model, '../CPP')).toBe('');
	});

	it('bounds each rendered page and clamps navigation after files are removed', () => {
		const model = buildExplorerModel(
			Array.from({ length: 600 }, (_, index) => file(`file${index}.txt`))
		);
		const first = visibleExplorerRows(model, '', new Set());
		const second = visibleExplorerRows(model, '', new Set(), EXPLORER_PAGE_SIZE);
		const last = visibleExplorerRows(model, '', new Set(), 99999);
		expect(first.rows).toHaveLength(256);
		expect(first.remaining).toBe(344);
		expect(second.rows).toHaveLength(256);
		expect(second.rows[0].entry.path).toBe('file256.txt');
		expect(last.rows).toHaveLength(88);
		expect(last.offset).toBe(512);
		expect(
			new Set([...first.rows, ...second.rows, ...last.rows].map((row) => row.entry.path)).size
		).toBe(600);
		expect(
			visibleExplorerRows(buildExplorerModel([file('remaining.txt')]), '', new Set(), 512)
				.offset
		).toBe(0);
	});

	it('compiles accessible folder controls and file actions for the existing sidebar', () => {
		const result = compile(componentSource, {
			filename: 'src/lib/playground/container/ContainerExplorer.svelte',
			generate: 'client'
		});
		expect(result.warnings).toEqual([]);
	});
});
