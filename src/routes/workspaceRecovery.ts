import { toHexString } from 'lib0/buffer';
import { digest } from 'lib0/hash/sha256';

export interface UnrestoredWorkspace {
	storageKey: string;
	snapshot: string;
}

/** Reuse an exact backup, including a legacy UUID entry, without changing the original. */
export function preserveUnrestoredWorkspace({ storageKey, snapshot }: UnrestoredWorkspace) {
	try {
		const storage = localStorage;
		const prefix = `${storageKey}:recovery:`;
		for (const key of Object.keys(storage)) {
			if (key.startsWith(prefix) && storage.getItem(key) === snapshot) return key;
		}

		// Concurrent tabs choose the same key. JSON quoting preserves lone UTF-16 surrogates.
		const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
		const base = prefix + toHexString(digest(bytes));
		let key = base;
		let existing = storage.getItem(key);
		for (let suffix = 1; existing !== null && existing !== snapshot; suffix++) {
			key = `${base}:${suffix}`;
			existing = storage.getItem(key);
		}
		if (existing === null) storage.setItem(key, snapshot);
		return key;
	} catch {
		return null;
	}
}
