import { normalizeWorkspacePath as normalizeRuntimePath } from '@wasm-idle/core';

export function normalizeWorkspaceFilePath(path: string, style?: 'posix') {
	return style === 'posix' ? normalizeRuntimePath(path, 'posix') : normalizeWorkspacePath(path);
}

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

function workspaceDirectories(files: Set<string>) {
	const directories = new Set<string>();
	for (const file of files) {
		for (let slash = file.indexOf('/'); slash !== -1; slash = file.indexOf('/', slash + 1)) {
			directories.add(file.slice(0, slash));
		}
	}
	return directories;
}

function unusedSibling(path: string, files: Set<string>, directories: Set<string>) {
	const dot = path.lastIndexOf('.');
	const extension = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
	const stem = path.slice(0, path.length - extension.length);
	let number = 2;
	let candidate = `${stem}-${number}${extension}`;
	while (files.has(candidate) || directories.has(candidate)) {
		candidate = `${stem}-${++number}${extension}`;
	}
	return candidate;
}

/** Check both directions of a file/directory collision before changing the editor. */
export function workspaceFilePath(path: string, existing: Iterable<string>, copy = false) {
	const files = new Set(existing);
	const directories = workspaceDirectories(files);
	for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
		const parent = path.slice(0, slash);
		if (files.has(parent)) throw new Error(`Cannot create ${path}: ${parent} is a file`);
	}
	if (directories.has(path)) throw new Error(`Cannot create ${path}: it is a directory`);
	if (!files.has(path)) return path;
	if (!copy) throw new Error('File already exists');
	return unusedSibling(path, files, directories);
}

export function assertWorkspaceFileHierarchy(paths: Set<string>) {
	for (const directory of workspaceDirectories(paths)) {
		if (paths.has(directory)) throw new Error(`Cannot create ${directory}: it is a directory`);
	}
}

/** Older snapshots allowed a file to double as a directory. Keep every file's bytes. */
export function recoverWorkspaceFilePaths(paths: string[]) {
	const files = new Set(paths);
	const directories = workspaceDirectories(files);
	const renamed = new Map<string, string>();
	for (const path of paths) {
		if (!directories.has(path)) continue;
		const next = unusedSibling(path, files, directories);
		renamed.set(path, next);
		files.add(next);
	}
	return renamed;
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
