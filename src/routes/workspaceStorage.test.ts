import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceStorage } from './workspaceStorage';

describe('workspace persistence revisions', () => {
	it('retains the previous snapshot and saved revision when quota is exhausted, then retries', () => {
		let persisted = '';
		let quotaFull = false;
		const onChange = vi.fn();
		const storage = createWorkspaceStorage((snapshot) => {
			if (quotaFull) throw new DOMException('Storage full', 'QuotaExceededError');
			persisted = snapshot;
		}, onChange);
		expect(storage.save('first')).toBe(true);
		quotaFull = true;
		storage.observe('second');
		expect(storage.getState()).toMatchObject({ phase: 'dirty', revision: 2, savedRevision: 1 });
		expect(storage.save('second')).toBe(false);
		expect(persisted).toBe('first');
		expect(storage.getState()).toMatchObject({ phase: 'error', revision: 2, savedRevision: 1 });
		storage.observe('third');
		expect(storage.getState().phase).toBe('error');
		quotaFull = false;
		expect(storage.save('third')).toBe(true);
		expect(persisted).toBe('third');
		expect(storage.getState()).toEqual({
			phase: 'saved',
			revision: 3,
			savedRevision: 3,
			error: null
		});
		expect(onChange.mock.calls.some(([state]) => state.phase === 'saving')).toBe(true);
	});

	it('catches a denied storage getter and preserves a newer edit during a write', () => {
		const denied = createWorkspaceStorage(
			() => {
				throw new Error('Access denied');
			},
			() => {}
		);
		expect(denied.save('latest')).toBe(false);
		expect(denied.getState().savedRevision).toBe(-1);
		const storage = createWorkspaceStorage(
			() => storage.observe('newer'),
			() => {}
		);
		expect(storage.save('older')).toBe(true);
		expect(storage.getState()).toMatchObject({ phase: 'dirty', savedRevision: 1, revision: 2 });
	});
});
