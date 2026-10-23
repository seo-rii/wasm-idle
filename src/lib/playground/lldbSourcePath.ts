/** Match the compiler's DWARF workspace paths without loading the compiler runtime. */
export function normalizeLldbWorkspacePath(path: string) {
	const normalized = path
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');
	return normalized.startsWith('workspace/') ? normalized.slice('workspace/'.length) : normalized;
}
