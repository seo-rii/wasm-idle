import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceStorage } from './workspaceStorage';

describe('workspace persistence revisions', async () => {
	it('retains the previous snapshot and saved revision when quota is exhausted, then retries', async () => {
		let persisted = '';
		let quotaFull = false;
		const onChange = vi.fn();
		const storage = createWorkspaceStorage((snapshot) => {
			if (quotaFull) throw new DOMException('Storage full', 'QuotaExceededError');
			persisted = snapshot;
		}, onChange);
		expect(await storage.save('first')).toBe(true);
		quotaFull = true;
		storage.observe('second');
		expect(storage.getState()).toMatchObject({ phase: 'dirty', revision: 2, savedRevision: 1 });
		expect(await storage.save('second')).toBe(false);
		expect(persisted).toBe('first');
		expect(storage.getState()).toMatchObject({ phase: 'error', revision: 2, savedRevision: 1 });
		storage.observe('third');
		expect(storage.getState().phase).toBe('error');
		quotaFull = false;
		expect(await storage.save('third')).toBe(true);
		expect(persisted).toBe('third');
		expect(storage.getState()).toEqual({
			phase: 'saved',
			revision: 3,
			savedRevision: 3,
			error: null
		});
		expect(onChange.mock.calls.some(([state]) => state.phase === 'saving')).toBe(true);
	});

	it('catches a denied storage getter and preserves a newer edit during a write', async () => {
		const denied = createWorkspaceStorage(
			() => {
				throw new Error('Access denied');
			},
			() => {}
		);
		expect(await denied.save('latest')).toBe(false);
		expect(denied.getState().savedRevision).toBe(-1);
		const storage = createWorkspaceStorage(
			() => storage.observe('newer'),
			() => {}
		);
		expect(await storage.save('older')).toBe(true);
		expect(storage.getState()).toMatchObject({ phase: 'dirty', savedRevision: 1, revision: 2 });
	});
});

describe('workspace changes from other tabs', () => {
	function tabs(initial = 'original') {
		const entries = new Map<string, string>([['workspace', initial]]);
		// Model the exclusive Web Lock shared by all tabs of this origin.
		let pending = Promise.resolve();
		const tab = () =>
			createWorkspaceStorage(
				(snapshot, identity) => {
					entries.set(identity, snapshot);
				},
				() => {},
				{
					read: (identity) => entries.get(identity) ?? null,
					initialStorageIdentity: 'workspace',
					initialSnapshot: initial,
					withLock: (_identity, write) => {
						const result = pending.then(write);
						pending = result.then(() => undefined);
						return result;
					}
				}
			);
		return { entries, first: tab(), second: tab() };
	}

	it('preserves the winning snapshot and both tab buffers during simultaneous saves', async () => {
		const { entries, first, second } = tabs();
		const results = await Promise.all([
			first.save('new source', 'workspace'),
			second.save('old source, new args', 'workspace')
		]);
		expect(results).toEqual([true, false]);
		expect(entries.get('workspace')).toBe('new source');
		expect(second.getState()).toMatchObject({ phase: 'conflict', savedRevision: -1 });
		// Retrying or continuing to type cannot silently accept the remote version.
		expect(await second.save('more local changes', 'workspace')).toBe(false);
		expect(entries.get('workspace')).toBe('new source');
		expect(await second.save('more local changes', 'separate-copy')).toBe(true);
		expect(entries.get('separate-copy')).toBe('more local changes');
		expect(entries.get('workspace')).toBe('new source');
	});

	it('detects a change between initial restoration and the first autosave', async () => {
		const { entries, first, second } = tabs('  original snapshot  ');
		expect(await first.save('new source', 'workspace')).toBe(true);
		expect(await second.save('normalized original snapshot', 'workspace')).toBe(false);
		expect(entries.get('workspace')).toBe('new source');
	});

	it('invalidates the saved indicator when another tab changes or deletes its snapshot', async () => {
		const { entries, first, second } = tabs();
		expect(await second.save('original', 'workspace')).toBe(true);
		expect(await first.save('new source', 'workspace')).toBe(true);
		second.checkExternalChanges('unrelated-workspace');
		expect(second.getState().phase).toBe('saved');
		second.checkExternalChanges('workspace');
		expect(second.getState().phase).toBe('conflict');
		entries.delete('workspace');
		expect(await first.save('newer source', 'workspace')).toBe(false);
		expect(entries.has('workspace')).toBe(false);
	});

	it('accepts identical writes without reporting a conflict', async () => {
		const { first, second } = tabs();
		expect(
			await Promise.all([first.save('same', 'workspace'), second.save('same', 'workspace')])
		).toEqual([true, true]);
		expect(second.getState().phase).toBe('saved');
	});

	it('discards queued stale saves and never writes them under a new identity', async () => {
		const { entries, first } = tabs();
		const stale = first.save('stale', 'workspace');
		const latest = first.save('latest', 'separate-copy');
		expect(await stale).toBe(false);
		expect(await latest).toBe(true);
		expect(entries.get('workspace')).toBe('original');
		expect(entries.get('separate-copy')).toBe('latest');
	});

	it('reports failed reads and lock requests without overwriting storage', async () => {
		const write = vi.fn();
		const read = vi.fn((): string | null => {
			throw new Error('Read denied');
		});
		const settings = { read, initialStorageIdentity: 'workspace', initialSnapshot: null };
		const first = createWorkspaceStorage(write, () => {}, settings);
		expect(await first.save('local', 'workspace')).toBe(false);
		expect(first.getState()).toMatchObject({ phase: 'error', error: 'Read denied' });
		const second = createWorkspaceStorage(write, () => {}, {
			...settings,
			withLock: async () => {
				throw new Error('Lock denied');
			}
		});
		expect(await second.save('local', 'workspace')).toBe(false);
		expect(second.getState()).toMatchObject({ phase: 'error', error: 'Lock denied' });
		expect(write).not.toHaveBeenCalled();
	});
});
