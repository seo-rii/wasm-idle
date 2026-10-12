/** Preserve the exact failed input independently; never replace its original storage entry. */
export function preserveUnrestoredWorkspace(
	write: (key: string, value: string) => void,
	storageKey: string,
	snapshot: string
) {
	const recoveryKey = `${storageKey}:recovery:${crypto.randomUUID()}`;
	try {
		write(recoveryKey, snapshot);
		return recoveryKey;
	} catch {
		return null;
	}
}
