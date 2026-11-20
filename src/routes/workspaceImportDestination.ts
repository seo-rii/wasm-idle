import type { WorkspaceFile } from './workspaceCodec';

export class WorkspaceImportCancelled extends Error {
	constructor(message = 'Import cancelled because the workspace changed') {
		super(message);
		this.name = 'WorkspaceImportCancelled';
	}
}

/** Array identity also detects switching away and back to the same language. */
export function captureWorkspaceImportDestination(
	current: () => {
		storageKey?: string;
		language: string;
		files: readonly WorkspaceFile[];
		running?: boolean;
	}
) {
	let destination = current();
	// Keep immutable strings, without copying file bodies, to detect in-place editor changes.
	const initialFiles = destination.files.map(({ path, content, encoding }) => ({
		path,
		content,
		encoding
	}));
	return {
		assertCurrent() {
			const target = current();
			if (target.running)
				throw new WorkspaceImportCancelled(
					'Stop the running program before importing files'
				);
			if (
				target.storageKey !== destination.storageKey ||
				target.language !== destination.language ||
				target.files !== destination.files
			) {
				throw new WorkspaceImportCancelled();
			}
		},
		assertBackupUnedited() {
			this.assertCurrent();
			if (
				destination.files.some((file, index) => {
					const before = initialFiles[index];
					return (
						!before ||
						file.path !== before.path ||
						file.content !== before.content ||
						file.encoding !== before.encoding
					);
				}) ||
				destination.files.length !== initialFiles.length
			)
				throw new WorkspaceImportCancelled();
		},
		advance() {
			destination = current();
		}
	};
}
