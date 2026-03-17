import pageSource from './+page.svelte?raw';
import source from './Monaco.svelte?raw';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('Monaco route debug sync', () => {
	it('keeps the debug view reactive and applies markers immediately after creation', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/Monaco.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).not.toMatch(/clangdBaseUrl\s*=\s*DEFAULT_CLANGD_BASE_URL/);
		expect(source).toMatch(/let debugView = \$state<MonacoDebugView \| null>\(null\);/);
		expect(source).toMatch(/clangdEnabled\?: boolean;/);
		expect(source).toMatch(/clangdEnabled = false,/);
		expect(source).toMatch(
			/monacoApi\.editor\.setModelMarkers\(activeModel, 'wasm-idle-compiler', markers\);/
		);
		expect(source).toMatch(
			/debugView = new MonacoDebugView\(Monaco, editor, onBreakpointsChange\);\s+debugView\.setBreakpoints\(breakpoints\);\s+debugView\.setPauseState\(pausedLine, debugLocals, debugLanguage\);/s
		);
		expect(source).toMatch(
			/if \(language !== 'cpp' \|\| !editor \|\| !clangdEnabled \|\| !clangdBaseUrl\) \{\s+session\?\.dispose\(\);\s+session = null;\s+clangdStatus = \{ state: 'disabled' \};\s+return;\s+\}/s
		);
		expect(source).toMatch(
			/const \{ ClangdSession \} = await import\('\$lib\/clangd\/session'\);/s
		);
	});

	it('requests clangd only after cpp debug starts', () => {
		expect(() =>
			compile(pageSource, {
				filename: 'src/routes/+page.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(pageSource).toMatch(/clangdRequested = \$state\(false\),/);
		expect(pageSource).toMatch(/if \(debug && language === 'CPP'\) clangdRequested = true;/);
		expect(pageSource).toMatch(/if \(language !== 'CPP'\) clangdRequested = false;/);
		expect(pageSource).toMatch(/clangdEnabled=\{clangdRequested\}/);
	});
});
