import { normalizeWorkspacePath } from '@wasm-idle/core';
import type { ContainerWorkspaceEntry } from './protocol.js';

/** Private language workers accept portable relative paths; the shell filesystem uses POSIX names. */
export function isRuntimeWorkspacePath(path: string) {
	try {
		return normalizeWorkspacePath(path) === path;
	} catch {
		return false;
	}
}

export interface WorkspaceFile {
	path: string;
	pathStyle?: 'posix';
	content: string;
	encoding?: 'utf-8' | 'data-url';
}

const same = (a: WorkspaceFile | undefined, b: WorkspaceFile | undefined) =>
	a === b ||
	(!!a && !!b && a.content === b.content && (a.encoding ?? 'utf-8') === (b.encoding ?? 'utf-8'));

export function sameWorkspaceFiles(
	left: readonly WorkspaceFile[],
	right: readonly WorkspaceFile[]
) {
	return (
		left.length === right.length &&
		left.every((file, i) => file.path === right[i].path && same(file, right[i]))
	);
}

/** Reconcile independent terminal edits without discarding an unpublished editor revision. */
export function mergeContainerWorkspace(
	local: readonly WorkspaceFile[],
	baseline: readonly WorkspaceFile[],
	remote: readonly WorkspaceFile[],
	options: { acceptRemoteConflicts?: boolean; defaultFile?: WorkspaceFile } = {}
) {
	const localByPath = new Map(local.map((file) => [file.path, file]));
	const baseByPath = new Map(baseline.map((file) => [file.path, file]));
	const remoteByPath = new Map(remote.map((file) => [file.path, file]));
	const starter = options.defaultFile;
	// An unpublished example yields to a shell file that needs its path as either a file or a directory.
	const shadowedStarter =
		starter &&
		!baseByPath.has(starter.path) &&
		same(localByPath.get(starter.path), starter) &&
		remote.some(
			({ path }) =>
				path === starter.path ||
				path.startsWith(starter.path + '/') ||
				starter.path.startsWith(path + '/')
		);
	const conflicts = new Set<string>();
	const files = new Map<string, WorkspaceFile>();
	for (const path of new Set([
		...localByPath.keys(),
		...baseByPath.keys(),
		...remoteByPath.keys()
	])) {
		const here = localByPath.get(path),
			there = remoteByPath.get(path);
		const before =
			baseByPath.get(path) ??
			(shadowedStarter && path === starter.path ? starter : undefined);
		let selected: WorkspaceFile | undefined;
		if (same(here, before)) selected = there;
		else if (same(there, before) || same(here, there)) selected = here;
		else {
			conflicts.add(path);
			selected = options.acceptRemoteConflicts ? there : here;
		}
		if (selected) files.set(path, { ...selected });
	}
	// Independently valid editor and shell snapshots can introduce a file and its descendants.
	// Resolve the entire collision on the selected side, keeping unrelated edits from both.
	const preferred = options.acceptRemoteConflicts ? remoteByPath : localByPath;
	const omit = new Set<string>();
	for (const path of files.keys()) {
		for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
			const parent = path.slice(0, slash);
			if (!files.has(parent)) continue;
			conflicts.add(parent);
			conflicts.add(path);
			omit.add(preferred.has(parent) ? path : parent);
		}
	}
	for (const path of omit) files.delete(path);
	return { files: [...files.values()], conflicts: [...conflicts] };
}

const binaryExtensions = /\.(wasm|bin|parquet|png|jpe?g|gif|webp|ico|pdf|zip|gz|br|woff2?|ttf)$/i;

export function decodeWorkspaceText(path: string, bytes: Uint8Array): string | null {
	if (!binaryExtensions.test(path) && !bytes.includes(0)) {
		try {
			// Preserve a UTF-8 BOM as a character so encoding restores the same bytes.
			return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
		} catch {
			// Non-UTF-8 input is binary; never replace undecodable bytes.
		}
	}
	return null;
}

export function workspaceFileFromBytes(path: string, bytes: Uint8Array): WorkspaceFile {
	const content = decodeWorkspaceText(path, bytes);
	if (content !== null) return { path, content, encoding: 'utf-8' };
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	const mime = /\.wasm$/i.test(path) ? 'application/wasm' : 'application/octet-stream';
	return { path, content: `data:${mime};base64,${btoa(binary)}`, encoding: 'data-url' };
}

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
