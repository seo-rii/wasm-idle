import { describe, expect, it } from 'vitest';
import { validateWorkspaceSnapshot } from './workspaceSnapshot';

describe('workspace snapshot path boundary', () => {
	it.each(
		[
			[{ path: '../bad.cpp', content: 'source' }],
			[{ path: '/absolute.cpp', content: 'source' }],
			[{ path: 'C:file.cpp', content: 'source' }],
			[{ path: 'a\0b.cpp', content: 'source' }],
			[{ path: '.', content: 'source' }],
			[
				{ path: 'main.cpp', content: 'first' },
				{ path: './main.cpp', content: 'second' }
			],
			[
				{ path: 'src\\main.cpp', content: 'first' },
				{ path: './src//main.cpp', content: 'second' }
			]
		].map((files) => ({ files }))
	)('rejects invalid paths in both snapshot formats without changing the input', ({ files }) => {
		for (const snapshot of [
			{ version: 6, language: 'CPP', files },
			{ version: 6, language: 'CPP', workspaces: { CPP: { files } } }
		]) {
			const before = JSON.stringify(snapshot);
			expect(() => validateWorkspaceSnapshot(snapshot)).toThrow();
			expect(JSON.stringify(snapshot)).toBe(before);
		}
	});

	it('accepts unique normalized relative paths without rewriting their spelling', () => {
		const snapshot = {
			files: [
				{ path: './src//main.cpp', content: 'source' },
				{ path: ' a .cpp ', content: 'source' }
			]
		};
		const before = JSON.stringify(snapshot);
		expect(() => validateWorkspaceSnapshot(snapshot)).not.toThrow();
		expect(JSON.stringify(snapshot)).toBe(before);
	});
});
