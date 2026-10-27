import { describe, expect, it } from 'vitest';
import type { GccFileSystem, GccFileSystemNode } from '../src/module-loader.js';
import { gccSysrootTree, mountGccSysroot } from '../src/sysroot-fs.js';

interface Node extends GccFileSystemNode {
	name: string;
	node_ops: Record<string, (...args: unknown[]) => unknown>;
	stream_ops: Record<string, (...args: unknown[]) => unknown>;
}

class ErrnoError {
	constructor(readonly errno: number) {}
}

/** Minimal Emscripten FS surface; the real FS is exercised by the GCC bundle qualification. */
function mounted(files: Record<string, string>, directories: string[] = []) {
	const created: string[] = [];
	let root: Node | undefined,
		inode = 0;
	const FS = {
		mkdirTree() {},
		ErrnoError,
		createNode(parent: Node | null, name: string, mode: number) {
			created.push(parent ? `${parent.name}/${name}` : name);
			return { id: ++inode, name: parent ? `${parent.name}/${name}` : '', mode } as Node;
		},
		mount(type: { mount(mount: object): GccFileSystemNode }) {
			root = type.mount({}) as Node;
		}
	} as unknown as GccFileSystem;
	const tree = gccSysrootTree(
		new Map(
			Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)])
		),
		directories,
		'/sysroot'
	);
	mountGccSysroot(FS, tree, '/sysroot');
	function lookup(path: string) {
		let node = root!;
		for (const name of path.split('/').filter(Boolean))
			node = node.node_ops.lookup(node, name) as Node;
		return node;
	}
	function errno(action: () => unknown) {
		try {
			action();
		} catch (error) {
			return (error as ErrnoError).errno;
		}
		throw new Error('expected an FS error');
	}
	return { created, lookup, errno };
}

describe('read-only GCC sysroot mount', () => {
	it('creates nodes only for looked-up paths and lists unvisited entries', () => {
		const fs = mounted(
			{
				'/sysroot/usr/include/stdio.h': 'int puts(const char *);',
				'/sysroot/usr/lib/libc.a': '!<arch>\n'
			},
			['/sysroot/usr/share/empty']
		);
		expect(fs.created).toEqual(['/']);
		const include = fs.lookup('usr/include');
		expect(fs.created).toEqual(['/', '/usr', '/usr/include']);
		expect(include.mode).toBe(0o40555);
		expect(include.node_ops.readdir(include)).toEqual(['.', '..', 'stdio.h']);
		const usr = fs.lookup('usr');
		expect((usr.node_ops.readdir(usr) as string[]).sort()).toEqual([
			'.',
			'..',
			'include',
			'lib',
			'share'
		]);
		const empty = fs.lookup('usr/share/empty');
		expect(empty.node_ops.readdir(empty)).toEqual(['.', '..']);
		expect(fs.created).not.toContain('/usr/lib/libc.a');
	});

	it('reads file ranges and seeks within the file size', () => {
		const fs = mounted({ '/sysroot/usr/include/stdio.h': 'abcdef' });
		const file = fs.lookup('usr/include/stdio.h');
		expect(file.mode).toBe(0o100444);
		expect(file.node_ops.getattr(file)).toMatchObject({ size: 6, mode: 0o100444, nlink: 1 });
		const buffer = new Uint8Array(8).fill(255);
		expect(file.stream_ops.read({ node: file }, buffer, 1, 4, 3)).toBe(3);
		expect([...buffer]).toEqual([255, 100, 101, 102, 255, 255, 255, 255]);
		expect(file.stream_ops.read({ node: file }, buffer, 0, 4, 6)).toBe(0);
		expect(file.stream_ops.llseek({ node: file, position: 2 }, 3, 0)).toBe(3);
		expect(file.stream_ops.llseek({ node: file, position: 2 }, 3, 1)).toBe(5);
		expect(file.stream_ops.llseek({ node: file, position: 2 }, -1, 2)).toBe(5);
		expect(fs.errno(() => file.stream_ops.llseek({ node: file, position: 2 }, -3, 1))).toBe(28);
	});

	it('reports missing entries and rejects every mutation', () => {
		const fs = mounted({ '/sysroot/usr/include/stdio.h': '' });
		const include = fs.lookup('usr/include');
		expect(fs.errno(() => fs.lookup('usr/include/missing.h'))).toBe(44);
		for (const operation of ['setattr', 'mknod', 'rename', 'unlink', 'rmdir', 'symlink'])
			expect(fs.errno(() => include.node_ops[operation](include, 'stdio.h'))).toBe(69);
		expect(include.stream_ops.write).toBeUndefined();
		expect(include.stream_ops.mmap).toBeUndefined();
	});
});
