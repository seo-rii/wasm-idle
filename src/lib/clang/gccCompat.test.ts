import { describe, expect, it, vi } from 'vitest';

import {
	GCC_COMPATIBILITY_HEADERS,
	installGccCompatibilityHeaders,
	writeGccCompatibilityHeaders
} from '$lib/clang/gccCompat';

describe('GNU compatibility headers', () => {
	it('provides PBDS tree and order-statistics headers under the libc++ include root', () => {
		expect(GCC_COMPATIBILITY_HEADERS.map((header) => header.path)).toEqual([
			'include/bits/extc++.h',
			'include/c++/v1/ext/rope',
			'include/c++/v1/ext/pb_ds/tree_policy.hpp',
			'include/c++/v1/ext/pb_ds/assoc_container.hpp',
			'include/c++/v1/ext/pb_ds/hash_policy.hpp',
			'include/c++/v1/ext/pb_ds/priority_queue.hpp'
		]);
		expect(GCC_COMPATIBILITY_HEADERS[3]?.contents).toContain(
			'class tree<Key, null_type, Cmp_Fn, Tag, Node_Update, Allocator>'
		);
		expect(GCC_COMPATIBILITY_HEADERS[1]?.contents).toContain('typedef rope<char> crope');
		expect(GCC_COMPATIBILITY_HEADERS[3]?.contents).toContain('find_by_order');
		expect(GCC_COMPATIBILITY_HEADERS[3]?.contents).toContain('order_of_key');
		expect(GCC_COMPATIBILITY_HEADERS[3]?.contents).toContain('gp_hash_table');
		expect(GCC_COMPATIBILITY_HEADERS[5]?.contents).toContain('class priority_queue');
	});

	it('installs headers into the compiler memfs sysroot', () => {
		const memfs = {
			addDirectory: vi.fn(),
			addFile: vi.fn()
		};

		installGccCompatibilityHeaders(memfs);

		expect(memfs.addDirectory).toHaveBeenCalledWith('include/c++/v1/ext/pb_ds');
		expect(memfs.addFile).toHaveBeenCalledWith(
			'include/c++/v1/ext/pb_ds/tree_policy.hpp',
			expect.stringContaining('tree_order_statistics_node_update')
		);
		expect(memfs.addFile).toHaveBeenCalledWith(
			'include/c++/v1/ext/pb_ds/assoc_container.hpp',
			expect.stringContaining('namespace __gnu_pbds')
		);
	});

	it('writes clangd headers under /usr', () => {
		const fs = {
			mkdirTree: vi.fn(),
			writeFile: vi.fn()
		};

		writeGccCompatibilityHeaders(fs, '/usr');

		expect(fs.mkdirTree).toHaveBeenCalledWith('/usr/include/c++/v1/ext/pb_ds');
		expect(fs.mkdirTree).toHaveBeenCalledWith('/usr/include/bits');
		expect(fs.writeFile).toHaveBeenCalledWith(
			'/usr/include/c++/v1/ext/pb_ds/assoc_container.hpp',
			expect.stringContaining('cc_hash_table')
		);
		expect(fs.writeFile).toHaveBeenCalledWith(
			'/usr/include/c++/v1/ext/rope',
			expect.stringContaining('namespace __gnu_cxx')
		);
	});
});
