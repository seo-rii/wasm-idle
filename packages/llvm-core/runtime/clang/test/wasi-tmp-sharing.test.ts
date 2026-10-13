import { Directory, wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';
import { createBrowserWasiHost, executeBrowserClangArtifact } from '../src/browser-execution.js';

function unsigned(value: number): number[] {
	const bytes: number[] = [];
	do {
		const next = value & 127;
		value >>>= 7;
		bytes.push(next | (value ? 128 : 0));
	} while (value);
	return bytes;
}

function signed(value: number): number[] {
	const bytes: number[] = [];
	while (true) {
		const next = value & 127;
		value >>= 7;
		const end = (value === 0 && !(next & 64)) || (value === -1 && !!(next & 64));
		bytes.push(next | (end ? 0 : 128));
		if (end) return bytes;
	}
}

const string = (value: string) => {
	const bytes = Array.from(new TextEncoder().encode(value));
	return [...unsigned(bytes.length), ...bytes];
};
const section = (id: number, bytes: number[]) => [id, ...unsigned(bytes.length), ...bytes];
const i32 = (value: number) => [0x41, ...signed(value)];
const i64 = (value: number) => [0x42, ...signed(value)];
const open = (fd: number, pointer: number, length: number) => [
	...i32(fd),
	...i32(0),
	...i32(pointer),
	...i32(length),
	...i32(0),
	...i64(Number(wasi.RIGHTS_FD_READ)),
	...i64(0),
	...i32(0),
	...i32(48),
	0x10,
	0,
	0x10,
	1
];
// A real WASI guest opens the same supplied file through each preopen and reports errno.
const body = [0, ...open(3, 0, 9), ...open(4, 16, 13), 0x0b];
const bytes = Uint8Array.from([
	0,
	97,
	115,
	109,
	1,
	0,
	0,
	0,
	...section(
		1,
		[
			3, 0x60, 9, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7e, 0x7e, 0x7f, 0x7f, 1, 0x7f, 0x60, 1,
			0x7f, 0, 0x60, 0, 0
		]
	),
	...section(2, [
		2,
		...string('wasi_snapshot_preview1'),
		...string('path_open'),
		0,
		0,
		...string('probe'),
		...string('result'),
		0,
		1
	]),
	...section(3, [1, 2]),
	...section(5, [1, 0, 1]),
	...section(7, [2, ...string('memory'), 2, 0, ...string('_start'), 0, 2]),
	...section(10, [1, ...unsigned(body.length), ...body]),
	...section(11, [
		2,
		0,
		...i32(0),
		0x0b,
		...string('input.txt'),
		0,
		...i32(16),
		0x0b,
		...string('tmp/input.txt')
	])
]);

describe('shared WASI temporary directory', () => {
	it.each([false, true])(
		'shares the tmp inode across preopens with supplied files=%s',
		(supplied) => {
			const host = createBrowserWasiHost({
				files: supplied ? [{ path: 'tmp/nested/input.txt', contents: 'input' }] : []
			});
			const fromTmp = host.fds[3].fd_filestat_get();
			const fromRoot = host.fds[4].path_filestat_get(0, 'tmp');
			expect(fromTmp.ret).toBe(wasi.ERRNO_SUCCESS);
			expect(fromRoot.ret).toBe(wasi.ERRNO_SUCCESS);
			expect(fromTmp.filestat!.ino).toBe(fromRoot.filestat!.ino);
			expect(host.fds[3].fd_readdir_single(0n).dirent!.d_ino).toBe(fromRoot.filestat!.ino);
			expect(host.fds[3].fd_readdir_single(1n).dirent!.d_ino).toBe(
				host.fds[4].fd_filestat_get().filestat!.ino
			);
		}
	);

	it('reports the shared tmp inode as the parent of supplied nested directories', () => {
		const host = createBrowserWasiHost({
			files: [{ path: 'tmp/nested/input.txt', contents: 'input' }]
		});
		const tmpInode = host.fds[4].path_filestat_get(0, 'tmp').filestat!.ino;
		for (const [fd, path] of [
			[3, 'nested'],
			[4, 'tmp/nested']
		] as const) {
			const nested = host.fds[fd].path_open(0, path, wasi.OFLAGS_DIRECTORY, 0n, 0n, 0);
			expect(nested.ret).toBe(wasi.ERRNO_SUCCESS);
			expect(nested.fd_obj!.fd_readdir_single(1n).dirent!.d_ino).toBe(tmpInode);
		}
	});

	it('makes supplied tmp files visible through both preopens to an actual Wasm guest', async () => {
		expect(WebAssembly.validate(bytes)).toBe(true);
		const results: number[] = [];
		const result = await executeBrowserClangArtifact(
			{
				bytes,
				language: 'C',
				target: 'wasm32-wasi',
				format: 'wasi-core-wasm'
			},
			{
				files: [{ path: 'tmp/input.txt', contents: 'provided workspace file' }],
				extraImports: { probe: { result: (errno: number) => results.push(errno) } }
			}
		);
		expect(result.exitCode).toBe(0);
		expect(results).toEqual([wasi.ERRNO_SUCCESS, wasi.ERRNO_SUCCESS]);
	});

	it('shares files created through tmp with root even without supplied tmp files', () => {
		const host = createBrowserWasiHost();
		expect(host.rootDirectory.contents.get('tmp')).toBeInstanceOf(Directory);
		const created = host.fds[3].path_open(
			0,
			'generated.txt',
			wasi.OFLAGS_CREAT,
			BigInt(wasi.RIGHTS_FD_WRITE),
			0n,
			0
		);
		expect(created.ret).toBe(wasi.ERRNO_SUCCESS);
		created.fd_obj!.fd_write(new TextEncoder().encode('generated'));
		const opened = host.fds[4].path_open(
			0,
			'tmp/generated.txt',
			0,
			BigInt(wasi.RIGHTS_FD_READ),
			0n,
			0
		);
		expect(opened.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(new TextDecoder().decode(opened.fd_obj!.fd_read(100).data)).toBe('generated');
	});

	it('shares nested supplied files and removals across both preopens', () => {
		const host = createBrowserWasiHost({
			files: [{ path: 'tmp/nested/input.txt', contents: 'input' }]
		});
		expect(
			host.fds[3].path_open(0, 'nested/input.txt', 0, BigInt(wasi.RIGHTS_FD_READ), 0n, 0).ret
		).toBe(wasi.ERRNO_SUCCESS);
		expect(host.fds[4].path_unlink_file('tmp/nested/input.txt')).toBe(wasi.ERRNO_SUCCESS);
		expect(
			host.fds[3].path_open(0, 'nested/input.txt', 0, BigInt(wasi.RIGHTS_FD_READ), 0n, 0).ret
		).toBe(wasi.ERRNO_NOENT);
	});

	it.each(['tmp', '/tmp', './tmp', '/./tmp'])(
		'rejects a file replacing the tmp preopen: %s',
		(path) => {
			expect(() =>
				createBrowserWasiHost({ files: [{ path, contents: 'keep this file' }] })
			).toThrow(expect.objectContaining({ code: 'path-prefix-collision', path: '/tmp' }));
		}
	);
});
