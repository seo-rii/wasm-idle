import { normalizeWorkspacePath } from '@wasm-idle/core';
import type { ContainerWorkspaceEntry } from './protocol.js';

export function readWorkspaceDirectories(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new TypeError('Invalid workspace directories');
	for (const path of value) {
		if (typeof path !== 'string' || !/^[A-Z][A-Z0-9_]*\//u.test(path))
			throw new TypeError('Invalid workspace directory path');
		normalizeWorkspacePath(path, 'posix');
	}
	return [...new Set<string>(value)].sort();
}

export function emptyProjectDirectories(
	entries: readonly ContainerWorkspaceEntry[],
	projects: readonly string[]
) {
	const parents = new Set(entries.map(({ path }) => path.substring(0, path.lastIndexOf('/'))));
	const languages = new Set(projects);
	return entries
		.filter(({ type, path }) => {
			const slash = path.indexOf('/');
			return (
				type === 'directory' &&
				slash > 0 &&
				languages.has(path.slice(0, slash)) &&
				!parents.has(path)
			);
		})
		.map(({ path }) => path)
		.sort();
}
