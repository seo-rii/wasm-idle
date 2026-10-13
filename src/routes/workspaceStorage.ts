export interface WorkspaceSaveState {
	phase: 'dirty' | 'saving' | 'saved' | 'error';
	revision: number;
	savedRevision: number;
	error: string | null;
}

/** A failed write never advances the saved revision or removes the previous snapshot. */
export function createWorkspaceStorage(
	write: (snapshot: string) => void,
	onChange: (state: WorkspaceSaveState) => void
) {
	let currentSnapshot: string | undefined;
	let currentStorageIdentity: string | undefined;
	let state: WorkspaceSaveState = { phase: 'dirty', revision: 0, savedRevision: -1, error: null };
	function publish(next: Partial<WorkspaceSaveState>) {
		state = { ...state, ...next };
		onChange({ ...state });
	}
	function observe(snapshot: string, storageIdentity = '') {
		const identityChanged = storageIdentity !== currentStorageIdentity;
		if (snapshot === currentSnapshot && !identityChanged) return;
		currentSnapshot = snapshot;
		currentStorageIdentity = storageIdentity;
		publish({
			revision: state.revision + 1,
			phase: identityChanged ? 'dirty' : state.error ? 'error' : 'dirty',
			...(identityChanged ? { savedRevision: -1, error: null } : {})
		});
	}
	return {
		observe,
		getState: () => ({ ...state }),
		save(snapshot: string, storageIdentity = '') {
			observe(snapshot, storageIdentity);
			const revision = state.revision;
			publish({ phase: 'saving' });
			try {
				write(snapshot);
				publish({
					savedRevision: revision,
					phase: state.revision === revision ? 'saved' : 'dirty',
					error: null
				});
				return true;
			} catch (error) {
				publish({
					phase: 'error',
					error: error instanceof Error ? error.message : String(error)
				});
				return false;
			}
		}
	};
}
