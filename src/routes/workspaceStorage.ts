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
	withLock?: (storageIdentity: string, write: () => boolean) => Promise<boolean>;
}

const serializationError =
	'The current workspace could not be serialized. The saved copy is preserved.';
const isSnapshot = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value !== 'undefined';

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
	function observe(snapshot: string | undefined, storageIdentity = '') {
		const identityChanged = storageIdentity !== currentStorageIdentity;
		if (snapshot === currentSnapshot && !identityChanged) return;
		currentSnapshot = snapshot;
		currentStorageIdentity = storageIdentity;
		const revision = state.revision + 1;
		const savedRevision = identityChanged ? -1 : state.savedRevision;
		if (!isSnapshot(snapshot)) {
			publish({ revision, savedRevision, phase: 'error', error: serializationError });
			return;
		}
		const error = identityChanged || state.error === serializationError ? null : state.error;
		publish({ revision, savedRevision, phase: error ? state.phase : 'dirty', error });
	}
	function conflict() {
		publish({
			phase: 'conflict',
			savedRevision: -1,
			error: 'Another tab changed this workspace. Save a separate copy to keep your edits.'
		});
	}
	async function saveRevision(
		snapshot: string | undefined,
		storageIdentity = ''
	): Promise<WorkspaceSaveResult> {
		observe(snapshot, storageIdentity);
		if (!isSnapshot(snapshot)) return 'failed';
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
		createCopy(snapshot: string | undefined, storageIdentity: string) {
			if (!isSnapshot(snapshot)) throw new Error(serializationError);
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
		saveRevision,
		async save(snapshot: string, storageIdentity = '') {
			return (await saveRevision(snapshot, storageIdentity)) === 'saved';
		}
	};
}
