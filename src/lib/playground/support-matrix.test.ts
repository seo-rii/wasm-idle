// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	blockedCandidateRows,
	renderBlockedCandidatesTable,
	renderSupportMatrixSection,
	supportMatrixRows,
	validateSupportMatrix
} from '../../../scripts/support-matrix.mjs';

describe('README support matrix', () => {
	it('is generated from the shared support matrix data', async () => {
		await expect(validateSupportMatrix()).resolves.toBeUndefined();
		expect(renderSupportMatrixSection()).toContain('| Pascal');
		expect(renderSupportMatrixSection()).toContain('| Scheme');
		expect(renderSupportMatrixSection()).toContain('## Browser LLDB debug runtime');
	});

	it('keeps every execution language tied to real browser coverage', () => {
		const rowsMissingBrowserIo = supportMatrixRows
			.filter((row) => !row.browserTest)
			.map((row) => row.language);

		expect(rowsMissingBrowserIo).toEqual([]);
		expect(supportMatrixRows.find((row) => row.language === 'C')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'C++')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'C')?.debug).toBe('LLDB');
		expect(supportMatrixRows.find((row) => row.language === 'C++')?.debug).toBe('LLDB');
		expect(supportMatrixRows.find((row) => row.language === 'Rust')?.debug).toBe('LLDB');
		expect(supportMatrixRows.find((row) => row.language === 'Objective-C')?.debug).toBe(
			'Trace'
		);
		expect(supportMatrixRows.find((row) => row.language === 'F#')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'Fortran')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'Haskell')?.stdin).toBe('Yes');
		expect(supportMatrixRows.find((row) => row.language === 'Scheme')).toMatchObject({
			stdin: 'Yes',
			browserTest: { language: 'LISP' }
		});
	});

	it('keeps Swift listed only as a blocked candidate until a real browser compiler bundle exists', () => {
		const swiftSupportRow = supportMatrixRows.find((row) => row.ids.includes('SWIFT'));
		const swiftBlockedRow = blockedCandidateRows.find((row) =>
			row.candidateIds.includes('SWIFT')
		);
		const blockedTable = renderBlockedCandidatesTable();
		const fullSection = renderSupportMatrixSection();

		expect(swiftSupportRow).toBeUndefined();
		expect(swiftBlockedRow).toMatchObject({
			language: 'Swift',
			candidateIds: ['SWIFT']
		});
		expect(swiftBlockedRow?.blocker).toContain('real Swift compiler path');
		expect(swiftBlockedRow?.requiredFollowUp).toContain('prove stdin/stdout execution');
		expect(blockedTable).toContain('| Swift');
		expect(blockedTable).toContain('browser-hosted real Swift compiler path');
		expect(fullSection).toContain('### Blocked candidates');
		expect(fullSection).toContain('`SWIFT`');
	});

	it('keeps TinyGo blocked until the upstream compatibility blockers close', () => {
		const tinyGoSupportRow = supportMatrixRows.find((row) => row.ids.includes('TINYGO'));
		const tinyGoBlockedRow = blockedCandidateRows.find((row) =>
			row.candidateIds.includes('TINYGO')
		);
		const blockedTable = renderBlockedCandidatesTable();

		expect(tinyGoSupportRow).toBeUndefined();
		expect(tinyGoBlockedRow).toMatchObject({
			language: 'TinyGo',
			candidateIds: ['TINYGO']
		});
		expect(tinyGoBlockedRow?.currentEvidence).toContain('Go AST-to-C subset');
		expect(tinyGoBlockedRow?.currentEvidence).toContain('45-package');
		expect(tinyGoBlockedRow?.blocker).toContain('Hosted C++');
		expect(tinyGoBlockedRow?.requiredFollowUp).toContain('worker resource limits');
		expect(blockedTable).toContain('| TinyGo');
	});
});
