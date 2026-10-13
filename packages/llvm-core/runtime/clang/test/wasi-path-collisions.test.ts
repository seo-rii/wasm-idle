import { Directory, File } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';
import { createBrowserWasiHost } from '../src/browser-execution.js';

describe('public WASI filesystem collision validation', () => {
	it.each([false, true])(
		'rejects file/descendant collisions in either order (reversed=%s)',
		(reversed) => {
			const files = [
				{ path: 'a', contents: 'original' },
				{ path: 'a/b', contents: 'child' }
			];
			if (reversed) files.reverse();
			expect(() => createBrowserWasiHost({ files })).toThrow(
				expect.objectContaining({ code: 'path-prefix-collision' })
			);
		}
	);

	it('checks canonical nested prefixes and duplicate paths before building a tree', () => {
		expect(() =>
			createBrowserWasiHost({
				files: [
					{ path: '/a/./b', contents: 'original' },
					{ path: 'a\\b/c.txt', contents: 'child' }
				]
			})
		).toThrow(expect.objectContaining({ code: 'path-prefix-collision' }));
		expect(() =>
			createBrowserWasiHost({
				files: [
					{ path: 'a.txt', contents: 'first' },
					{ path: './a.txt', contents: 'second' }
				]
			})
		).toThrow(expect.objectContaining({ code: 'duplicate-path' }));
		expect(() => createBrowserWasiHost({ files: [{ path: '/', contents: 'root' }] })).toThrow(
			expect.objectContaining({ code: 'invalid-path' })
		);
	});

	it('preserves sibling files and their contents in a shared directory', () => {
		const host = createBrowserWasiHost({
			files: [
				{ path: 'a/b.txt', contents: 'one' },
				{ path: 'a/c.txt', contents: 'two' }
			]
		});
		const directory = host.rootDirectory.contents.get('a') as Directory;
		expect(directory).toBeInstanceOf(Directory);
		const read = (name: string) =>
			new TextDecoder().decode((directory.contents.get(name) as File).data);
		expect(read('b.txt')).toBe('one');
		expect(read('c.txt')).toBe('two');
	});
});
