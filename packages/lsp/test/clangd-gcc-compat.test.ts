import { describe, expect, it } from 'vitest';

import { GCC_COMPATIBILITY_HEADERS } from '@seo-rii/wasm-llvm/runtime/core/gcc-compat';

describe('clangd GCC compatibility integration', () => {
	it('exposes bits/stdc++.h through the shared compatibility package', () => {
		const header = GCC_COMPATIBILITY_HEADERS.find(
			(candidate) => candidate.path === 'include/bits/stdc++.h'
		);

		expect(header?.contents).toContain('#include <iostream>');
	});
});
