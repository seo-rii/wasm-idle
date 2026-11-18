export interface WorkspaceFile {
	path: string;
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
