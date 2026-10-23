import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app.js';
import Runtime from '../src/runtime.js';
import MemFS from '../../core/src/memfs.js';
import Memory from '../../core/src/memory.js';
import { ProcExit } from '../../core/src/error.js';

vi.mock('../../core/src/wasm.js', () => ({
	DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES: 128 * 1024 * 1024,
	compile: () => new Promise(() => {}),
	readBuffer: () => new Promise(() => {})
}));

afterEach(() => vi.restoreAllMocks());

function fixture() {
	const memfs = new MemFS({ moduleUrl: 'unused', stdin: () => '', stdout: () => {} });
	const memory = new Memory(new WebAssembly.Memory({ initial: 1 }));
	const app = Object.assign(Object.create(App.prototype), {
		memfs,
		mem: memory,
		useJsReadOverlay: true,
		useJsSourceReadOverlay: false,
		trace: vi.fn(),
		nextHandle: 1024,
		nextSyntheticInode: 1,
		syntheticInodes: new Map(),
		syntheticFileHandles: new Set(),
		readFileHandles: new Map(),
		writeFileHandles: new Map(),
		temporaryOutputs: new Set()
	}) as App;
	memfs.exports = { path_filestat_get: vi.fn(() => 44), fd_close: vi.fn(() => 0) };
	function path(value: string) {
		memory.write(128, value);
		return value.length;
	}
	return { app, memfs, memory, path };
}

describe('compiler filesystem costs and lifetime', () => {
	it('stats a large overlay without obtaining or copying its bytes, including empty files', () => {
		const { app, memfs, memory, path } = fixture();
		memfs.setFile('header.pch', new Uint8Array(1024 * 1024));
		memfs.setFile('empty.h', new Uint8Array());
		const read = vi.spyOn(memfs, 'getFileContents');
		for (const [name, size] of [
			['header.pch', 1024 * 1024],
			['empty.h', 0]
		] as const) {
			expect(app.path_filestat_get(3, 0, 128, path(name), 256)).toBe(0);
			expect(memory.view.getBigUint64(288, true)).toBe(BigInt(size));
		}
		expect(read).not.toHaveBeenCalled();
	});

	it('keeps an open read snapshot valid after unlink and releases the directory entry', () => {
		const { app, memfs, memory, path } = fixture();
		memfs.setFile('input.h', Uint8Array.of(1, 2, 3));
		expect(app.path_open(3, 0, 128, path('input.h'), 0, 2n, 0n, 0, 256)).toBe(0);
		const fd = memory.read32(256);
		expect(app.path_unlink_file(3, 128, path('input.h'))).toBe(0);
		expect(memfs.hasFile('input.h')).toBe(false);
		expect(() => memfs.getFileContents('input.h')).toThrow(/File not found/);
		memory.write32(0, 512);
		memory.write32(4, 3);
		expect(app.fd_read(fd, 0, 1, 8)).toBe(0);
		expect([...memory.u8.subarray(512, 515)]).toEqual([1, 2, 3]);
		expect(app.fd_close(fd)).toBe(0);
		expect(app.path_unlink_file(3, 128, path('input.h'))).toBe(44);
	});

	it('stats native files by metadata and hides deleted native directory entries', () => {
		const { app, memfs, memory, path } = fixture();
		memfs.mem = memory;
		Object.assign(memfs.exports, {
			GetPathBuf: () => 1024,
			AddFileNode: () => 1,
			GetFileNodeAddress: () => 2048,
			GetFileNodeSize: () => 3,
			FindNode: () => 1
		});
		memfs.addFile('native.h', Uint8Array.of(1, 2, 3));
		const read = vi.spyOn(memfs, 'getFileContents');
		expect(app.path_filestat_get(3, 0, 128, path('native.h'), 256)).toBe(0);
		expect(memory.view.getBigUint64(288, true)).toBe(3n);
		expect(read).not.toHaveBeenCalled();
		memfs.removeFile('native.h');
		expect(app.path_filestat_get(3, 0, 128, path('native.h'), 256)).toBe(44);
		expect(memfs.exports.path_filestat_get).not.toHaveBeenCalled();
		memfs.addFile('native.h', Uint8Array.of(4, 5, 6));
		expect(memfs.isFileDeleted('native.h')).toBe(false);
		expect(memfs.getFileSize('native.h')).toBe(3);
	});

	it('renames outputs without retaining source buffers or changing self-renames', () => {
		const { app, memfs, memory } = fixture();
		memfs.setFile('main-123.o.tmp', Uint8Array.of(1, 2));
		const owned = memfs.getFileContents('main-123.o.tmp');
		memory.write(128, 'main-123.o.tmp');
		memory.write(256, 'main.o');
		expect(app.path_rename(3, 128, 14, 3, 256, 6)).toBe(0);
		expect(memfs.hasFile('main-123.o.tmp')).toBe(false);
		expect([...memfs.getFileContents('main.o')]).toEqual([1, 2]);
		expect(memfs.getFileContents('main.o')).toBe(owned);
		expect(app.path_rename(3, 256, 6, 3, 256, 6)).toBe(0);
		memory.write(128, './main.o');
		expect(app.path_rename(3, 128, 8, 3, 256, 6)).toBe(0);
		expect([...memfs.getFileContents('main.o')]).toEqual([1, 2]);
	});

	it.each([false, true])(
		'retires compiler temporaries when execution fails=%s',
		async (fails) => {
			const { app, memfs } = fixture();
			Object.assign(app, {
				ready: Promise.resolve(),
				argv: ['clang'],
				exports: {
					_start() {
						for (let index = 0; index < 20; index++) {
							const fd = 1024 + index;
							app.syntheticFileHandles.add(fd);
							app.writeFileHandles.set(fd, {
								path: `main-${index.toString(16)}.o.tmp`,
								contents: new Uint8Array(1024),
								position: 1024,
								size: 1024
							});
							app.fd_close(fd);
						}
						if (fails) throw new Error('compiler failed');
						throw new ProcExit(0);
					}
				}
			});
			if (fails) await expect(app.run()).rejects.toThrow('compiler failed');
			else await expect(app.run()).resolves.toBe(false);
			expect((memfs as any).fileOverlays.size).toBe(1);
			expect((memfs as any).filePaths.size).toBe(1);
			expect((memfs as any).deletedFilePaths.size).toBe(0);
			expect(memfs.getFileSize('main.o')).toBe(1024);
		}
	);

	it('uses synthetic file handles for Clang as well as LLD outputs', () => {
		const { app, memfs, memory, path } = fixture();
		app.useJsReadOverlay = false;
		app.useJsSourceReadOverlay = true;
		memfs.exports.path_open = vi.fn(() => {
			throw new Error('native output allocation');
		});
		expect(app.path_open(3, 0, 128, path('main.o'), 1, 64n, 0n, 0, 256)).toBe(0);
		expect(app.syntheticFileHandles.has(memory.read32(256))).toBe(true);
	});

	it('preserves missing-file and exclusive-create errors for compiler writes', () => {
		const { app, memfs, path } = fixture();
		expect(app.path_open(3, 0, 128, path('missing.o'), 0, 64n, 0n, 0, 256)).toBe(44);
		memfs.setFile('existing.o', Uint8Array.of(1));
		expect(app.path_open(3, 0, 128, path('existing.o'), 5, 64n, 0n, 0, 256)).toBe(20);
		expect([...memfs.getFileContents('existing.o')]).toEqual([1]);
	});

	it('does not prepare diagnostics through the real runtime forwarding callback when trace is off', () => {
		const runtime = new Runtime({ runtimeBaseUrl: 'https://example.test/clang', log: false });
		const memory = new Memory(new WebAssembly.Memory({ initial: 1 }));
		runtime.memfs.hostMem = memory;
		runtime.memfs.mem = memory;
		runtime.memfs.setStdinStr('abc');
		memory.write32(0, 64);
		memory.write32(4, 2);
		const decode = vi.spyOn(TextDecoder.prototype, 'decode');
		const read = vi.spyOn(memory, 'readStr');
		runtime.memfs.host_read(0, 0, 1, 32);
		runtime.memfs.memfs_log(64, 2);
		expect(decode).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
		runtime.log = true;
		runtime.debug = true;
		runtime.memfs.memfs_log(64, 2);
		expect(read).toHaveBeenCalledOnce();
	});
});
