import type { ContainerWorkspaceEntry } from './protocol';

export interface ExplorerEntry extends ContainerWorkspaceEntry {
	name: string;
	parent: string;
	implicit?: boolean;
}

export interface ExplorerModel {
	readonly entries: ReadonlyMap<string, ExplorerEntry>;
	readonly children: ReadonlyMap<string, readonly ExplorerEntry[]>;
}

export interface ExplorerRow {
	entry: ExplorerEntry;
	depth: number;
	expanded: boolean;
}

export const EXPLORER_PAGE_SIZE = 256;

function isRelativePath(path: string) {
	return (
		path.length > 0 &&
		path.length <= 4096 &&
		!path.includes('\0') &&
		path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
	);
}

function parentPath(path: string) {
	const separator = path.lastIndexOf('/');
	return separator === -1 ? '' : path.slice(0, separator);
}

/** Build directory entries without following symbolic links or changing POSIX path spelling. */
export function buildExplorerModel(entries: readonly ContainerWorkspaceEntry[]): ExplorerModel {
	const nodes = new Map<string, ExplorerEntry>([
		['', { path: '', name: '/workspace', parent: '', type: 'directory', size: 0 }]
	]);
	for (const entry of entries) {
		if (!isRelativePath(entry.path) || nodes.has(entry.path)) continue;
		nodes.set(entry.path, {
			...entry,
			name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
			parent: parentPath(entry.path)
		});
	}
	for (const entry of [...nodes.values()]) {
		let path = entry.parent;
		while (path) {
			if (!nodes.has(path))
				nodes.set(path, {
					path,
					parent: parentPath(path),
					name: path.slice(path.lastIndexOf('/') + 1),
					type: 'directory',
					size: 0,
					implicit: true
				});
			path = parentPath(path);
		}
	}
	for (const [path, entry] of nodes) {
		let ancestor = entry.parent;
		while (path) {
			if (nodes.get(ancestor)?.type !== 'directory') {
				nodes.delete(path);
				break;
			}
			if (!ancestor) break;
			ancestor = parentPath(ancestor);
		}
	}
	const children = new Map<string, ExplorerEntry[]>();
	for (const entry of nodes.values()) {
		if (!entry.path) continue;
		const siblings = children.get(entry.parent) ?? [];
		siblings.push(entry);
		children.set(entry.parent, siblings);
	}
	for (const siblings of children.values())
		siblings.sort(
			(a, b) =>
				Number(b.type === 'directory') - Number(a.type === 'directory') ||
				a.name.localeCompare(b.name, 'en', { numeric: true }) ||
				a.path.localeCompare(b.path, 'en')
		);
	return { entries: nodes, children };
}

/** Missing or removed folders fall back to the nearest actual directory, then /workspace. */
export function resolveExplorerDirectory(model: ExplorerModel, requested: string) {
	let path = isRelativePath(requested) ? requested : '';
	while (path && model.entries.get(path)?.type !== 'directory') path = parentPath(path);
	return path;
}

export function explorerBreadcrumbs(directory: string) {
	const result = [{ path: '', name: '/workspace' }];
	if (!isRelativePath(directory)) return result;
	const parts = directory.split('/');
	for (let index = 0; index < parts.length; index++)
		result.push({ path: parts.slice(0, index + 1).join('/'), name: parts[index] });
	return result;
}

/** Flatten only expanded branches and retain a single page of rows, even in large workspaces. */
export function visibleExplorerRows(
	model: ExplorerModel,
	directory: string,
	expanded: ReadonlySet<string>,
	requestedOffset = 0
) {
	const root = resolveExplorerDirectory(model, directory);
	const visible: ExplorerRow[] = [];
	const pending = [...(model.children.get(root) ?? [])]
		.reverse()
		.map((entry) => ({ entry, depth: 0 }));
	while (pending.length) {
		const row = pending.pop()!;
		const isExpanded = row.entry.type === 'directory' && expanded.has(row.entry.path);
		visible.push({ ...row, expanded: isExpanded });
		if (isExpanded) {
			const children = model.children.get(row.entry.path) ?? [];
			for (let index = children.length - 1; index >= 0; index--)
				pending.push({ entry: children[index], depth: row.depth + 1 });
		}
	}
	const lastPage =
		Math.max(0, Math.ceil(visible.length / EXPLORER_PAGE_SIZE) - 1) * EXPLORER_PAGE_SIZE;
	const requested =
		Number.isSafeInteger(requestedOffset) && requestedOffset > 0
			? Math.floor(requestedOffset / EXPLORER_PAGE_SIZE) * EXPLORER_PAGE_SIZE
			: 0;
	const offset = Math.min(requested, lastPage);
	const rows = visible.slice(offset, offset + EXPLORER_PAGE_SIZE);
	return {
		rows,
		total: visible.length,
		offset,
		remaining: visible.length - offset - rows.length
	};
}
