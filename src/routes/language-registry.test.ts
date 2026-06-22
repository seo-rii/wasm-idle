import { describe, expect, it } from 'vitest';
import {
	clangdLspLanguages,
	compilerDiagnosticLanguages,
	debugLspLanguages,
	defaultLanguageAliases,
	diagnosticMarkerLanguages,
	dotnetLspLanguages,
	dotnetMonacoLspLanguages,
	editorLanguages,
	editorOnlyLanguages,
	languageLabels,
	lspLanguageOverrides,
	playgroundLanguages,
	runtimeLspCapabilities,
	typescriptLspLanguages
} from './language-registry';

describe('language registry', () => {
	it('keeps every playground language wired to a label and editor language', () => {
		expect(new Set(playgroundLanguages).size).toBe(playgroundLanguages.length);

		for (const language of playgroundLanguages) {
			expect(languageLabels[language]).toBeTruthy();
			expect(editorLanguages[language]).toBeTruthy();
		}
	});

	it('keeps LSP language routing metadata explicit', () => {
		expect(debugLspLanguages.has('CPP')).toBe(true);
		expect(clangdLspLanguages.has('C')).toBe(true);
		expect(clangdLspLanguages.has('CPP')).toBe(true);
		expect(dotnetLspLanguages.has('CSHARP')).toBe(true);
		expect(dotnetLspLanguages.has('FSHARP')).toBe(true);
		expect(dotnetLspLanguages.has('VBNET')).toBe(true);
		expect(typescriptLspLanguages.has('JAVASCRIPT')).toBe(true);
		expect(typescriptLspLanguages.has('TYPESCRIPT')).toBe(true);
		expect(lspLanguageOverrides.ASSEMBLYSCRIPT).toBe('assemblyscript');
		expect(lspLanguageOverrides.DUCKDB).toBe('duckdb');
	});

	it('keeps runtime-backed LSP capabilities aligned with editor-only languages', () => {
		expect(runtimeLspCapabilities.RUST).toBe('rust');
		expect(runtimeLspCapabilities.GO).toBe('go');
		expect(runtimeLspCapabilities.SQLITE).toBe('sql');
		expect(runtimeLspCapabilities.PROLOG).toBe('prolog');
		expect(runtimeLspCapabilities.RUBY).toBe('ruby');
		expect(editorOnlyLanguages.has('FORTRAN')).toBe(true);
		expect(editorOnlyLanguages.has('GRAPHQL')).toBe(true);
		expect(editorOnlyLanguages.has('DUCKDB')).toBe(true);
	});

	it('keeps Monaco-specific aliases and marker languages centralized', () => {
		expect(dotnetMonacoLspLanguages.csharp).toBe('csharp');
		expect(dotnetMonacoLspLanguages.fsharp).toBe('fsharp');
		expect(dotnetMonacoLspLanguages.vb).toBe('vbnet');
		expect(defaultLanguageAliases.vb).toBe('vbnet');
		expect(defaultLanguageAliases.sql).toBe('sqlite');
		expect(diagnosticMarkerLanguages.has('cpp')).toBe(true);
		expect(diagnosticMarkerLanguages.has('python')).toBe(true);
	});

	it('keeps compiler diagnostic support visible for compiled languages', () => {
		for (const language of ['D', 'RUST', 'VBNET', 'OCAML', 'ASSEMBLYSCRIPT', 'PHP'] as const) {
			expect(compilerDiagnosticLanguages.has(language)).toBe(true);
		}
	});
});
