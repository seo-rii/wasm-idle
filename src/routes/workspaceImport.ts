import { parseWorkspaceBackupBytes } from './workspaceBackup';
import { workspaceFileFromBytes, type WorkspaceFile } from './workspaceCodec';
import { assertWorkspaceFileHierarchy, normalizeWorkspaceFilePath } from './workspacePath';

type ImportFile = Pick<File, 'name' | 'arrayBuffer'> & { webkitRelativePath?: string };
export type WorkspaceImportPlan =
	| { kind: 'backup'; backup: Record<string, unknown> }
	| { kind: 'files'; files: WorkspaceFile[]; fromZip: boolean };

/** Read and validate the whole selection before exposing any workspace changes. */
export async function stageWorkspaceImport(
	input: readonly ImportFile[],
	{
		extractZip,
		assertDestination
	}: {
		extractZip: (bytes: Uint8Array) => Promise<WorkspaceFile[]>;
		assertDestination: () => void;
	}
): Promise<WorkspaceImportPlan> {
	const files: WorkspaceFile[] = [];
	const paths = new Set<string>();
	let fromZip = false;
	let backup: Record<string, unknown> | null = null;
	function append(batch: readonly WorkspaceFile[]) {
		for (const file of batch) {
			const path = normalizeWorkspaceFilePath(file.path, file.pathStyle);
			if (!path) throw new Error('Imported file path cannot be empty');
			if (paths.has(path)) throw new Error(`Duplicate imported path: ${path}`);
			paths.add(path);
			files.push({ ...file, path });
		}
	}
	for (const file of input) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		assertDestination();
		const snapshot = parseWorkspaceBackupBytes(bytes);
		if (snapshot) {
			if (input.length !== 1) throw new Error('Import one workspace backup by itself');
			backup = snapshot;
			continue;
		}
		if (file.name.toLowerCase().endsWith('.zip')) {
			const extracted = await extractZip(bytes);
			assertDestination();
			fromZip = true;
			append(extracted);
		} else {
			const path = file.webkitRelativePath || file.name;
			const imported = workspaceFileFromBytes(path, bytes);
			// Native names can contain a backslash, a drive-like prefix, or just whitespace.
			if (path.includes('\\') || /^[a-z]:/iu.test(path) || !path.trim())
				imported.pathStyle = 'posix';
			append([imported]);
		}
	}
	assertDestination();
	assertWorkspaceFileHierarchy(paths);
	return backup ? { kind: 'backup', backup } : { kind: 'files', files, fromZip };
}
