// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContainer, type Container } from '@wasm-idle/container';
import { WebsiteRuntimeAdapter } from './runtime-adapter';
const owned: Container[] = [];
afterEach(async () => {
	await Promise.all(owned.splice(0).map((container) => container.dispose()));
});
function fixture() {
	const adapter = new WebsiteRuntimeAdapter({ runtimeAssets: '/wasm-idle/', emit: vi.fn() });
	const container = createContainer({
		adapters: [adapter.adapter],
		commands: adapter.commands,
		maxBytes: 16 * 1024 * 1024
	});
	adapter.attach(container);
	owned.push(container);
	return { adapter, container };
}
const f = (path: string, content: string) => ({ path, content });
const read = (container: Container, path: string) =>
	new TextDecoder().decode(container.fs.readFile(path));
describe('container shared editor input boundary', () => {
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
