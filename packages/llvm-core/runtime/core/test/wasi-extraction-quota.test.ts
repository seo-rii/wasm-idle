import {
	ConsoleStdout,
	File,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';

import {
	installWasiExtractionQuota,
	type WasiExtractionQuotaOptions
} from '../src/wasi-extraction-quota.js';

const PATH_POINTER = 0;
const OPENED_FD_POINTER = 256;
const IOV_POINTER = 264;
const NWRITTEN_POINTER = 272;
const DATA_POINTER = 512;

function createHarness(options: WasiExtractionQuotaOptions) {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const rootfs = new PreopenDirectory('/', new Map());
	const runtime = new WASI(
		[],
		[],
		[
			new OpenFile(new File([], { readonly: true })),
			new ConsoleStdout(() => {}),
			new ConsoleStdout(() => {}),
			rootfs
		]
	);
	runtime.inst = { exports: { memory } };
	const quota = installWasiExtractionQuota(runtime, options);
	const view = new DataView(memory.buffer);
	const bytes = new Uint8Array(memory.buffer);

	const writePathBytes = (encoded: Uint8Array, pointer: number) => {
		bytes.fill(0, pointer, pointer + 128);
		bytes.set(encoded, pointer);
		return encoded.byteLength;
	};

	const openBytes = (pathBytes: Uint8Array, ofFlags = wasi.OFLAGS_CREAT) => {
		const pathLength = writePathBytes(pathBytes, PATH_POINTER);
		const result = runtime.wasiImport.path_open(
			3,
			0,
			PATH_POINTER,
			pathLength,
			ofFlags,
			BigInt(wasi.RIGHTS_FD_WRITE),
			0n,
			0,
			OPENED_FD_POINTER
		);
		return {
			result,
			fd: view.getUint32(OPENED_FD_POINTER, true)
		};
	};
	const open = (path: string, ofFlags = wasi.OFLAGS_CREAT) =>
		openBytes(new TextEncoder().encode(path), ofFlags);

	const rename = (oldPath: string, newPath: string) => {
		const oldPathLength = writePathBytes(new TextEncoder().encode(oldPath), PATH_POINTER);
		const newPathPointer = 128;
		const newPathLength = writePathBytes(new TextEncoder().encode(newPath), newPathPointer);
		return runtime.wasiImport.path_rename(
			3,
			PATH_POINTER,
			oldPathLength,
			3,
			newPathPointer,
			newPathLength
		);
	};

	const write = (fd: number, data: Uint8Array) => {
		bytes.set(data, DATA_POINTER);
		view.setUint32(IOV_POINTER, DATA_POINTER, true);
		view.setUint32(IOV_POINTER + 4, data.byteLength, true);
		return runtime.wasiImport.fd_write(fd, IOV_POINTER, 1, NWRITTEN_POINTER);
	};

	return { quota, rootfs, runtime, open, openBytes, rename, write };
}

describe('installWasiExtractionQuota', () => {
	it('rejects a new path before it exceeds the entry limit', () => {
		const { quota, rootfs, open } = createHarness({
			label: 'test rootfs',
			maxExpandedBytes: 64,
			maxEntries: 1
		});

		expect(open('first').result).toBe(wasi.ERRNO_SUCCESS);
		expect(() => open('second')).toThrow('test rootfs exceeds the 1 entry limit');
		expect(rootfs.dir.contents.has('second')).toBe(false);
		expect(quota.usage).toEqual({ expandedBytes: 0, entries: 1 });
	});

	it('rolls back an entry reservation when the filesystem rejects creation', () => {
		const { quota, open } = createHarness({
			maxExpandedBytes: 64,
			maxEntries: 1
		});

		expect(open('missing/file').result).toBe(wasi.ERRNO_NOENT);
		expect(quota.usage.entries).toBe(0);
		expect(open('file').result).toBe(wasi.ERRNO_SUCCESS);
		expect(quota.usage.entries).toBe(1);
	});

	it('stops writes before allocating beyond the expanded-byte limit', () => {
		const { quota, runtime, open, write } = createHarness({
			label: 'test rootfs',
			maxExpandedBytes: 4,
			maxEntries: 4
		});
		const opened = open('file');

		expect(write(opened.fd, new Uint8Array([1, 2, 3, 4]))).toBe(wasi.ERRNO_SUCCESS);
		expect(() => write(opened.fd, new Uint8Array([5]))).toThrow(
			'test rootfs exceeds the 4 byte expanded-size limit'
		);
		const file = (runtime.fds[opened.fd] as OpenFile).file;
		expect(file.data).toEqual(new Uint8Array([1, 2, 3, 4]));
		expect(quota.usage).toEqual({ expandedBytes: 4, entries: 1 });
	});

	it('covers allocation, resize, and positioned-write growth paths', () => {
		const { runtime, open } = createHarness({
			label: 'test rootfs',
			maxExpandedBytes: 4,
			maxEntries: 4
		});
		const opened = runtime.fds[open('file').fd] as OpenFile;

		expect(() => opened.fd_allocate(0n, 5n)).toThrow('4 byte expanded-size limit');
		expect(() => opened.fd_filestat_set_size(5n)).toThrow('4 byte expanded-size limit');
		expect(() => opened.fd_pwrite(new Uint8Array([1]), 4n)).toThrow(
			'4 byte expanded-size limit'
		);
		expect(opened.file.data.byteLength).toBe(0);
	});

	it('counts externally materialized entries such as symlinks', () => {
		const { quota } = createHarness({
			label: 'test rootfs',
			maxExpandedBytes: 4,
			maxEntries: 1
		});

		quota.recordEntry('first-link');
		expect(() => quota.recordEntry('second-link')).toThrow(
			'test rootfs exceeds the 1 entry limit'
		);
		expect(quota.usage.entries).toBe(1);
	});

	it('rejects unsafe, oversized, and non-UTF-8 paths before filesystem access', () => {
		const { quota, open, openBytes } = createHarness({
			label: 'test rootfs',
			maxExpandedBytes: 64,
			maxEntries: 4,
			maxPathBytes: 16
		});

		expect(open('.', 0).result).toBe(wasi.ERRNO_SUCCESS);
		expect(() => open('.')).toThrow('test rootfs has an unsafe extraction path');
		for (const path of ['/absolute', '../escape', 'dir\\file', 'a\0b', 'a//b', './a']) {
			expect(() => open(path)).toThrow('test rootfs has an unsafe extraction path');
		}
		expect(() => open('ééééééééé')).toThrow('invalid or oversized extraction path');
		expect(() => openBytes(new Uint8Array([0xc3, 0x28]))).toThrow(
			'test rootfs has a non-UTF-8 extraction path'
		);
		expect(() => quota.recordEntry('../link')).toThrow(
			'test rootfs has an unsafe extraction path'
		);
		expect(quota.usage.entries).toBe(0);
	});

	it('confines symlink targets and validates both rename paths', () => {
		const { quota, open, rename } = createHarness({
			label: 'test rootfs',
			maxExpandedBytes: 64,
			maxEntries: 4,
			maxPathBytes: 64
		});

		expect(quota.resolveSymlinkTarget('../target', 'tmp/dir/link')).toBe('tmp/target');
		expect(() => quota.resolveSymlinkTarget('../../escape', 'tmp/link')).toThrow(
			'test rootfs symlink target escapes the extraction root'
		);
		expect(open('source').result).toBe(wasi.ERRNO_SUCCESS);
		expect(() => rename('../source', 'target')).toThrow(
			'test rootfs has an unsafe extraction path'
		);
		expect(() => rename('source', '../target')).toThrow(
			'test rootfs has an unsafe extraction path'
		);
	});

	it('rejects invalid limits before patching the runtime', () => {
		expect(() => createHarness({ maxExpandedBytes: 0 })).toThrow(
			'maxExpandedBytes must be a positive safe integer'
		);
		expect(() => createHarness({ maxEntries: Number.POSITIVE_INFINITY })).toThrow(
			'maxEntries must be a positive safe integer'
		);
		expect(() => createHarness({ maxPathBytes: -1 })).toThrow(
			'maxPathBytes must be a positive safe integer'
		);
	});
});
