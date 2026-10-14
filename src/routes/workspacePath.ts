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
	const path = parts.filter((part) => part && part !== '.').join('/');
	if (path && !path.trim()) throw new Error('Workspace path cannot contain only whitespace');
	return path;
}

/**
 * Resolve the workspace file a compiler diagnostic belongs to. Diagnostics without a file, or
 * naming a compiler scratch path that matches no workspace file, stay on the run's entry file.
 */
export function resolveCompilerDiagnosticPath(
	fileName: string | null | undefined,
	entryPath: string,
	workspacePaths: readonly string[]
): string {
	if (!fileName?.trim()) return entryPath;
	const path = fileName.replaceAll('\\', '/').replace(/^\/workspace\//u, '');
	try {
		const workspacePath = normalizeWorkspacePath(path);
		if (workspacePaths.includes(workspacePath)) return workspacePath;
	} catch {
		// Absolute compiler paths are matched by their trailing components below.
	}
	const parts = path.split('/').filter((part) => part && part !== '.');
	if (!parts.length) return entryPath;
	// Compilers may report scratch copies (/tmp/Program.cs, /work/main.d) or bare names
	// (Helper.java). Files sharing the most trailing components win; the entry file breaks ties.
	let bestLength = 0;
	let matches: string[] = [];
	for (const candidate of workspacePaths) {
		const candidateParts = candidate.split('/');
		let length = 0;
		while (
			length < parts.length &&
			length < candidateParts.length &&
			parts[parts.length - 1 - length] === candidateParts[candidateParts.length - 1 - length]
		) {
			length += 1;
		}
		if (!length || length < bestLength) continue;
		if (length > bestLength) {
			bestLength = length;
			matches = [];
		}
		matches.push(candidate);
	}
	if (matches.includes(entryPath)) return entryPath;
	return matches.length === 1 ? matches[0] : entryPath;
}
