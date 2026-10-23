export interface WorkspaceFile {
	path: string;
	content: string;
	encoding?: 'utf-8' | 'data-url';
}

const same = (a: WorkspaceFile | undefined, b: WorkspaceFile | undefined) =>
	a === b ||
	(!!a && !!b && a.content === b.content && (a.encoding ?? 'utf-8') === (b.encoding ?? 'utf-8'));

/** Reconcile independent terminal edits without discarding an unpublished editor revision. */
export function mergeContainerWorkspace(
	local: readonly WorkspaceFile[],
	baseline: readonly WorkspaceFile[],
	remote: readonly WorkspaceFile[],
	options: { acceptRemoteConflicts?: boolean } = {}
) {
	const localByPath = new Map(local.map((file) => [file.path, file]));
	const baseByPath = new Map(baseline.map((file) => [file.path, file]));
	const remoteByPath = new Map(remote.map((file) => [file.path, file]));
	const conflicts: string[] = [];
	const files: WorkspaceFile[] = [];
	for (const path of new Set([
		...localByPath.keys(),
		...baseByPath.keys(),
		...remoteByPath.keys()
	])) {
		const here = localByPath.get(path),
			before = baseByPath.get(path),
			there = remoteByPath.get(path);
		let selected: WorkspaceFile | undefined;
		if (same(here, before)) selected = there;
		else if (same(there, before) || same(here, there)) selected = here;
		else {
			conflicts.push(path);
			selected = options.acceptRemoteConflicts ? there : here;
		}
		if (selected) files.push({ ...selected });
	}
	return { files, conflicts };
}
