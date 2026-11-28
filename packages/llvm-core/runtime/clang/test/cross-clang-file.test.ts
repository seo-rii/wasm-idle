import { File, OpenFile, wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';
import { CompilerOpenFile, takeCompilerOutput } from '../src/cross-clang-file.js';

describe('Clang working files', () => {
	it('amortizes sequential writes and keeps the returned artifact exactly sized', () => {
		const file = new File([]), fd = new CompilerOpenFile(new OpenFile(file));
		const byte = Uint8Array.of(65);
		let copied = 0;
		for (let i = 0; i < 4097; i++) {
			const before = file.data;
			fd.fd_write(byte);
			if (before.buffer !== file.data.buffer) copied += before.length;
		}
		expect(copied).toBeLessThan(2 * file.data.length);
		expect(file.size).toBe(4097n);
		const result = takeCompilerOutput(file);
		expect(result.length).toBe(4097);
		expect(result.every(value => value === 65)).toBe(true);
		expect(result.buffer.byteLength).toBe(result.length);
		const exact = new File([1, 2, 3]);
		expect(takeCompilerOutput(exact)).toBe(exact.data);
		const shared = new File([1, 2, 3], { readonly: true });
		takeCompilerOutput(shared).fill(0);
		expect([...shared.data]).toEqual([1, 2, 3]);
	});

	it('shares truncation, zero-filled growth and positional writes across open descriptors', () => {
		const file = new File([1, 2, 3]);
		const first = new CompilerOpenFile(new OpenFile(file));
		const append = new CompilerOpenFile(file.path_open(0, BigInt(wasi.RIGHTS_FD_WRITE), wasi.FDFLAGS_APPEND).fd_obj);
		expect(append.fd_tell().offset).toBe(3n);
		expect(append.fd_write(Uint8Array.of(4))).toEqual({ ret: 0, nwritten: 1 });
		expect(first.fd_filestat_set_size(1n)).toBe(0);
		expect(append.fd_tell().offset).toBe(4n);
		expect(first.fd_pwrite(Uint8Array.of(9), 3n)).toEqual({ ret: 0, nwritten: 1 });
		expect([...first.fd_read(8).data]).toEqual([1, 0, 0, 9]);
		expect(first.fd_allocate(5n, 2n)).toBe(0);
		expect(first.fd_seek(-2n, wasi.WHENCE_END).offset).toBe(5n);
		expect([...first.fd_read(8).data]).toEqual([0, 0]);
		expect(first.fd_filestat_get().filestat.size).toBe(7n);
		expect(first.fd_pwrite(Uint8Array.of(7), 0xffffffffffffffffn).nwritten).toBe(0);
		expect(append.fd_pwrite(new Uint8Array(), 200n)).toEqual({ ret: 0, nwritten: 0 });
		expect(first.fd_filestat_get().filestat.size).toBe(7n);
	});
});
