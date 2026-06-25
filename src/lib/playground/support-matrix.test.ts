// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	renderSupportMatrixSection,
	supportMatrixRows,
	validateSupportMatrix
} from '../../../scripts/support-matrix.mjs';

describe('README support matrix', () => {
	it('is generated from the shared support matrix data', async () => {
		await expect(validateSupportMatrix()).resolves.toBeUndefined();
		expect(renderSupportMatrixSection()).toContain('| Pascal');
		expect(renderSupportMatrixSection()).toContain('| Scheme');
	});

	it('keeps stdin-capable execution languages tied to browser IO coverage', () => {
		const rowsMissingBrowserIo = supportMatrixRows
			.filter((row) => row.stdin !== 'No' && row.stdin !== 'Blocked')
			.filter((row) => !row.browserTest)
			.map((row) => row.language);

		expect(rowsMissingBrowserIo).toEqual([]);
		expect(supportMatrixRows.find((row) => row.language === 'C')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'C++')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'F#')?.stdin).toBe('Blocked');
		expect(supportMatrixRows.find((row) => row.language === 'Fortran')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'Haskell')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'Scheme')?.stdin).toBe('No');
	});
});
