/** Normalize separators and dot components without discarding traversal or renaming files. */
export function normalizeWorkspacePath(value: string): string {
	if (typeof value !== 'string') throw new Error('Workspace path must be a string');
	if (value.includes('\0')) throw new Error('Workspace path cannot contain a NUL character');
	const normalized = value.replaceAll('\\', '/');
	if (normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)) {
		throw new Error(`Workspace path must use a relative path: ${value}`);
	}
	const parts = normalized.split('/');
	if (parts.includes('..')) {
		throw new Error(`Workspace path cannot traverse directories: ${value}`);
	}
	return parts.filter((part) => part && part !== '.').join('/');
}
