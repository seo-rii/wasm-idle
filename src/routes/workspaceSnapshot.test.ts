import { describe, expect, it } from 'vitest';
import { normalizeWorkspaceTabs, validateWorkspaceSnapshot } from './workspaceSnapshot';

const files = [
	{ path: 'main.cpp', content: 'int main() {}' },
	{ path: 'helper.h', content: '#pragma once' }
];

describe('workspace JSON boundary', () => {
	it('accepts current and legacy snapshots without rewriting their input', () => {
		for (const snapshot of [
			{ files, activePath: 'main.cpp' },
			{ version: 6, language: 'CPP', workspaces: { CPP: { files, openTabs: ['main.cpp'] } } }
		]) {
			const before = JSON.stringify(snapshot);
			expect(() => validateWorkspaceSnapshot(snapshot)).not.toThrow();
			expect(JSON.stringify(snapshot)).toBe(before);
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
		{ files, version: 7 },
		{ files, version: 4.5 },
		{ files, cppVersion: 'CPP99' },
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
