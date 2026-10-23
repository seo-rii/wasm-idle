export interface WorkspaceSaveState {
	phase: 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
	revision: number;
	savedRevision: number;
	error: string | null;
}

interface WorkspaceStorageOptions {
	read: (storageIdentity: string) => string | null;
	initialStorageIdentity: string;
	initialSnapshot: string | null;
	withLock?: (storageIdentity: string, write: () => boolean) => Promise<boolean>;
}

/** A failed write never advances the saved revision or removes the previous snapshot. */
export function createWorkspaceStorage(
	write: (snapshot: string, storageIdentity: string) => void,
	onChange: (state: WorkspaceSaveState) => void,
	options?: WorkspaceStorageOptions
) {
	let currentSnapshot: string | undefined;
	let currentStorageIdentity: string | undefined;
	const storedSnapshots = new Map<string, string | null>();
	if (options) storedSnapshots.set(options.initialStorageIdentity, options.initialSnapshot);
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
			phase: identityChanged ? 'dirty' : state.error ? state.phase : 'dirty',
			...(identityChanged ? { savedRevision: -1, error: null } : {})
		});
	}
	function conflict() {
		publish({
			phase: 'conflict',
			savedRevision: -1,
			error: 'Another tab changed this workspace. Save a separate copy to keep your edits.'
		});
	}
	return {
		observe,
		getState: () => ({ ...state }),
		checkExternalChanges(storageIdentity: string) {
			if (!options || storageIdentity !== currentStorageIdentity) return;
			try {
				const stored = options.read(storageIdentity);
				if (stored !== (storedSnapshots.get(storageIdentity) ?? null)) {
					if (stored === currentSnapshot) {
						storedSnapshots.set(storageIdentity, stored);
						publish({ phase: 'saved', savedRevision: state.revision, error: null });
					} else conflict();
				}
			} catch (error) {
				publish({ phase: 'error', error: String(error) });
			}
		},
		async save(snapshot: string, storageIdentity = '') {
			observe(snapshot, storageIdentity);
			const revision = state.revision;
			const isCurrent = () =>
				currentStorageIdentity === storageIdentity && state.revision === revision;
			publish({ phase: 'saving', error: null });
			try {
				const persist = () => {
					// A queued save belongs to the snapshot and identity captured at invocation.
					if (!isCurrent()) return false;
					const stored = options?.read(storageIdentity);
					if (
						options &&
						stored !== (storedSnapshots.get(storageIdentity) ?? null) &&
						stored !== snapshot
					) {
						conflict();
						return false;
					}
					if (!options || stored !== snapshot) write(snapshot, storageIdentity);
					storedSnapshots.set(storageIdentity, snapshot);
					if (currentStorageIdentity === storageIdentity)
						publish({
							savedRevision: revision,
							phase: state.revision === revision ? 'saved' : 'dirty',
							error: null
						});
					return true;
				};
				return options?.withLock
					? await options.withLock(storageIdentity, persist)
					: persist();
			} catch (error) {
				if (isCurrent())
					publish({
						phase: 'error',
						error: error instanceof Error ? error.message : String(error)
					});
				return false;
			}
		}
	};
}
