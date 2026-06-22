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
		expect(runtimeLspCapabilities.D).toBe('d');
		expect(runtimeLspCapabilities.TCL).toBe('tcl');
		expect(runtimeLspCapabilities.ELIXIR).toBe('elixir');
		expect(runtimeLspCapabilities.ERLANG).toBe('erlang');
		expect(runtimeLspCapabilities.SQLITE).toBe('sql');
		expect(runtimeLspCapabilities.PROLOG).toBe('prolog');
		expect(runtimeLspCapabilities.RUBY).toBe('ruby');
		expect(runtimeLspCapabilities.R).toBe('r');
		expect(runtimeLspCapabilities.OCTAVE).toBe('octave');
		expect(runtimeLspCapabilities.AWK).toBe('awk');
		expect(runtimeLspCapabilities.PERL).toBe('perl');
		expect(runtimeLspCapabilities.WASM).toBe('wasm');
		expect(runtimeLspCapabilities.JANET).toBe('janet');
		expect(runtimeLspCapabilities.LISP).toBe('lisp');
		expect(editorOnlyLanguages.has('FORTRAN')).toBe(true);
		expect(editorOnlyLanguages.has('GRAPHQL')).toBe(true);
		expect(editorOnlyLanguages.has('DUCKDB')).toBe(false);
		for (const language of ['JSON', 'YAML', 'TOML', 'HTML', 'CSS', 'MARKDOWN'] as const) {
			expect(editorOnlyLanguages.has(language)).toBe(true);
			expect(runtimeLspCapabilities[language]).toBeUndefined();
		}
	});

	it('keeps Monaco-specific aliases and marker languages centralized', () => {
		expect(dotnetMonacoLspLanguages.csharp).toBe('csharp');
		expect(dotnetMonacoLspLanguages.fsharp).toBe('fsharp');
		expect(dotnetMonacoLspLanguages.vb).toBe('vbnet');
		expect(defaultLanguageAliases.vb).toBe('vbnet');
		expect(defaultLanguageAliases.sql).toBe('sqlite');
		expect(diagnosticMarkerLanguages.has('cpp')).toBe(true);
		expect(diagnosticMarkerLanguages.has('python')).toBe(true);
		expect(diagnosticMarkerLanguages.has('elixir')).toBe(true);
		for (const language of ['json', 'yaml', 'toml', 'html', 'css', 'markdown']) {
			expect(diagnosticMarkerLanguages.has(language)).toBe(true);
		}
		expect(diagnosticMarkerLanguages.has('awk')).toBe(true);
		expect(diagnosticMarkerLanguages.has('octave')).toBe(true);
		expect(diagnosticMarkerLanguages.has('tcl')).toBe(true);
		expect(diagnosticMarkerLanguages.has('wasm')).toBe(true);
		expect(diagnosticMarkerLanguages.has('janet')).toBe(true);
		expect(diagnosticMarkerLanguages.has('lisp')).toBe(true);
	});

	it('keeps compiler diagnostic support visible for compiled languages', () => {
		for (const language of ['D', 'RUST', 'VBNET', 'OCAML', 'ASSEMBLYSCRIPT', 'PHP'] as const) {
			expect(compilerDiagnosticLanguages.has(language)).toBe(true);
		}
	});
});
