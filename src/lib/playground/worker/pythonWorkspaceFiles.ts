import type { WorkspaceFile } from '@wasm-idle/core';
import type { PyodideInterface } from 'pyodide';

// Pyodide exposes these helpers; older Emscripten FS declarations omit them.
type WorkspaceFilesystem = PyodideInterface['FS'] & {
	analyzePath(path: string): { exists: boolean };
};

/** Own only supplied files; generated files and directories survive later runs. */
export function createPythonWorkspaceFiles(fs: PyodideInterface['FS']) {
	const workspaceFs = fs as WorkspaceFilesystem;
	const writtenPaths = new Set<string>();
	const createdDirectories = new Map<string, number>();
	return (files: WorkspaceFile[]) => {
		const root = fs.cwd().replace(/\/$/, '');
		const currentPaths = new Set(files.map((file) => `${root}/${file.path}`));
		for (const path of writtenPaths) {
			if (currentPaths.has(path)) continue;
			// A former input can become a generated directory owned by user code.
			if (workspaceFs.analyzePath(path).exists && !fs.isDir(fs.lstat(path).mode)) {
				fs.unlink(path);
			}
			writtenPaths.delete(path);
		}
		const requiredDirectories = new Set<string>();
		for (const file of files) {
			let parent = root;
			for (const component of file.path.split('/').slice(0, -1)) {
				parent += `/${component}`;
				requiredDirectories.add(parent);
			}
		}
		// A directory created for an input may now need to become a regular file.
		for (const path of [...createdDirectories.keys()].sort((a, b) => b.length - a.length)) {
			const exists = workspaceFs.analyzePath(path).exists;
			if (!exists || fs.lstat(path).ino !== createdDirectories.get(path)) {
				createdDirectories.delete(path);
			} else if (
				path !== root &&
				!requiredDirectories.has(path) &&
				fs.readdir(path).length === 2
			) {
				fs.rmdir(path);
				createdDirectories.delete(path);
			}
		}
		for (const directory of requiredDirectories) {
			if (workspaceFs.analyzePath(directory).exists) continue;
			fs.mkdir(directory);
			createdDirectories.set(directory, fs.lstat(directory).ino);
		}
		for (const file of files) {
			fs.writeFile(file.path, file.content);
			// Retain ownership even when a later write in this operation fails.
			writtenPaths.add(`${root}/${file.path}`);
		}
	};
}
