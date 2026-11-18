import { describe, expect, it } from 'vitest';
import { mergeContainerWorkspace } from './workspace.js';
const f = (path: string, content: string) => ({ path, content });
describe('container editor reconciliation', () => {
	it('lets a newly created shell entry replace only a pristine, unpublished starter', () => {
		const defaultFile = f('main.py', 'example');
		const remote = [f('main.py', 'shell'), f('notes', 'new')];
		expect(mergeContainerWorkspace([defaultFile], [], remote, { defaultFile })).toEqual({
			files: remote,
			conflicts: []
		});
		expect(mergeContainerWorkspace([defaultFile], [], [], { defaultFile }).files).toEqual([
			defaultFile
		]);
		expect(
			mergeContainerWorkspace([f('main.py', 'custom')], [], remote, { defaultFile }).conflicts
		).toEqual(['main.py']);
		expect(mergeContainerWorkspace([], [], remote, { defaultFile }).files).toEqual(remote);
	});

	it.each([
		['main.py', 'main.py/note'],
		['src/main.py', 'src']
	])(
		'lets a shell entry at %s or its parent displace only an unpublished starter',
		(starter, shell) => {
			const defaultFile = f(starter, 'example');
			const remote = [f(shell, 'shell bytes')];
			expect(mergeContainerWorkspace([defaultFile], [], remote, { defaultFile })).toEqual({
				files: remote,
				conflicts: []
			});
		}
	);

	it.each([true, false])(
		'keeps competing files and directories out of the same snapshot (local file %j)',
		(localFile) => {
			const file = f('include', 'file contents');
			const children = [f('include/one.h', 'first'), f('include/nested/two.h', 'second')];
			const local = localFile ? [file] : children;
			const remote = localFile ? children : [file];
			const independent = f('notes', 'unpublished editor change');
			const shellOnly = f('output', 'shell output');
			for (const acceptRemoteConflicts of [false, true]) {
				const merged = mergeContainerWorkspace(
					[...local, independent],
					[],
					[...remote, shellOnly],
					{
						acceptRemoteConflicts
					}
				);
				expect(new Set(merged.conflicts)).toEqual(
					new Set([file.path, ...children.map((entry) => entry.path)])
				);
				expect(new Set(merged.files)).toEqual(
					new Set([...(acceptRemoteConflicts ? remote : local), independent, shellOnly])
				);
			}
		}
	);

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
