import { describe, expect, it } from 'vitest';

import {
	editorLanguageServerProviders,
	resolveEditorLanguageServerProvider
} from '../src/registry.js';

const expectedLanguagesByProvider = {
	clangd: ['c', 'cpp'],
	python: ['python'],
	rust: ['rust', 'rs'],
	go: ['go', 'golang'],
	d: ['d'],
	tcl: ['tcl', 'tclsh'],
	pascal: ['pascal', 'pas', 'fpc'],
	gleam: ['gleam'],
	elixir: ['elixir', 'ex', 'exs'],
	erlang: ['erlang', 'erl', 'hrl'],
	typescript: ['typescript', 'ts'],
	javascript: ['javascript', 'js'],
	wat: ['wat', 'webassembly'],
	wasm: ['wasm', 'wasm32', 'webassembly-binary'],
	'dotnet-csharp': ['csharp', 'c#', 'cs'],
	'dotnet-fsharp': ['fsharp', 'f#', 'fs'],
	'dotnet-visual-basic': ['vb', 'vbnet', 'visualbasic', 'visual-basic'],
	assemblyscript: ['assemblyscript', 'as'],
	zig: ['zig'],
	lua: ['lua'],
	janet: ['janet'],
	lisp: ['lisp', 'scheme', 'scm'],
	octave: ['octave', 'matlab', 'm'],
	ocaml: ['ocaml', 'ml'],
	haskell: ['haskell', 'hs'],
	sql: ['sql', 'sqlite'],
	duckdb: ['duckdb'],
	graphql: ['graphql', 'gql'],
	fortran: ['fortran', 'f90', 'f95'],
	prolog: ['prolog', 'swipl'],
	ruby: ['ruby', 'rb'],
	r: ['r'],
	awk: ['awk', 'gawk'],
	perl: ['perl', 'pl'],
	'document-json': ['json', 'jsonc'],
	'document-yaml': ['yaml', 'yml'],
	'document-toml': ['toml'],
	'document-html': ['html', 'htm'],
	'document-css': ['css'],
	'document-markdown': ['markdown', 'md']
} as const;

describe('editor language server provider registry', () => {
	it('declares every provider and alias in one immutable registry', () => {
		expect(
			Object.fromEntries(
				editorLanguageServerProviders.map((provider) => [provider.id, provider.languages])
			)
		).toEqual(expectedLanguagesByProvider);
		expect(Object.isFrozen(editorLanguageServerProviders)).toBe(true);
		for (const provider of editorLanguageServerProviders) {
			expect(Object.isFrozen(provider)).toBe(true);
			expect(Object.isFrozen(provider.languages)).toBe(true);
		}
	});

	it('resolves every alias case-insensitively with surrounding whitespace', () => {
		for (const provider of editorLanguageServerProviders) {
			for (const language of provider.languages) {
				expect(resolveEditorLanguageServerProvider(language)).toBe(provider);
				expect(resolveEditorLanguageServerProvider(`  ${language.toUpperCase()}  `)).toBe(
					provider
				);
			}
		}
	});

	it('does not route unknown editor languages', () => {
		expect(resolveEditorLanguageServerProvider('')).toBeUndefined();
		expect(resolveEditorLanguageServerProvider('crystal')).toBeUndefined();
	});
});
