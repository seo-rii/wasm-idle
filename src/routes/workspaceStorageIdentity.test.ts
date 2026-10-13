import { describe, expect, it } from 'vitest';
import { createWorkspaceStorage } from './workspaceStorage';

describe('workspace storage identity', () => {
	it('requires an independent write when unchanged content moves to another workspace', () => {
		let identity = 'first';
		const entries = new Map<string, string>();
		const storage = createWorkspaceStorage(
			(snapshot) => entries.set(identity, snapshot),
			() => {}
		);
		expect(storage.save('same contents', identity)).toBe(true);
		const savedRevision = storage.getState().savedRevision;
		identity = 'second';
		storage.observe('same contents', identity);
		expect(storage.getState()).toMatchObject({ phase: 'dirty', savedRevision: -1 });
		expect(storage.getState().revision).toBeGreaterThan(savedRevision);
		expect(entries.has(identity)).toBe(false);
		expect(storage.save('same contents', identity)).toBe(true);
		expect(entries.get('first')).toBe('same contents');
		expect(entries.get('second')).toBe('same contents');
		expect(storage.getState().phase).toBe('saved');
	});

	it('does not inherit another workspace save failure or advance a failed new save', () => {
		let fail = true;
		const storage = createWorkspaceStorage(
			() => {
				if (fail) throw new Error('Quota full');
			},
			() => {}
		);
		expect(storage.save('contents', 'first')).toBe(false);
		storage.observe('contents', 'second');
		expect(storage.getState()).toMatchObject({
			phase: 'dirty',
			savedRevision: -1,
			error: null
		});
		expect(storage.save('contents', 'second')).toBe(false);
		expect(storage.getState()).toMatchObject({ phase: 'error', savedRevision: -1 });
		fail = false;
		expect(storage.save('contents', 'second')).toBe(true);
		expect(storage.getState().phase).toBe('saved');
	});
});
