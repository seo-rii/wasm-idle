import { describe, expect, it } from 'vitest';
import { mergeContainerWorkspace } from './workspace.js';
const f = (path: string, content: string) => ({ path, content });
describe('container editor reconciliation', () => {
	it('adopts shell creates, writes and deletions when editor revision is unchanged', () => {
		const baseline = [f('main.c', 'before'), f('old.txt', 'remove')];
		expect(
			mergeContainerWorkspace(baseline, baseline, [
				f('main.c', 'after'),
				f('new.txt', 'shell')
			])
		).toEqual({ files: [f('main.c', 'after'), f('new.txt', 'shell')], conflicts: [] });
	});
	it('keeps an unpublished edit while adopting independent terminal changes', () => {
		const baseline = [f('main.c', 'before'), f('note.txt', 'before')];
		expect(
			mergeContainerWorkspace([f('main.c', 'editor'), baseline[1]], baseline, [
				baseline[0],
				f('note.txt', 'shell')
			])
		).toEqual({ files: [f('main.c', 'editor'), f('note.txt', 'shell')], conflicts: [] });
	});
	it('preserves editor bytes and reports a conflicting shell write or unlink', () => {
		const baseline = [f('main.c', 'before')],
			local = [f('main.c', 'editor')];
		for (const remote of [[f('main.c', 'shell')], []])
			expect(mergeContainerWorkspace(local, baseline, remote)).toEqual({
				files: local,
				conflicts: ['main.c']
			});
	});
	it('retains binary encodings and accepts identical concurrent revisions', () => {
		const artifact = {
			path: 'app.wasm',
			content: 'data:application/wasm;base64,AGFzbQ==',
			encoding: 'data-url' as const
		};
		expect(mergeContainerWorkspace([artifact], [], [artifact])).toEqual({
			files: [artifact],
			conflicts: []
		});
	});
	it('accepts only conflicting remote revisions without discarding unrelated editor buffers', () => {
		const baseline = [f('main.c', 'base'), f('notes.txt', 'base'), f('removed.txt', 'base')];
		const local = [
			f('main.c', 'editor'),
			f('notes.txt', 'unsaved'),
			f('removed.txt', 'editor')
		];
		expect(
			mergeContainerWorkspace(local, baseline, [f('main.c', 'shell'), baseline[1]], {
				acceptRemoteConflicts: true
			})
		).toEqual({
			files: [f('main.c', 'shell'), f('notes.txt', 'unsaved')],
			conflicts: ['main.c', 'removed.txt']
		});
	});
});
