// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContainer, type Container } from '@wasm-idle/container';
import { WebsiteRuntimeAdapter } from './runtime-adapter.js';

const owned: Container[] = [];
afterEach(async () => {
	await Promise.all(owned.splice(0).map((container) => container.dispose()));
});
function fixture(limits: { maxBytes?: number; maxInodes?: number } = {}) {
	const adapter = new WebsiteRuntimeAdapter({
		runtimeAssets: '/wasm-idle/',
		emit: vi.fn(),
		createBinding: vi.fn()
	});
	const container = createContainer({
		adapters: [adapter.adapter],
		commands: adapter.commands,
		maxBytes: 16 * 1024 * 1024,
		...limits
	});
	adapter.attach(container);
	owned.push(container);
	return { adapter, container };
}
const f = (path: string, content: string) => ({ path, content });
const read = (container: Container, path: string) =>
	new TextDecoder().decode(container.fs.readFile(path));
describe('container shared editor input boundary', () => {
	it.each([{ maxBytes: 4 }, { maxInodes: 13 }])(
		'preserves the complete namespace when the first publication exceeds %j',
		(limits) => {
			const { adapter, container } = fixture(limits);
			const snapshot = container.fs.exportSnapshot();
			expect(() =>
				adapter.syncWorkspace('C', [f('first', 'a'), f('second', '12345')])
			).toThrow(/quota/);
			expect(container.fs.exportSnapshot()).toEqual(snapshot);
			adapter.syncWorkspace('C', [f('first', 'ok')]);
			expect(read(container, '/workspace/C/first')).toBe('ok');
		}
	);
	it('does not create a language directory before validating the first publication', () => {
		const { adapter, container } = fixture();
		const snapshot = container.fs.exportSnapshot();
		expect(() => adapter.syncWorkspace('C', [f('../escape', 'invalid')])).toThrow();
		expect(container.fs.exportSnapshot()).toEqual(snapshot);
		adapter.syncWorkspace('C', []);
		expect(container.fs.stat('/workspace/C').type).toBe('directory');
	});
	it('preserves every file and published baseline when a batch exceeds the shared byte quota', () => {
		const { adapter, container } = fixture({ maxBytes: 12 });
		const before = [f('old.txt', 'old'), f('first.txt', 'a')];
		adapter.syncWorkspace('C', before);
		const snapshot = container.fs.exportSnapshot();
		expect(() =>
			adapter.syncWorkspace('C', [f('first.txt', 'changed'), f('new.txt', '123456')], before)
		).toThrow(/quota/);
		expect(container.fs.exportSnapshot()).toEqual(snapshot);
		// A retry still compares against the unchanged editor publication.
		adapter.syncWorkspace('C', [f('first.txt', 'changed'), f('new.txt', '12345')], before);
		expect(read(container, '/workspace/C/first.txt')).toBe('changed');
		expect(read(container, '/workspace/C/new.txt')).toBe('12345');
		expect(() => container.fs.stat('/workspace/C/old.txt')).toThrow();
	});
	it('keeps an editor delta intact when another language consumes the shared quota', () => {
		const { adapter, container } = fixture({ maxBytes: 12 });
		const before = [f('main.c', 'a')];
		adapter.syncWorkspace('C', before);
		adapter.syncWorkspace('CPP', [f('other.cpp', '12345678')]);
		const snapshot = container.fs.exportSnapshot();
		expect(() =>
			adapter.syncWorkspace('C', [f('main.c', 'bb'), f('nested/new', 'ccc')], before, [
				{ path: 'main.c', bytes: 2 },
				{ path: 'nested/new', bytes: 3 }
			])
		).toThrow(/quota/);
		expect(container.fs.exportSnapshot()).toEqual(snapshot);
	});
	it('rejects a conflicting editor batch before writing any of its files', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		expect(() =>
			adapter.syncWorkspace('C', [f('new.txt', 'new'), f('main.c', 'editor')], before)
		).toThrow(/changed while editing/);
		expect(read(container, '/workspace/C/main.c')).toBe('shell');
		expect(() => container.fs.stat('/workspace/C/new.txt')).toThrow();
	});
	it('does not overwrite a shell edit when the supplied editor file was unchanged', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		adapter.syncWorkspace('C', [...before, f('added.txt', 'editor')], before);
		expect(read(container, '/workspace/C/main.c')).toBe('shell');
		expect(read(container, '/workspace/C/added.txt')).toBe('editor');
	});
	it('applies a partial publication without reading or deleting untouched file bodies', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base'), f('large.dat', 'large'), f('old', 'remove')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/large.dat', new TextEncoder().encode('shell'));
		container.fs.writeFile('/workspace/C/extra', Uint8Array.of(255));
		const reads = vi.spyOn(container.fs, 'readFile');
		adapter.syncWorkspace(
			'C',
			[f('main.c', 'edit')],
			[before[0], before[2]],
			[
				{ path: 'main.c', bytes: 4 },
				{ path: 'large.dat', bytes: 5 }
			]
		);
		expect(reads.mock.calls.every(([path]) => path !== 'large.dat')).toBe(true);
		expect(read(container, '/workspace/C/main.c')).toBe('edit');
		expect(read(container, '/workspace/C/large.dat')).toBe('shell');
		expect(container.fs.readFile('/workspace/C/extra')).toEqual(Uint8Array.of(255));
		expect(() => container.fs.stat('/workspace/C/old')).toThrow();
		// A later legacy publication still owns all editor paths, not only the last patch.
		adapter.syncWorkspace('C', [f('main.c', 'next')]);
		expect(() => container.fs.stat('/workspace/C/large.dat')).toThrow();
		expect(container.fs.readFile('/workspace/C/extra')).toEqual(Uint8Array.of(255));
	});
	it('rejects a conflicting partial batch before publishing additions or deletions', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base'), f('old', 'remove')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		expect(() =>
			adapter.syncWorkspace('C', [f('new', 'x'), f('main.c', 'edit')], before, [
				{ path: 'main.c', bytes: 4 },
				{ path: 'new', bytes: 1 }
			])
		).toThrow(/changed while editing/);
		expect(() => container.fs.stat('/workspace/C/new')).toThrow();
		expect(read(container, '/workspace/C/old')).toBe('remove');
	});
	it('retains whole-project admission limits and checks delta metadata before writing', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('C', [f('main.c', 'base')]);
		expect(() =>
			adapter.syncWorkspace(
				'C',
				[f('main.c', 'edit')],
				[f('main.c', 'base')],
				[
					{ path: 'main.c', bytes: 4 },
					...Array.from({ length: 4 }, (_, i) => ({
						path: `big${i}`,
						bytes: 16 * 1024 * 1024
					}))
				]
			)
		).toThrow(/total size limit/);
		expect(() =>
			adapter.syncWorkspace(
				'C',
				[f('main.c', 'edit')],
				[f('main.c', 'base')],
				[{ path: 'main.c', bytes: 3 }]
			)
		).toThrow(/size mismatch/);
		expect(() =>
			adapter.syncWorkspace('C', [], [f('main.c', 'base')], [{ path: 'main.c', bytes: 4 }])
		).toThrow(/remains in project/);
		expect(read(container, '/workspace/C/main.c')).toBe('base');
	});
	it('reads only changed file bodies and resets an unknown read cursor', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('C', [f('main.c', 'base'), f('data.bin', 'data')]);
		const first = adapter.readWorkspaceDelta('C');
		expect(first.reset).toBe(true);
		const reads = vi.spyOn(container.fs, 'readFile');
		const unchanged = adapter.readWorkspaceDelta('C', first.revision);
		expect(unchanged).toMatchObject({ reset: false, files: [], deleted: [] });
		expect(reads).not.toHaveBeenCalled();
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		container.fs.rename('/workspace/C/data.bin', '/workspace/C/renamed.bin');
		container.fs.symlink('/workspace', '/workspace/C/loop');
		const changed = adapter.readWorkspaceDelta('C', unchanged.revision);
		expect(changed.files.map(({ path }) => path)).toEqual(['main.c', 'renamed.bin']);
		expect(changed.deleted).toEqual(['data.bin']);
		expect(reads).toHaveBeenCalledTimes(2);
		reads.mockClear();
		const reset = adapter.readWorkspaceDelta('C', first.revision);
		expect(reset.reset).toBe(true);
		expect(reset.files).toHaveLength(2);
		expect(reads).toHaveBeenCalledTimes(2);
	});
	it('preserves unknown shell files while applying an explicit editor deletion', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base'), f('old.txt', 'remove')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/terminal.txt', Uint8Array.of(0, 255, 42));
		adapter.syncWorkspace('C', [before[0]], before);
		expect(container.fs.readFile('/workspace/C/terminal.txt')).toEqual(
			Uint8Array.of(0, 255, 42)
		);
		expect(() => container.fs.stat('/workspace/C/old.txt')).toThrow();
	});
	it('keeps language project roots separate in one namespace and rejects traversal', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('C', [f('main.c', 'c')]);
		adapter.syncWorkspace('CPP', [f('main.c', 'cpp')]);
		expect(read(container, '/workspace/C/main.c')).toBe('c');
		expect(read(container, '/workspace/CPP/main.c')).toBe('cpp');
		expect(() => adapter.syncWorkspace('C', [f('../CPP/main.c', 'escape')])).toThrow();
		expect(read(container, '/workspace/CPP/main.c')).toBe('cpp');
	});
	it('lists files across projects and at the workspace root without following symlinks', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('CPP', [f('hi.txt', '1\n')]);
		adapter.syncWorkspace('BASH', [f('main.sh', 'echo hello')]);
		container.fs.writeFile('/workspace/root.txt', Uint8Array.of(0, 255));
		container.fs.symlink('/workspace', '/workspace/loop');
		container.fs.symlink('/usr', '/workspace/outside');
		const entries = adapter.listWorkspaceFiles();
		expect(entries).toContainEqual({ path: 'CPP/hi.txt', type: 'file', size: 2 });
		expect(entries).toContainEqual({ path: 'BASH/main.sh', type: 'file', size: 10 });
		expect(entries).toContainEqual({ path: 'root.txt', type: 'file', size: 2 });
		expect(
			entries.filter((entry) => entry.type === 'symlink').map((entry) => entry.path)
		).toEqual(['loop', 'outside']);
		expect(
			entries.some(
				(entry) => entry.path.startsWith('outside/') || entry.path.startsWith('loop/')
			)
		).toBe(false);
		expect(entries.every((entry) => !('content' in entry))).toBe(true);
	});
});
