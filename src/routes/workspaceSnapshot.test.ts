import { emptyProjectDirectories, readWorkspaceDirectories } from '../lib/container/workspace';
import { describe, expect, it } from 'vitest';
import {
	normalizeWorkspaceTabs,
	sameWorkspaceContents,
	serializeStoredWorkspace,
	validateWorkspaceSnapshot
} from './workspaceSnapshot';

const files = [
	{ path: 'main.cpp', content: 'int main() {}' },
	{ path: 'helper.h', content: '#pragma once' }
];

describe('workspace JSON boundary', () => {
	it('saves only empty project directory leaves, preserving their POSIX names', () => {
		const rows = [
			['CPP', 'directory'],
			['CPP/empty', 'directory'],
			['CPP/empty/literal\\name', 'directory'],
			['CPP/full', 'directory'],
			['CPP/full/data', 'file'],
			['PYTHON/cache', 'directory'],
			['outside/sub', 'directory']
		] as const;
		const dirs = emptyProjectDirectories(
			rows.map(([path, type]) => ({ path, type, size: 0 })),
			['CPP', 'PYTHON']
		);
		const stored = JSON.parse(serializeStoredWorkspace({ files: [] }, dirs));
		expect(readWorkspaceDirectories(stored.emptyDirectories, ['CPP', 'PYTHON'])).toEqual([
			'CPP/empty/literal\\name',
			'PYTHON/cache'
		]);
		expect(() => validateWorkspaceSnapshot(stored)).not.toThrow();
		for (const bad of [
			'CPP/../root',
			'/CPP/folder',
			'CPP',
			'CPP//folder',
			'UNKNOWN/empty',
			{ path: 'CPP/d', implicit: 'yes' }
		])
			expect(() =>
				validateWorkspaceSnapshot({ files: [], emptyDirectories: [bad] })
			).toThrow();
	});

	it('rejects a saved directory whose path or parent is a project file', () => {
		const file = { path: 'data', content: 'keep' };
		for (const layout of [
			{ language: 'CPP', files: [file] },
			{ language: 'PYTHON', files: [], workspaces: { CPP: { files: [file] } } }
		]) {
			for (const directory of ['CPP/data', 'CPP/data/nested'])
				expect(() =>
					validateWorkspaceSnapshot({ ...layout, emptyDirectories: [directory] })
				).toThrow();
			expect(() =>
				validateWorkspaceSnapshot({ ...layout, emptyDirectories: ['CPP/data-old'] })
			).not.toThrow();
		}
	});

	it('does not write a file over stale directory metadata before the owner reconciles', () => {
		const active = { files: [{ path: 'data', content: 'file' }] };
		const snapshot = { language: 'CPP', ...active, workspaces: { CPP: active } };
		expect(() => serializeStoredWorkspace(snapshot, ['CPP/data/child'])).toThrow('directory');
		expect(() => serializeStoredWorkspace(snapshot, [])).not.toThrow();
	});
	it('treats a project directory rename as a real cross-tab change', () => {
		const snapshot = { language: 'CPP', files };
		const previous = serializeStoredWorkspace(snapshot, ['CPP/before']);
		const renamed = serializeStoredWorkspace(snapshot, ['CPP/after']);
		expect(sameWorkspaceContents(previous, renamed)).toBe(false);
		expect(
			sameWorkspaceContents(
				renamed,
				serializeStoredWorkspace({ ...snapshot, openTabs: ['helper.h'] }, ['CPP/after'])
			)
		).toBe(true);
	});

	it('accepts current and legacy snapshots without rewriting their input', () => {
		for (const snapshot of [
			{ files, activePath: 'main.cpp' },
			{ files, rustOptimizationProfile: 'speed' },
			{ version: 6, language: 'CPP', workspaces: { CPP: { files, openTabs: ['main.cpp'] } } }
		]) {
			const before = JSON.stringify(snapshot);
			expect(() => validateWorkspaceSnapshot(snapshot)).not.toThrow();
			expect(JSON.stringify(snapshot)).toBe(before);
		}
	});

	it('restores literal shell paths and bytes without changing legacy separator handling', () => {
		const raw = { path: 'names\\one.txt', pathStyle: 'posix', content: 'literal' };
		const nested = { path: 'names/one.txt', content: 'nested' };
		const snapshot = {
			files: [raw, nested, { path: 'report:2026', content: 'note', pathStyle: 'posix' }],
			activePath: raw.path,
			openTabs: [raw.path, nested.path]
		};
		expect(() => validateWorkspaceSnapshot(snapshot)).not.toThrow();
		expect(() =>
			validateWorkspaceSnapshot({ files: [{ ...raw, pathStyle: undefined }, nested] })
		).toThrow();
		for (const path of ['/absolute', 'a/../b', 'a//b', 'a/./b', 'a\0b']) {
			expect(() => validateWorkspaceSnapshot({ files: [{ ...raw, path }] })).toThrow();
		}
	});

	it.each([
		null,
		[],
		'source',
		{},
		{ files, openTabs: 'main.cpp' },
		{ files, openTabs: ['main.cpp', 3] },
		{ files, sidebarOpen: 'true' },
		{ files, version: 8 },
		{ files, version: 4.5 },
		{ files, cppVersion: 'CPP99' },
		{ files, pythonInvalidationMode: 'unknown' },
		{ files, pythonTimestampInput: 1700000001 },
		{ files, rustOptimizationProfile: 'unknown' },
		{ files: [{ path: 'main.cpp', content: 42 }] },
		{ files: [{ path: 'main.cpp', content: '', encoding: 'other' }] },
		{ workspaces: [] },
		{ workspaces: {} },
		{ workspaces: { CPP: { files, openTabs: 'main.cpp' } } },
		{ workspaces: { UNKNOWN: { files } } }
	])('rejects malformed JSON before applying it: %j', (snapshot) => {
		expect(() => validateWorkspaceSnapshot(snapshot)).toThrow('Invalid workspace snapshot');
	});
});

describe('workspace tab invariants', () => {
	it('deduplicates valid tabs and includes the active file', () => {
		expect(
			normalizeWorkspaceTabs(['helper.h', 'helper.h', 'missing.cpp'], files, 'main.cpp')
		).toEqual(['helper.h', 'main.cpp']);
		expect(normalizeWorkspaceTabs(undefined, files, 'main.cpp')).toEqual(['main.cpp']);
		expect(
			normalizeWorkspaceTabs(['main.cpp', 'helper.h', 'main.cpp'], files, 'main.cpp')
		).toEqual(['main.cpp', 'helper.h']);
	});
});

it('stores active file bodies once and accepts both the compact and older representations', () => {
	const active = { activePath: 'main.cpp', openTabs: ['main.cpp'], files };
	const other = { activePath: 'main.py', files: [{ path: 'main.py', content: 'print(1)' }] };
	const original = {
		version: 6,
		language: 'CPP',
		...active,
		workspaces: { CPP: active, PYTHON: other }
	};
	const stored = serializeStoredWorkspace(original);
	expect(JSON.parse(stored)).toEqual({ ...original, version: 7, workspaces: { PYTHON: other } });
	expect(() => validateWorkspaceSnapshot(JSON.parse(stored))).not.toThrow();
	expect(sameWorkspaceContents(JSON.stringify(original), stored)).toBe(true);
	const differentTab = {
		...JSON.parse(stored),
		activePath: 'helper.h',
		openTabs: ['helper.h'],
		sidebarOpen: false
	};
	expect(sameWorkspaceContents(JSON.stringify(differentTab), stored)).toBe(true);
	expect(sameWorkspaceContents(JSON.stringify({ ...differentTab, files: [] }), stored)).toBe(
		false
	);
	expect(
		sameWorkspaceContents(JSON.stringify({ ...differentTab, argsInput: '--other' }), stored)
	).toBe(false);
	expect(
		JSON.parse(serializeStoredWorkspace({ ...original, workspaces: { CPP: active } }))
			.workspaces
	).toBeUndefined();
});

it('accepts a layout-only save that upgrades legacy Python defaults while retaining concurrent edits', () => {
	const legacy = { version: 7, language: 'PYTHON', files, sidebarOpen: true };
	const upgraded = {
		...legacy,
		sidebarOpen: false,
		pythonInvalidationMode: 'checked-hash',
		pythonTimestampInput: '0'
	};
	const stored = JSON.stringify(legacy);
	expect(sameWorkspaceContents(stored, JSON.stringify(upgraded))).toBe(true);
	expect(
		sameWorkspaceContents(
			stored,
			JSON.stringify({ ...upgraded, pythonInvalidationMode: 'timestamp' })
		)
	).toBe(false);
	expect(
		sameWorkspaceContents(stored, JSON.stringify({ ...upgraded, pythonTimestampInput: '17' }))
	).toBe(false);
});
