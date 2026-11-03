import { Fd, File, wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';
import { createGccWasiFilesystem } from '../src/wasi-filesystem.js';

// These exercise the Preview 1 host contract. GCC qualification uses actual compiler bundles.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const readRights = BigInt(wasi.RIGHTS_FD_READ | wasi.RIGHTS_FD_SEEK | wasi.RIGHTS_FD_TELL);
const writeRights = BigInt(
	wasi.RIGHTS_FD_READ |
		wasi.RIGHTS_FD_WRITE |
		wasi.RIGHTS_FD_SEEK |
		wasi.RIGHTS_FD_TELL |
		wasi.RIGHTS_FD_ALLOCATE |
		wasi.RIGHTS_FD_FILESTAT_SET_SIZE
);

function open(directory: Fd, path: string, oflags = 0, rights = writeRights, flags = 0): Fd {
	const result = directory.path_open(0, path, oflags, rights, 0n, flags);
	expect(result.ret).toBe(wasi.ERRNO_SUCCESS);
	if (!result.fd_obj) throw new Error(`Expected an open descriptor for ${path}`);
	return result.fd_obj;
}

function libcMaskedRights(directory: Fd, requested: bigint) {
	const { ret, fdstat } = directory.fd_fdstat_get();
	expect(ret).toBe(wasi.ERRNO_SUCCESS);
	if (!fdstat) throw new Error('Expected directory descriptor metadata');
	expect(fdstat.fs_filetype).toBe(wasi.FILETYPE_DIRECTORY);
	expect(fdstat.fs_rights_base & BigInt(wasi.RIGHTS_PATH_OPEN)).not.toBe(0n);
	// wasi-libc intersects the requested open rights with the parent's advertised rights.
	return requested & fdstat.fs_rights_inherited;
}

function entries(directory: Fd) {
	const found: { name: string; type: number }[] = [];
	let cookie = 0n;
	for (let count = 0; count < 64; count++) {
		const { ret, dirent } = directory.fd_readdir_single(cookie);
		expect(ret).toBe(wasi.ERRNO_SUCCESS);
		if (!dirent) return found;
		expect(dirent.d_next).toBeGreaterThan(cookie);
		found.push({ name: decoder.decode(dirent.dir_name), type: dirent.d_type });
		cookie = dirent.d_next;
	}
	throw new Error('Directory enumeration did not finish');
}

describe('GCC WASI memory filesystem', () => {
	it('exposes no preopens or files by default', () => {
		const filesystem = createGccWasiFilesystem();
		expect(filesystem.fds).toEqual([]);
		expect(filesystem.files()).toEqual([]);
	});

	it('reports guest mount names and a sorted final snapshot including input files', () => {
		const filesystem = createGccWasiFilesystem([
			{ path: '/z', files: [{ path: 'input.bin', contents: new Uint8Array([0, 255]) }] },
			{
				path: '/a',
				directories: ['nested', 'empty'],
				files: [{ path: 'nested/한글.txt', contents: '입력\n' }]
			}
		]);
		expect(filesystem.fds).toHaveLength(2);
		expect(
			filesystem.fds.map((fd) => decoder.decode(fd.fd_prestat_get().prestat!.inner.pr_name))
		).toEqual(['/z', '/a']);
		expect(filesystem.files()).toEqual([
			{ path: '/a/nested/한글.txt', contents: encoder.encode('입력\n') },
			{ path: '/z/input.bin', contents: new Uint8Array([0, 255]) }
		]);
	});

	it('copies input and returned bytes and keeps repeated runs independent', () => {
		const contents = new Uint8Array([0, 127, 255]);
		const preopens = [{ path: '/work', files: [{ path: 'input.bin', contents }] }];
		const first = createGccWasiFilesystem(preopens);
		const second = createGccWasiFilesystem(preopens);
		contents[0] = 42;
		expect(open(first.fds[0], 'input.bin').fd_read(3).data).toEqual(
			new Uint8Array([0, 127, 255])
		);
		expect(open(first.fds[0], 'input.bin').fd_write(new Uint8Array([99])).ret).toBe(0);
		expect(
			open(first.fds[0], 'output.bin', wasi.OFLAGS_CREAT).fd_write(new Uint8Array([254])).ret
		).toBe(0);
		const snapshot = first.files();
		snapshot[0].contents[0] = 12;
		expect(first.files()[0].contents).toEqual(new Uint8Array([99, 127, 255]));
		expect(second.files()).toEqual([
			{ path: '/work/input.bin', contents: new Uint8Array([0, 127, 255]) }
		]);
	});

	it('preserves read and write rights through wasi-libc parent-rights masking', () => {
		const contents = new Uint8Array([0, 127, 255]);
		const filesystem = createGccWasiFilesystem([
			{
				path: '/work',
				files: [
					{ path: 'input.bin', contents },
					{ path: 'nested/input.bin', contents }
				]
			}
		]);
		const root = filesystem.fds[0];
		const nested = open(
			root,
			'nested',
			wasi.OFLAGS_DIRECTORY,
			libcMaskedRights(root, BigInt(wasi.RIGHTS_PATH_OPEN | wasi.RIGHTS_FD_READDIR)),
			wasi.FDFLAGS_NONBLOCK
		);
		for (const directory of [root, nested]) {
			const reader = open(
				directory,
				'input.bin',
				0,
				libcMaskedRights(directory, readRights | BigInt(wasi.RIGHTS_FD_FILESTAT_GET))
			);
			expect(reader.fd_read(3)).toEqual({ ret: 0, data: contents });
			expect(reader.fd_close()).toBe(0);
			const writer = open(
				directory,
				'output.bin',
				wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC,
				libcMaskedRights(directory, writeRights)
			);
			expect(writer.fd_write(contents)).toEqual({ ret: 0, nwritten: 3 });
			expect(writer.fd_close()).toBe(0);
		}
		expect(filesystem.files()).toEqual([
			{ path: '/work/input.bin', contents },
			{ path: '/work/nested/input.bin', contents },
			{ path: '/work/nested/output.bin', contents },
			{ path: '/work/output.bin', contents }
		]);
	});

	it('keeps readonly open rejection after wasi-libc masks requested rights', () => {
		const filesystem = createGccWasiFilesystem([
			{ path: '/readonly', readonly: true, files: [{ path: 'input', contents: 'unchanged' }] }
		]);
		const root = filesystem.fds[0];
		const reader = open(root, 'input', 0, libcMaskedRights(root, readRights));
		expect(reader.fd_read(32)).toEqual({ ret: 0, data: encoder.encode('unchanged') });
		expect(reader.fd_close()).toBe(0);
		const maskedWrite = libcMaskedRights(root, writeRights);
		// r+ has no create/truncate flag, so write permission must survive masking
		// until the mount policy rejects it. Otherwise fopen can silently open read-only.
		expect(root.path_open(0, 'input', 0, maskedWrite, 0n, 0).ret).toBe(wasi.ERRNO_ROFS);
		expect(
			root.path_open(0, 'output', wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC, maskedWrite, 0n, 0)
				.ret
		).toBe(wasi.ERRNO_ROFS);
		expect(filesystem.files()).toEqual([
			{ path: '/readonly/input', contents: encoder.encode('unchanged') }
		]);
	});

	it('preserves binary bytes, positioned I/O, allocation and truncation semantics', () => {
		const filesystem = createGccWasiFilesystem([
			{ path: '/work', files: [{ path: 'data.bin', contents: new Uint8Array([0, 1, 2, 3]) }] }
		]);
		const file = open(filesystem.fds[0], 'data.bin');
		expect(file.fd_read(2)).toEqual({ ret: 0, data: new Uint8Array([0, 1]) });
		expect(file.fd_pwrite(new Uint8Array([254, 255]), 2n)).toEqual({ ret: 0, nwritten: 2 });
		expect(file.fd_tell()).toEqual({ ret: 0, offset: 2n });
		expect(file.fd_pread(4, 0n)).toEqual({ ret: 0, data: new Uint8Array([0, 1, 254, 255]) });
		expect(file.fd_tell().offset).toBe(2n);
		expect(file.fd_allocate(6n, 2n)).toBe(0);
		expect(filesystem.files()[0].contents).toEqual(
			new Uint8Array([0, 1, 254, 255, 0, 0, 0, 0])
		);
		expect(file.fd_filestat_set_size(3n)).toBe(0);
		expect(file.fd_seek(0n, wasi.WHENCE_END)).toEqual({ ret: 0, offset: 3n });
		expect(file.fd_write(new Uint8Array([128]))).toEqual({ ret: 0, nwritten: 1 });
		expect(filesystem.files()).toEqual([
			{ path: '/work/data.bin', contents: new Uint8Array([0, 1, 254, 128]) }
		]);
	});

	it('creates nested files through directory descriptors and enumerates file types', () => {
		const filesystem = createGccWasiFilesystem([{ path: '/work', directories: ['nested'] }]);
		const root = filesystem.fds[0];
		const nested = open(root, 'nested', wasi.OFLAGS_DIRECTORY, readRights);
		expect(nested.path_create_directory('empty')).toBe(0);
		expect(
			open(nested, 'result.bin', wasi.OFLAGS_CREAT).fd_write(new Uint8Array([0, 255])).ret
		).toBe(0);
		expect(root.path_filestat_get(0, 'nested/result.bin').filestat?.size).toBe(2n);
		expect(entries(nested).filter(({ name }) => name !== '.' && name !== '..')).toEqual([
			{ name: 'empty', type: wasi.FILETYPE_DIRECTORY },
			{ name: 'result.bin', type: wasi.FILETYPE_REGULAR_FILE }
		]);
		expect(filesystem.files()).toEqual([
			{ path: '/work/nested/result.bin', contents: new Uint8Array([0, 255]) }
		]);
		expect(nested.path_remove_directory('empty')).toBe(0);
		expect(nested.path_unlink_file('result.bin')).toBe(0);
		expect(filesystem.files()).toEqual([]);
	});

	it('diagnoses missing paths, wrong entry types and exclusive creation', () => {
		const filesystem = createGccWasiFilesystem([
			{ path: '/work', directories: ['dir'], files: [{ path: 'file', contents: 'x' }] }
		]);
		const root = filesystem.fds[0];
		expect(root.path_open(0, 'missing', 0, readRights, 0n, 0)).toEqual({
			ret: wasi.ERRNO_NOENT,
			fd_obj: null
		});
		expect(root.path_open(0, 'absent/file', wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NOENT
		);
		expect(root.path_open(0, 'file', wasi.OFLAGS_DIRECTORY, readRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NOTDIR
		);
		expect(
			root.path_open(0, 'file', wasi.OFLAGS_CREAT | wasi.OFLAGS_EXCL, writeRights, 0n, 0).ret
		).toBe(wasi.ERRNO_EXIST);
		expect(root.path_unlink_file('dir')).toBe(wasi.ERRNO_ISDIR);
		expect(root.path_remove_directory('file')).toBe(wasi.ERRNO_NOTDIR);
		expect(filesystem.files()[0].contents).toEqual(encoder.encode('x'));
	});

	it.each([
		{
			oflags: wasi.OFLAGS_CREAT | wasi.OFLAGS_DIRECTORY,
			rights: writeRights,
			errno: wasi.ERRNO_ISDIR
		},
		{
			oflags: wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC,
			rights: readRights,
			errno: wasi.ERRNO_BADF
		}
	])(
		'does not create an entry or consume quota on invalid open flags %#',
		({ oflags, rights, errno }) => {
			const filesystem = createGccWasiFilesystem([{ path: '/work' }], { maxEntries: 2 });
			const root = filesystem.fds[0];
			expect(root.path_open(0, 'bad', oflags, rights, 0n, 0).ret).toBe(errno);
			expect(root.path_filestat_get(0, 'bad').ret).toBe(wasi.ERRNO_NOENT);
			expect(root.path_create_directory('good')).toBe(0);
		}
	);

	it.each(['../outside', 'nested/../../outside', '/outside'])(
		'rejects guest path escape %s for lookup, creation and removal',
		(path) => {
			const filesystem = createGccWasiFilesystem([
				{ path: '/work', directories: ['nested'] }
			]);
			const root = filesystem.fds[0];
			expect(root.path_open(0, path, wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
				wasi.ERRNO_NOTCAPABLE
			);
			expect(root.path_filestat_get(0, path).ret).toBe(wasi.ERRNO_NOTCAPABLE);
			expect(root.path_create_directory(path)).toBe(wasi.ERRNO_NOTCAPABLE);
			expect(root.path_unlink_file(path)).toBe(wasi.ERRNO_NOTCAPABLE);
			expect(root.path_remove_directory(path)).toBe(wasi.ERRNO_NOTCAPABLE);
			expect(filesystem.files()).toEqual([]);
		}
	);

	it('keeps a nested directory capability from reaching its mount parent', () => {
		const filesystem = createGccWasiFilesystem([
			{
				path: '/work',
				directories: ['nested'],
				files: [{ path: 'secret', contents: 'root only' }]
			}
		]);
		const nested = open(filesystem.fds[0], 'nested', wasi.OFLAGS_DIRECTORY, readRights);
		expect(nested.path_open(0, '../secret', 0, readRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NOTCAPABLE
		);
		expect(nested.path_unlink_file('../secret')).toBe(wasi.ERRNO_NOTCAPABLE);
		expect(filesystem.files()[0].contents).toEqual(encoder.encode('root only'));
	});

	it('normalizes runtime paths within a descriptor while preserving trailing-slash rules', () => {
		const filesystem = createGccWasiFilesystem([
			{ path: '/work', directories: ['nested'], files: [{ path: 'input', contents: 'abc' }] }
		]);
		const root = filesystem.fds[0];
		for (const path of ['./input', 'nested/../input', 'nested//../input']) {
			expect(open(root, path, 0, readRights).fd_read(3).data).toEqual(encoder.encode('abc'));
		}
		expect(root.path_open(0, 'input/', 0, readRights, 0n, 0).ret).toBe(wasi.ERRNO_NOTDIR);
		expect(root.path_open(0, 'nested/', wasi.OFLAGS_DIRECTORY, readRights, 0n, 0).ret).toBe(0);
		for (const path of ['bad\\name', 'bad\0name']) {
			expect(root.path_open(0, path, wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
				wasi.ERRNO_INVAL
			);
		}
		expect(root.path_open(0, 'missing/../input', 0, readRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NOENT
		);
		expect(root.path_open(0, 'input/../input', 0, readRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NOTDIR
		);
	});

	it('applies the guest path limit after resolving dot components', () => {
		const filesystem = createGccWasiFilesystem([{ path: '/work' }], { maxPathBytes: 5 });
		for (const path of ['.', './', '././']) {
			expect(
				filesystem.fds[0].path_open(0, path, wasi.OFLAGS_DIRECTORY, readRights, 0n, 0).ret
			).toBe(0);
		}
	});

	it('treats large unsigned directory cookies as end of directory without throwing', () => {
		const filesystem = createGccWasiFilesystem([{ path: '/work', directories: ['nested'] }]);
		for (const cookie of [-1n, 1n << 63n, (1n << 64n) - 1n]) {
			expect(filesystem.fds[0].fd_readdir_single(cookie)).toEqual({ ret: 0, dirent: null });
		}
	});

	it('enforces readonly policy for every file and directory mutation route', () => {
		const filesystem = createGccWasiFilesystem([
			{
				path: '/readonly',
				readonly: true,
				directories: ['nested', 'empty'],
				files: [{ path: 'nested/input', contents: 'unchanged' }]
			}
		]);
		const root = filesystem.fds[0];
		const nested = open(root, 'nested', wasi.OFLAGS_DIRECTORY, readRights);
		const file = open(nested, 'input', 0, readRights);
		expect(file.fd_read(32).data).toEqual(encoder.encode('unchanged'));
		expect(file.fd_write(encoder.encode('!')).ret).not.toBe(0);
		expect(file.fd_pwrite(encoder.encode('!'), 0n).ret).not.toBe(0);
		expect(file.fd_allocate(0n, 100n)).not.toBe(0);
		expect(file.fd_filestat_set_size(0n)).not.toBe(0);
		for (const directory of [root, nested]) {
			expect(directory.path_open(0, 'new', wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
				wasi.ERRNO_ROFS
			);
			expect(directory.path_create_directory('newdir')).toBe(wasi.ERRNO_ROFS);
			expect(directory.path_link('newlink', new File([1]), false)).not.toBe(0);
		}
		expect(root.path_open(0, 'nested/input', wasi.OFLAGS_TRUNC, readRights, 0n, 0).ret).toBe(
			wasi.ERRNO_ROFS
		);
		expect(root.path_open(0, 'nested/input', 0, writeRights, 0n, 0).ret).toBe(wasi.ERRNO_ROFS);
		expect(root.path_unlink_file('nested/input')).toBe(wasi.ERRNO_ROFS);
		expect(root.path_remove_directory('empty')).toBe(wasi.ERRNO_ROFS);
		expect(root.path_unlink('nested/input').ret).not.toBe(0);
		expect(nested.path_unlink_file('input')).toBe(wasi.ERRNO_ROFS);
		expect(filesystem.files()).toEqual([
			{ path: '/readonly/nested/input', contents: encoder.encode('unchanged') }
		]);
	});

	it('rejects per-file growth through writes, pwrite, allocate and truncate without data loss', () => {
		const filesystem = createGccWasiFilesystem(
			[{ path: '/work', files: [{ path: 'data', contents: 'abc' }] }],
			{ maxFileBytes: 4, maxTotalBytes: 8 }
		);
		const file = open(filesystem.fds[0], 'data');
		expect(file.fd_seek(3n, wasi.WHENCE_SET).ret).toBe(0);
		expect(file.fd_write(encoder.encode('de')).ret).not.toBe(0);
		expect(file.fd_pwrite(encoder.encode('e'), 4n).ret).not.toBe(0);
		expect(file.fd_allocate(0n, 5n)).not.toBe(0);
		expect(file.fd_filestat_set_size(5n)).not.toBe(0);
		expect(file.fd_tell().offset).toBe(3n);
		expect(filesystem.files()[0].contents).toEqual(encoder.encode('abc'));
		expect(file.fd_write(encoder.encode('d'))).toEqual({ ret: 0, nwritten: 1 });
		expect(filesystem.files()[0].contents).toEqual(encoder.encode('abcd'));
	});

	it('shares the total byte quota across mounts and returns capacity after truncation', () => {
		const filesystem = createGccWasiFilesystem(
			[
				{ path: '/a', files: [{ path: 'data', contents: 'abc' }] },
				{ path: '/b', files: [{ path: 'data', contents: 'de' }] }
			],
			{ maxFileBytes: 8, maxTotalBytes: 5 }
		);
		const first = open(filesystem.fds[0], 'data');
		const second = open(filesystem.fds[1], 'data');
		expect(second.fd_pwrite(encoder.encode('f'), 2n).ret).toBe(wasi.ERRNO_NOSPC);
		expect(first.fd_filestat_set_size(2n)).toBe(0);
		expect(second.fd_pwrite(encoder.encode('f'), 2n)).toEqual({ ret: 0, nwritten: 1 });
		expect(filesystem.files().map(({ contents }) => decoder.decode(contents))).toEqual([
			'ab',
			'def'
		]);
	});

	it('bounds directories and files with the same entry quota including mount roots', () => {
		const filesystem = createGccWasiFilesystem([{ path: '/work' }], { maxEntries: 3 });
		const root = filesystem.fds[0];
		expect(root.path_create_directory('dir')).toBe(0);
		const file = open(root, 'data', wasi.OFLAGS_CREAT);
		expect(file.fd_close()).toBe(0);
		expect(root.path_create_directory('overflow')).toBe(wasi.ERRNO_NOSPC);
		expect(root.path_open(0, 'extra', wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NOSPC
		);
		expect(root.path_remove_directory('dir')).toBe(0);
		expect(root.path_create_directory('replacement')).toBe(0);
		expect(() =>
			createGccWasiFilesystem([{ path: '/a' }, { path: '/b' }], { maxEntries: 1 })
		).toThrow();
	});

	it('counts UTF-8 bytes of the full guest path even through nested descriptors', () => {
		const filesystem = createGccWasiFilesystem([{ path: '/w', directories: ['ab'] }], {
			maxPathBytes: 9
		});
		const nested = open(filesystem.fds[0], 'ab', wasi.OFLAGS_DIRECTORY, readRights);
		expect(open(nested, '한', wasi.OFLAGS_CREAT).fd_write(new Uint8Array([1])).ret).toBe(0);
		expect(nested.path_open(0, 'long', wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NAMETOOLONG
		);
		expect(nested.path_create_directory('한글')).toBe(wasi.ERRNO_NAMETOOLONG);
		expect(filesystem.files()[0].path).toBe('/w/ab/한');
		expect(() =>
			createGccWasiFilesystem([{ path: '/w', files: [{ path: '한글', contents: '' }] }], {
				maxPathBytes: 8
			})
		).toThrow();
	});

	it('bounds open descriptors and releases their budget on close', () => {
		const filesystem = createGccWasiFilesystem(
			[{ path: '/work', files: [{ path: 'data', contents: 'abc' }] }],
			{ maxOpenFiles: 2 }
		);
		const root = filesystem.fds[0];
		const file = open(root, 'data');
		expect(root.path_open(0, 'new', wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
			wasi.ERRNO_MFILE
		);
		expect(root.path_open(0, 'data', wasi.OFLAGS_TRUNC, writeRights, 0n, 0).ret).toBe(
			wasi.ERRNO_MFILE
		);
		expect(file.fd_close()).toBe(0);
		expect(file.fd_close()).toBe(wasi.ERRNO_BADF);
		expect(open(root, 'data', 0, readRights).fd_read(3).data).toEqual(encoder.encode('abc'));
		expect(filesystem.files()).toEqual([
			{ path: '/work/data', contents: encoder.encode('abc') }
		]);
		expect(() =>
			createGccWasiFilesystem([{ path: '/a' }, { path: '/b' }], { maxOpenFiles: 1 })
		).toThrow();
	});

	it('retains byte quota for an unlinked open file until its last descriptor closes', () => {
		const filesystem = createGccWasiFilesystem(
			[{ path: '/work', files: [{ path: 'old', contents: 'abcd' }] }],
			{ maxFileBytes: 4, maxTotalBytes: 4 }
		);
		const root = filesystem.fds[0];
		const first = open(root, 'old');
		const second = open(root, 'old');
		expect(root.path_unlink_file('old')).toBe(0);
		expect(filesystem.files()).toEqual([]);
		expect(second.fd_pread(4, 0n).data).toEqual(encoder.encode('abcd'));
		const replacement = open(root, 'new', wasi.OFLAGS_CREAT);
		expect(replacement.fd_write(new Uint8Array([1])).ret).toBe(wasi.ERRNO_NOSPC);
		expect(first.fd_close()).toBe(0);
		expect(replacement.fd_write(new Uint8Array([1])).ret).toBe(wasi.ERRNO_NOSPC);
		expect(second.fd_close()).toBe(0);
		expect(replacement.fd_write(new Uint8Array([1]))).toEqual({ ret: 0, nwritten: 1 });
		expect(filesystem.files()).toEqual([{ path: '/work/new', contents: new Uint8Array([1]) }]);
	});

	it('retains the entry quota of an unlinked open file', () => {
		const filesystem = createGccWasiFilesystem(
			[{ path: '/work', files: [{ path: 'old', contents: '' }] }],
			{ maxEntries: 2 }
		);
		const root = filesystem.fds[0];
		const file = open(root, 'old');
		expect(root.path_unlink_file('old')).toBe(0);
		expect(root.path_open(0, 'new', wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(
			wasi.ERRNO_NOSPC
		);
		expect(file.fd_close()).toBe(0);
		expect(root.path_open(0, 'new', wasi.OFLAGS_CREAT, writeRights, 0n, 0).ret).toBe(0);
	});

	it('rejects unsafe offsets without allocating or corrupting existing data', () => {
		const filesystem = createGccWasiFilesystem([
			{ path: '/work', files: [{ path: 'data', contents: 'abc' }] }
		]);
		const file = open(filesystem.fds[0], 'data');
		for (const offset of [-1n, 1n << 63n]) {
			expect(file.fd_pwrite(new Uint8Array([1]), offset).ret).not.toBe(0);
			expect(file.fd_allocate(offset, 1n)).not.toBe(0);
			expect(file.fd_filestat_set_size(offset)).not.toBe(0);
		}
		expect(filesystem.files()[0].contents).toEqual(encoder.encode('abc'));
	});

	it('rejects link and rename primitives without mutating the filesystem', () => {
		const filesystem = createGccWasiFilesystem([
			{ path: '/work', files: [{ path: 'data', contents: 'abc' }] }
		]);
		const root = filesystem.fds[0];
		expect(root.path_link('alias', new File([1, 2]), false)).toBe(wasi.ERRNO_NOTSUP);
		expect(root.path_unlink('data')).toEqual({ ret: wasi.ERRNO_NOTSUP, inode_obj: null });
		expect(filesystem.files()).toEqual([
			{ path: '/work/data', contents: encoder.encode('abc') }
		]);
	});

	it.each([
		null,
		{},
		'path',
		[null],
		[{ path: '/work', files: {} }],
		[{ path: '/work', directories: 'dir' }]
	])('rejects malformed filesystem declarations %#', (preopens) => {
		expect(() =>
			createGccWasiFilesystem(
				preopens as unknown as Parameters<typeof createGccWasiFilesystem>[0]
			)
		).toThrow();
	});

	it.each([
		[{ path: 'relative' }],
		[{ path: '/trailing/' }],
		[{ path: '/a//b' }],
		[{ path: '/a/../b' }],
		[{ path: '/a/./b' }],
		[{ path: '/a\\b' }],
		[{ path: '/bad\0name' }],
		[{ path: '/a' }, { path: '/a' }],
		[{ path: '/a' }, { path: '/a/b' }],
		[{ path: '/' }, { path: '/a' }],
		[{ path: '/a', readonly: 'yes' }],
		[{ path: '/a', persistent: true }],
		[{ path: '/a', files: [{ path: '../escape', contents: '' }] }],
		[{ path: '/a', files: [{ path: '/absolute', contents: '' }] }],
		[{ path: '/a', files: [{ path: 'data', contents: [1, 2] }] }],
		[{ path: '/a', files: [{ path: 'data', contents: '', mode: 777 }] }],
		[{ path: '/a', directories: ['../escape'] }],
		[{ path: '/a', directories: ['same'], files: [{ path: 'same', contents: '' }] }],
		[
			{
				path: '/a',
				files: [
					{ path: 'same', contents: 'a' },
					{ path: 'same', contents: 'b' }
				]
			}
		]
	])('rejects invalid or ambiguous preopen declarations %j', (...preopens) => {
		expect(() =>
			createGccWasiFilesystem(
				preopens as unknown as Parameters<typeof createGccWasiFilesystem>[0]
			)
		).toThrow();
	});

	it.each([
		{ maxEntries: 0 },
		{ maxFileBytes: -1 },
		{ maxTotalBytes: 1.5 },
		{ maxPathBytes: Number.NaN },
		{ maxOpenFiles: 0 },
		{ maxEntries: Number.MAX_SAFE_INTEGER + 1 },
		{ maxBytes: 1 }
	])('rejects invalid quota declarations %j', (limits) => {
		expect(() =>
			createGccWasiFilesystem(
				[{ path: '/work' }],
				limits as Parameters<typeof createGccWasiFilesystem>[1]
			)
		).toThrow();
	});

	it('accepts limits without opting into preopens', () => {
		const filesystem = createGccWasiFilesystem(undefined, { maxEntries: 2 });
		expect(filesystem.fds).toEqual([]);
		expect(filesystem.files()).toEqual([]);
	});

	it('rejects oversized seeded data before exposing descriptors', () => {
		expect(() =>
			createGccWasiFilesystem(
				[{ path: '/work', files: [{ path: 'data', contents: new Uint8Array(5) }] }],
				{ maxFileBytes: 4 }
			)
		).toThrow();
		expect(() =>
			createGccWasiFilesystem(
				[
					{ path: '/a', files: [{ path: 'data', contents: 'abc' }] },
					{ path: '/b', files: [{ path: 'data', contents: 'def' }] }
				],
				{ maxFileBytes: 8, maxTotalBytes: 5 }
			)
		).toThrow();
	});
});
