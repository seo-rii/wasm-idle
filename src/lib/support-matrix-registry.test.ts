import { supportedLanguageIds } from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

import { readSupportedLanguageIds } from '../../scripts/support-matrix.mjs';

describe('support matrix language registry extraction', () => {
	it('follows the frozen exported registry to its canonical language tuple', async () => {
		expect(await readSupportedLanguageIds()).toEqual([...supportedLanguageIds]);
	});
});
