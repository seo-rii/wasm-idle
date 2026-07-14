import { wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';

import { SharedWorkspaceStore } from '../src/shared-workspace.js';

describe('shared rustc workspace', () => {
	it('shares generated files and renames across independent worker stores', () => {
		const buffer = new SharedArrayBuffer(8 * 1024 * 1024);
		const codegenStore = new SharedWorkspaceStore(buffer);
		const linkerStore = new SharedWorkspaceStore(buffer);
		const objectFile = codegenStore.open('work/main.rcgu.o', true)!;
		const objectBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);

		expect(objectFile.write(0, objectBytes)).toBe(true);
		expect(linkerStore.open('work/main.rcgu.o', false)?.snapshot()).toEqual(objectBytes);

		const unlinked = codegenStore.remove('work/main.rcgu.o');
		expect(unlinked?.rename('work/main.renamed.rcgu.o')).toBe(true);
		expect(linkerStore.open('work/main.rcgu.o', false)).toBeNull();
		expect(linkerStore.open('work/main.renamed.rcgu.o', false)?.snapshot()).toEqual(
			objectBytes
		);
	});

	it('reports ENOSPC without exposing a partial oversized write', () => {
		const store = new SharedWorkspaceStore(new SharedArrayBuffer(2 * 1024 * 1024));
		const file = store.open('work/oversized.o', true)!;
		const opened = file.path_open(0);

		expect(opened.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(opened.fd_obj!.fd_write(new Uint8Array(1024 * 1024 + 1))).toEqual({
			ret: wasi.ERRNO_NOSPC,
			nwritten: 0
		});
		expect(file.length).toBe(0);
		expect(store.hasOverflowed()).toBe(true);
	});
});
