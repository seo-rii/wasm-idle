import source from './clang.ts?raw';
import { describe, expect, it } from 'vitest';

describe('Clang worker source', () => {
	it('waits for every compiler runtime module before reporting load completion', () => {
		expect(source).toContain('await clang.ready;');
	});

	it('reports runtime load failures instead of leaving the host waiting', () => {
		expect(source).toMatch(/if \(load\) \{[\s\S]*?try \{[\s\S]*?await loadClang[\s\S]*?catch/);
		expect(source).toContain("error.message || 'Unable to load the C/C++ runtime.'");
	});

	it('reports source compilation separately from runtime loading', () => {
		expect(source).toContain('postProgress(5, `Compiling ${language');
		expect(source).toContain(
			"postProgress(100, `${language === 'C' ? 'C' : 'C++'} program ready`);"
		);
	});
});
