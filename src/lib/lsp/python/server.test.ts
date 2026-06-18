import { describe, expect, it } from 'vitest';

import { getPythonLanguageServer } from './server';
import { getPythonLanguageServer as packageGetPythonLanguageServer } from '@wasm-idle/lsp';

describe('getPythonLanguageServer', () => {
	it('re-exports the package Python server', () => {
		expect(getPythonLanguageServer).toBe(packageGetPythonLanguageServer);
	});
});
