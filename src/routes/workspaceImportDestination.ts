import type { WorkspaceFile } from './workspaceCodec';

export class WorkspaceImportCancelled extends Error {
	constructor() {
		super('Import cancelled because the workspace changed');
		this.name = 'WorkspaceImportCancelled';
	}
}

/** Array identity also detects switching away and back to the same language. */
export function captureWorkspaceImportDestination(
	current: () => { language: string; files: readonly WorkspaceFile[] }
) {
	let destination = current();
	return {
		assertCurrent() {
			const target = current();
			if (target.language !== destination.language || target.files !== destination.files) {
				throw new WorkspaceImportCancelled();
			}
		},
		advance() {
			destination = current();
		}
	};
}
