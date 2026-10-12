import { describe, expect, it, vi } from 'vitest';
import { preserveUnrestoredWorkspace } from './workspaceRecovery';

describe('unrestored workspace preservation', () => {
	it('retains the exact raw input under an independent recovery key', () => {
		const key = 'workspace';
		const raw =
			'{ "files": [{"path":"main.cpp","content":"recoverable"}], "openTabs":"broken" }';
		const entries = new Map([[key, raw]]);
		const recoveryKey = preserveUnrestoredWorkspace(
			(key, value) => entries.set(key, value),
			key,
			raw
		);
		expect(recoveryKey).not.toBeNull();
		expect(recoveryKey).not.toBe(key);
		expect(entries.get(key)).toBe(raw);
		expect(entries.get(recoveryKey!)).toBe(raw);
	});

	it('reports a failed recovery write without altering the original entry', () => {
		const write = vi.fn((_key: string, _value: string) => {
			throw new DOMException('Quota full', 'QuotaExceededError');
		});
		expect(preserveUnrestoredWorkspace(write, 'workspace', 'original')).toBeNull();
		expect(write).toHaveBeenCalledOnce();
		expect(write.mock.calls[0][0]).not.toBe('workspace');
	});
});
