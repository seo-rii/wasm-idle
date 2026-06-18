import { describe, expect, it } from 'vitest';

import { getCppLanguageServer } from './server';
import { getCppLanguageServer as packageGetCppLanguageServer } from '@wasm-idle/lsp';

describe('getCppLanguageServer', () => {
	it('re-exports the package clangd server', () => {
		expect(getCppLanguageServer).toBe(packageGetCppLanguageServer);
	});
});
