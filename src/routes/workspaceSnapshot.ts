import { playgroundLanguages } from './language-registry';
import { readCompilerOptions } from './compilerOptions';
import { isBinaryWorkspaceFile, workspaceFileBytes, type WorkspaceFile } from './workspaceCodec';
import { readWorkspaceDirectories, workspaceParents } from '../lib/container/workspace';
import type { SavedWorkspaceDirectory } from '../lib/container/protocol';
import { normalizeWorkspaceFilePath } from './workspacePath';

function invalid(field: string): never {
	throw new Error(`Invalid workspace snapshot: ${field}`);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
}

function validateWorkspace(
	value: Record<string, unknown>,
	field: string,
	project: unknown,
	directories: ReadonlySet<string>
) {
	if (value.activePath !== undefined && typeof value.activePath !== 'string')
		invalid(`${field}.activePath`);
	if (
		value.openTabs !== undefined &&
		(!Array.isArray(value.openTabs) || value.openTabs.some((tab) => typeof tab !== 'string'))
	)
		invalid(`${field}.openTabs`);
	if (value.files === undefined) return;
	if (!Array.isArray(value.files)) invalid(`${field}.files`);
	const paths = new Set<string>();
	for (const file of value.files) {
		assertRecord(file, `${field}.files[]`);
		if (
			typeof file.path !== 'string' ||
			(file.pathStyle !== 'posix' && !file.path.trim()) ||
			(file.pathStyle !== undefined && file.pathStyle !== 'posix') ||
			typeof file.content !== 'string'
		) {
			invalid(`${field}.files[]`);
		}
		const path = normalizeWorkspaceFilePath(file.path, file.pathStyle);
		if (
			!path ||
			paths.has(path) ||
			(typeof project === 'string' && directories.has(`${project}/${path}`))
		)
			invalid(`${field}.files[].path`);
		paths.add(path);
		if (
			file.encoding !== undefined &&
			file.encoding !== 'utf-8' &&
			file.encoding !== 'data-url'
		) {
			invalid(`${field}.files[].encoding`);
		}
		const workspaceFile: WorkspaceFile = {
			path,
			content: file.content,
			encoding: file.encoding
		};
		if (isBinaryWorkspaceFile(workspaceFile)) {
			try {
				workspaceFileBytes(workspaceFile);
			} catch {
				invalid(`${field}.files[].content`);
			}
		}
	}
}

/** Validate JSON at its boundary, before any editor or language state is replaced. */
export function validateWorkspaceSnapshot(
	value: unknown
): asserts value is Record<string, unknown> {
	assertRecord(value, 'root');
	const directories = new Set<string>();
	for (const entry of readWorkspaceDirectories(value.emptyDirectories, playgroundLanguages)) {
		const path = typeof entry === 'string' ? entry : entry.path;
		directories.add(path);
		for (const parent of workspaceParents(path)) directories.add(parent);
	}
	if (value.files === undefined && value.workspaces === undefined)
		invalid('missing files or workspaces');
	if (
		value.version !== undefined &&
		(typeof value.version !== 'number' ||
			!Number.isInteger(value.version) ||
			value.version < 1 ||
			value.version > 7)
	)
		invalid('version');
	for (const field of ['argsInput', 'language']) {
		if (value[field] !== undefined && typeof value[field] !== 'string') invalid(field);
	}
	for (const field of ['log', 'lspEnabled', 'sidebarOpen']) {
		if (value[field] !== undefined && typeof value[field] !== 'boolean') invalid(field);
	}
	const selections: Record<string, readonly string[]> = {
		cppVersion: ['CPP98', 'CPP03', 'CPP11', 'CPP14', 'CPP17', 'CPP20', 'CPP23', 'CPP26'],
		goTarget: ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'],
		rustTargetTriple: ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'],
		rustOptimizationProfile: ['interactive', 'speed', 'size'],
		ocamlBackend: ['js', 'wasm'],
		ocamlWasmBinaryenMode: ['fast', 'full']
	};
	for (const [field, choices] of Object.entries(selections)) {
		if (
			value[field] !== undefined &&
			(typeof value[field] !== 'string' || !choices.includes(value[field]))
		)
			invalid(field);
	}
	readCompilerOptions(value.compilerOptions);
	validateWorkspace(value, 'workspace', value.language, directories);
	if (value.workspaces === undefined) return;
	assertRecord(value.workspaces, 'workspaces');
	const knownLanguages = new Set<string>(playgroundLanguages);
	if (!Object.keys(value.workspaces).length) invalid('workspaces');
	for (const [language, workspace] of Object.entries(value.workspaces)) {
		if (!knownLanguages.has(language)) invalid(`workspaces.${language}`);
		assertRecord(workspace, `workspaces.${language}`);
		if (workspace.files === undefined) invalid(`workspaces.${language}.files`);
		validateWorkspace(workspace, `workspaces.${language}`, language, directories);
	}
}

export function normalizeWorkspaceTabs(
	value: unknown,
	files: readonly WorkspaceFile[],
	activePath: string
) {
	const validPaths = new Set(files.map((file) => file.path));
	const tabs = Array.isArray(value)
		? value.filter((tab): tab is string => typeof tab === 'string' && validPaths.has(tab))
		: [];
	if (validPaths.has(activePath)) tabs.push(activePath);
	return [...new Set(tabs)];
}

/** Keep the active project's files once in local storage. Portable v6 backups retain their shape. */
export function serializeStoredWorkspace(
	snapshot: Record<string, unknown>,
	emptyDirectories?: readonly SavedWorkspaceDirectory[]
): string {
	if (emptyDirectories?.length) snapshot = { ...snapshot, emptyDirectories };
	const projects = snapshot.workspaces;
	const language = snapshot.language;
	if (
		typeof language !== 'string' ||
		!projects ||
		typeof projects !== 'object' ||
		Array.isArray(projects)
	)
		return JSON.stringify(snapshot);
	const { [language]: active, ...inactive } = projects as Record<string, Record<string, unknown>>;
	if (!active || !Array.isArray(active.files)) return JSON.stringify(snapshot);
	return JSON.stringify({
		...snapshot,
		version: 7,
		activePath: active.activePath ?? snapshot.activePath,
		openTabs: active.openTabs ?? snapshot.openTabs,
		files: active.files,
		workspaces: Object.keys(inactive).length ? inactive : undefined
	});
}

/** Selection and open tabs can legitimately differ between windows showing the same files. */
export function sameWorkspaceContents(left: string | null, right: string | null) {
	if (left === right) return true;
	if (left === null || right === null) return false;
	function contentKey(raw: string) {
		const snapshot: Record<string, unknown> = JSON.parse(raw);
		if (!snapshot || typeof snapshot !== 'object' || (!snapshot.files && !snapshot.workspaces))
			return raw;
		const compact = JSON.parse(serializeStoredWorkspace(snapshot)) as Record<string, unknown>;
		const withoutSelection = (workspace: Record<string, unknown>) => {
			const result = { ...workspace };
			delete result.activePath;
			delete result.openTabs;
			return result;
		};
		const result = withoutSelection(compact);
		if (result.workspaces && typeof result.workspaces === 'object')
			result.workspaces = Object.fromEntries(
				Object.entries(result.workspaces).map(([id, project]) => [
					id,
					withoutSelection(project)
				])
			);
		return JSON.stringify(result);
	}
	try {
		return contentKey(left) === contentKey(right);
	} catch {
		return false;
	}
}
