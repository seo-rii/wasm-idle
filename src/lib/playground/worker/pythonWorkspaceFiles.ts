import type { PyodideInterface } from 'pyodide';

// Pyodide exposes these helpers; older Emscripten FS declarations omit them.
type WorkspaceFilesystem = PyodideInterface['FS'] & {
	analyzePath(path: string): { exists: boolean };
	mkdirTree(path: string): void;
};

/** Own only supplied files; generated files and directories survive later runs. */
export function createPythonWorkspaceFiles(fs: PyodideInterface['FS']) {
	const workspaceFs = fs as WorkspaceFilesystem;
	const writtenPaths = new Set<string>();
	return (files: { path: string; content: string }[]) => {
		const root = fs.cwd().replace(/\/$/, '');
		const currentPaths = new Set(files.map((file) => `${root}/${file.path}`));
		for (const path of writtenPaths) {
			if (currentPaths.has(path)) continue;
			if (workspaceFs.analyzePath(path).exists) fs.unlink(path);
			writtenPaths.delete(path);
		}
		for (const file of files) {
			const directory = file.path.split('/').slice(0, -1).join('/');
			if (directory) workspaceFs.mkdirTree(directory);
			fs.writeFile(file.path, file.content);
			// Retain ownership even when a later write in this operation fails.
			writtenPaths.add(`${root}/${file.path}`);
		}
	};
}
