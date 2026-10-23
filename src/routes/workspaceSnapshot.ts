import { playgroundLanguages } from './language-registry';
import { isBinaryWorkspaceFile, workspaceFileBytes, type WorkspaceFile } from './workspaceCodec';
import { normalizeWorkspacePath } from './workspacePath';

function invalid(field: string): never {
	throw new Error(`Invalid workspace snapshot: ${field}`);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
}

function validateWorkspace(value: Record<string, unknown>, field: string) {
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
			!file.path.trim() ||
			typeof file.content !== 'string'
		) {
			invalid(`${field}.files[]`);
		}
		const path = normalizeWorkspacePath(file.path);
		if (!path || paths.has(path)) invalid(`${field}.files[].path`);
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
	if (value.files === undefined && value.workspaces === undefined)
		invalid('missing files or workspaces');
	if (
		value.version !== undefined &&
		(typeof value.version !== 'number' ||
			!Number.isInteger(value.version) ||
			value.version < 1 ||
			value.version > 6)
	)
		invalid('version');
	for (const field of ['argsInput', 'language']) {
		if (value[field] !== undefined && typeof value[field] !== 'string') invalid(field);
	}
	for (const field of ['log', 'lspEnabled', 'sidebarOpen']) {
		if (value[field] !== undefined && typeof value[field] !== 'boolean') invalid(field);
	}
	const selections: Record<string, readonly string[]> = {
		cppVersion: ['CPP03', 'CPP11', 'CPP14', 'CPP17', 'CPP20', 'CPP23', 'CPP26'],
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
	validateWorkspace(value, 'workspace');
	if (value.workspaces === undefined) return;
	assertRecord(value.workspaces, 'workspaces');
	const knownLanguages = new Set<string>(playgroundLanguages);
	if (!Object.keys(value.workspaces).length) invalid('workspaces');
	for (const [language, workspace] of Object.entries(value.workspaces)) {
		if (!knownLanguages.has(language)) invalid(`workspaces.${language}`);
		assertRecord(workspace, `workspaces.${language}`);
		if (workspace.files === undefined) invalid(`workspaces.${language}.files`);
		validateWorkspace(workspace, `workspaces.${language}`);
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
