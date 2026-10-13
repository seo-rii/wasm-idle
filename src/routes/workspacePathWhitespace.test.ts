import { describe, expect, it } from 'vitest';
import { normalizeWorkspacePath } from './workspacePath';
import { validateWorkspaceSnapshot } from './workspaceSnapshot';

describe('restorable workspace path names', () => {
	it.each([' ', '   ', '\t\n', './  ', './   /./'])(
		'rejects whitespace-only normalized names %j',
		(path) => {
			expect(() => normalizeWorkspacePath(path)).toThrow('only whitespace');
		}
	);

	it.each([' a.cpp ', ' a / b .py ', '資料.py', '.gitignore'])(
		'preserves accepted significant names through snapshot validation: %j',
		(path) => {
			const normalized = normalizeWorkspacePath(path);
			expect(normalized).toBe(path);
			expect(() =>
				validateWorkspaceSnapshot({
					version: 6,
					language: 'CPP',
					files: [{ path: normalized, content: 'source' }]
				})
			).not.toThrow();
		}
	);
});
