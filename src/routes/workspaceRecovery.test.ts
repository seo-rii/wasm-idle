import { afterEach, describe, expect, it, vi } from 'vitest';
import { preserveUnrestoredWorkspace } from './workspaceRecovery';

const storageKey = 'workspace';
const snapshot = '{ "files": [{"path":"main.cpp","content":"recoverable"}], "openTabs":"broken" }';

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('unrestored workspace preservation', () => {
	it('reuses a backup without rewriting it or the original', () => {
		localStorage.setItem(storageKey, snapshot);
		const write = vi.spyOn(Storage.prototype, 'setItem');
		const key = preserveUnrestoredWorkspace({ storageKey, snapshot });
		expect(key).toMatch(/^workspace:recovery:/);
		expect(preserveUnrestoredWorkspace({ storageKey, snapshot })).toBe(key);
		expect(write).toHaveBeenCalledExactlyOnceWith(key, snapshot);
		expect(localStorage.getItem(storageKey)).toBe(snapshot);
		expect(localStorage.getItem(key!)).toBe(snapshot);
	});

	it('reuses an existing UUID backup in the original workspace even when storage is full', () => {
		const legacyKey = storageKey + ':recovery:c64d824e-179b-49fe-955c-707c99477db4';
		localStorage.setItem(storageKey + ':other:recovery:prior', snapshot);
		localStorage.setItem(legacyKey, snapshot);
		const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('Quota full', 'QuotaExceededError');
		});
		expect(preserveUnrestoredWorkspace({ storageKey, snapshot })).toBe(legacyKey);
		expect(write).not.toHaveBeenCalled();
	});

	it('chooses the same key when two tabs start without a backup', () => {
		const first = preserveUnrestoredWorkspace({ storageKey, snapshot });
		localStorage.clear();
		expect(first).not.toBeNull();
		expect(preserveUnrestoredWorkspace({ storageKey, snapshot })).toBe(first);
	});

	it('keeps distinct UTF-16 inputs and workspace identities separate', () => {
		const entries = [
			{ storageKey, snapshot: '\uD800' },
			{ storageKey, snapshot: '\uFFFD' },
			{ storageKey: storageKey + ':other', snapshot: '\uFFFD' }
		];
		const keys = entries.map(preserveUnrestoredWorkspace);
		expect(new Set(keys).size).toBe(entries.length);
		for (const [index, key] of keys.entries())
			expect(localStorage.getItem(key!)).toBe(entries[index].snapshot);
	});

	it('preserves a mismatched entry occupying the new backup key', () => {
		const key = preserveUnrestoredWorkspace({ storageKey, snapshot })!;
		localStorage.setItem(key, 'different damaged input');
		const backup = preserveUnrestoredWorkspace({ storageKey, snapshot });
		expect(backup).not.toBe(key);
		expect(localStorage.getItem(key)).toBe('different damaged input');
		expect(localStorage.getItem(backup!)).toBe(snapshot);
	});

	it('allows retry after a failed write without changing the original', () => {
		localStorage.setItem(storageKey, snapshot);
		const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
			throw new DOMException('Quota full', 'QuotaExceededError');
		});
		expect(preserveUnrestoredWorkspace({ storageKey, snapshot })).toBeNull();
		expect(write.mock.calls[0][0]).not.toBe(storageKey);
		expect(localStorage.getItem(storageKey)).toBe(snapshot);
		expect(localStorage.length).toBe(1);
		expect(preserveUnrestoredWorkspace({ storageKey, snapshot })).not.toBeNull();
	});

	it('leaves manual recovery available when storage access is denied', () => {
		vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
			throw new DOMException('Storage denied', 'SecurityError');
		});
		expect(preserveUnrestoredWorkspace({ storageKey, snapshot })).toBeNull();
	});
});
