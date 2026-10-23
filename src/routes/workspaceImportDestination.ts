import type { WorkspaceFile } from './workspaceCodec';

export class WorkspaceImportCancelled extends Error {
	constructor(message = 'Import cancelled because the workspace changed') {
		super(message);
		this.name = 'WorkspaceImportCancelled';
	}
}

/** Array identity also detects switching away and back to the same language. */
export function captureWorkspaceImportDestination(
	current: () => { language: string; files: readonly WorkspaceFile[]; running?: boolean }
) {
	let destination = current();
	return {
		assertCurrent() {
			const target = current();
			if (target.running)
				throw new WorkspaceImportCancelled(
					'Stop the running program before importing files'
				);
			if (target.language !== destination.language || target.files !== destination.files) {
				throw new WorkspaceImportCancelled();
			}
		},
		advance() {
			destination = current();
		}
	};
}
