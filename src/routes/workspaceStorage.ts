export interface WorkspaceSaveState {
	phase: 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
	revision: number;
	savedRevision: number;
	error: string | null;
}

export type WorkspaceSaveResult = 'saved' | 'superseded' | 'failed';

interface WorkspaceStorageOptions {
	read: (storageIdentity: string) => string | null;
	initialStorageIdentity: string;
	initialSnapshot: string | null;
	sameContents?: (left: string | null, right: string | null) => boolean;
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
	const sameContents = (left: string | null, right: string | null) =>
		left === right || options?.sameContents?.(left, right) === true;
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
	async function saveRevision(
		snapshot: string,
		storageIdentity = ''
	): Promise<WorkspaceSaveResult> {
		observe(snapshot, storageIdentity);
		const revision = state.revision;
		const isCurrent = () =>
			currentStorageIdentity === storageIdentity && state.revision === revision;
		publish({ phase: 'saving', error: null });
		try {
			let superseded = false;
			const persist = () => {
				// A queued save belongs to the snapshot and identity captured at invocation.
				if (!isCurrent()) {
					superseded = currentStorageIdentity === storageIdentity;
					return false;
				}
				const stored = options?.read(storageIdentity);
				if (
					options &&
					!sameContents(stored ?? null, storedSnapshots.get(storageIdentity) ?? null) &&
					!sameContents(stored ?? null, snapshot)
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
			const saved = options?.withLock
				? await options.withLock(storageIdentity, persist)
				: persist();
			if (saved) return 'saved';
			return superseded ? 'superseded' : 'failed';
		} catch (error) {
			if (isCurrent())
				publish({
					phase: 'error',
					error: error instanceof Error ? error.message : String(error)
				});
			return 'failed';
		}
	}
	return {
		observe,
		/** Seed a fresh, unpublished identity without changing the currently open workspace. */
		createCopy(snapshot: string, storageIdentity: string) {
			if (options && options.read(storageIdentity) !== null)
				throw new Error('The destination workspace already exists');
			write(snapshot, storageIdentity);
			storedSnapshots.set(storageIdentity, snapshot);
		},
		pending() {
			if (state.phase === 'saved' || state.phase === 'saving') {
				publish({ phase: 'dirty', revision: state.revision + 1 });
			}
		},
		fail(error: string) {
			publish({ phase: 'error', savedRevision: -1, error });
		},
		getState: () => ({ ...state }),
		checkExternalChanges(storageIdentity: string) {
			if (!options || storageIdentity !== currentStorageIdentity) return;
			try {
				const stored = options.read(storageIdentity);
				const baseline = storedSnapshots.get(storageIdentity) ?? null;
				if (stored !== baseline) {
					if (sameContents(stored, currentSnapshot ?? null)) {
						storedSnapshots.set(storageIdentity, stored);
						publish({ phase: 'saved', savedRevision: state.revision, error: null });
					} else if (sameContents(stored, baseline)) {
						// A different tab selected another file while this tab has unsaved text.
						storedSnapshots.set(storageIdentity, stored);
					} else conflict();
				}
			} catch (error) {
				publish({ phase: 'error', error: String(error) });
			}
		},
		saveRevision,
		async save(snapshot: string, storageIdentity = '') {
			return (await saveRevision(snapshot, storageIdentity)) === 'saved';
		}
	};
}
