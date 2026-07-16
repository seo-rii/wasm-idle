import { describe, expect, it, vi } from 'vitest';

import {
	GCC_COMPATIBILITY_HEADERS,
	installGccCompatibilityHeaders,
	writeGccCompatibilityHeaders
} from '../src/gcc-compat.js';

const findHeader = (path: string) => {
	const header = GCC_COMPATIBILITY_HEADERS.find((candidate) => candidate.path === path);
	expect(header, `missing compatibility header ${path}`).toBeDefined();
	return header!;
};

describe('GNU compatibility headers', () => {
	it('provides common GNU aggregate and extension headers', () => {
		expect(findHeader('include/setjmp.h').contents).toContain('typedef long jmp_buf');
		expect(findHeader('include/bits/stdc++.h').contents).toContain('#include <iostream>');
		expect(findHeader('include/bits/extc++.h').contents).toContain('#include <bits/stdc++.h>');
		expect(findHeader('include/c++/v1/ext/rope').contents).toContain(
			'typedef rope<char> crope'
		);
		expect(findHeader('include/c++/v1/ext/pb_ds/assoc_container.hpp').contents).toContain(
			'find_by_order'
		);
		expect(findHeader('include/c++/v1/ext/pb_ds/priority_queue.hpp').contents).toContain(
			'class priority_queue'
		);
	});

	it('installs every header into the compiler memfs', () => {
		const memfs = {
			addDirectory: vi.fn(),
			addFile: vi.fn()
		};

		installGccCompatibilityHeaders(memfs);

		expect(memfs.addDirectory).toHaveBeenCalledWith('include/c++/v1/ext/pb_ds');
		expect(memfs.addDirectory).toHaveBeenCalledWith('include/bits');
		for (const header of GCC_COMPATIBILITY_HEADERS) {
			expect(memfs.addFile).toHaveBeenCalledWith(header.path, header.contents);
		}
	});

	it('writes every header below the requested clangd root', () => {
		const fs = {
			mkdirTree: vi.fn(),
			writeFile: vi.fn()
		};

		writeGccCompatibilityHeaders(fs, '/usr/');

		expect(fs.mkdirTree).toHaveBeenCalledWith('/usr/include/c++/v1/ext/pb_ds');
		expect(fs.mkdirTree).toHaveBeenCalledWith('/usr/include/bits');
		for (const header of GCC_COMPATIBILITY_HEADERS) {
			expect(fs.writeFile).toHaveBeenCalledWith(`/usr/${header.path}`, header.contents);
		}
	});
});
