import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Monaco route source', () => {
	it('lazy-loads Monaco basic language contributions used by the selected language', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);
		const registrySource = await readFile(
			path.resolve(process.cwd(), 'src/routes/language-registry.ts'),
			'utf8'
		);

		expect(registrySource).toMatch(
			/export const monacoLanguageContributionLoaders(?:: Record<string, MonacoLanguageContributionLoader>)? = \{/
		);
		expect(source).toContain(
			'monacoLanguageContributionLoaders[language]?.() ?? Promise.resolve()'
		);
		expect(source).not.toContain('switch (language) {');
		expect(source).not.toMatch(
			/Promise\.all\(\[\s*import\('monaco-editor\/esm\/vs\/basic-languages\/cpp\/cpp\.contribution\.js'\)/
		);
		expect(registrySource).toContain(
			'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'
		);
		expect(registrySource).toContain(
			'monaco-editor/esm/vs/language/json/monaco.contribution.js'
		);
		for (const language of [
			'cpp',
			'csharp',
			'css',
			'elixir',
			'go',
			'html',
			'java',
			'markdown',
			'perl',
			'php',
			'python',
			'r',
			'ruby',
			'rust',
			'sql',
			'typescript',
			'vb',
			'yaml'
		]) {
			expect(registrySource).toContain(
				`monaco-editor/esm/vs/basic-languages/${language}/${language}.contribution.js`
			);
		}
	});

	it('registers an OCaml Monaco language with a tokenizer and language configuration', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain('monacoApi.languages.register({');
		expect(source).toContain("id: 'ocaml'");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('ocaml'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('ocaml'");
		expect(source).toContain("tokenPostfix: '.ocaml'");
		expect(source).toContain("blockComment: ['(*', '*)']");
	});

	it('registers a Haskell Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'haskell'");
		expect(source).toContain("extensions: ['.hs', '.lhs']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('haskell'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('haskell'");
		expect(source).toContain("tokenPostfix: '.haskell'");
		expect(source).toContain("lineComment: '--'");
		expect(source).toContain("blockComment: ['{-', '-}']");
	});

	it('registers a WAT Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'wat'");
		expect(source).toContain("extensions: ['.wat', '.wast']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('wat'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('wat'");
		expect(source).toContain("tokenPostfix: '.wat'");
		expect(source).toContain("lineComment: ';;'");
		expect(source).toContain("[/\\(;/, 'comment', '@comment']");
	});

	it('registers a Lua Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'lua'");
		expect(source).toContain("extensions: ['.lua']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('lua'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('lua'");
		expect(source).toContain("tokenPostfix: '.lua'");
		expect(source).toContain("lineComment: '--'");
		expect(source).toContain("blockComment: ['--[[', ']]']");
	});

	it('registers an Octave Monaco language with MATLAB-compatible comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'octave'");
		expect(source).toContain("aliases: ['Octave', 'MATLAB', 'octave', 'matlab']");
		expect(source).toContain("extensions: ['.m']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('octave'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('octave'");
		expect(source).toContain("tokenPostfix: '.octave'");
		expect(source).toContain("lineComment: '%'");
		expect(source).toContain("blockComment: ['%{', '%}']");
	});

	it('registers an Erlang Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'erlang'");
		expect(source).toContain("aliases: ['Erlang', 'erlang', 'erl']");
		expect(source).toContain("extensions: ['.erl', '.hrl']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('erlang'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('erlang'");
		expect(source).toContain("tokenPostfix: '.erlang'");
		expect(source).toContain("lineComment: '%'");
		expect(source).toContain("'receive'");
	});

	it('registers Prolog and Gleam Monaco languages with tokenizers', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'prolog'");
		expect(source).toContain("extensions: ['.prolog', '.pro']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('prolog'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('prolog'");
		expect(source).toContain("tokenPostfix: '.prolog'");
		expect(source).toContain("id: 'gleam'");
		expect(source).toContain("extensions: ['.gleam']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('gleam'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('gleam'");
		expect(source).toContain("tokenPostfix: '.gleam'");
	});

	it('registers D and Zig Monaco languages with tokenizers', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'd'");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('d'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('d'");
		expect(source).toContain("tokenPostfix: '.d'");
		expect(source).toContain("blockComment: ['/*', '*/']");
		expect(source).toContain("id: 'zig'");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('zig'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('zig'");
		expect(source).toContain("tokenPostfix: '.zig'");
		expect(source).toContain("lineComment: '//'");
	});

	it('registers a TOML Monaco language with tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'toml'");
		expect(source).toContain("extensions: ['.toml']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('toml'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('toml'");
		expect(source).toContain("tokenPostfix: '.toml'");
		expect(source).toContain("lineComment: '#'");
	});

	it('registers a Forth Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'forth'");
		expect(source).toContain("extensions: ['.fth', '.forth', '.4th']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('forth'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('forth'");
		expect(source).toContain("tokenPostfix: '.forth'");
		expect(source).toContain("lineComment: '\\\\'");
		expect(source).toContain("'key'");
	});

	it('registers a J Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'j'");
		expect(source).toContain("extensions: ['.ijs', '.ijt', '.ijx']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('j'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('j'");
		expect(source).toContain("tokenPostfix: '.j'");
		expect(source).toContain("lineComment: 'NB.'");
		expect(source).toContain("'smoutput'");
	});

	it('registers a BQN Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'bqn'");
		expect(source).toContain("extensions: ['.bqn']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('bqn'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('bqn'");
		expect(source).toContain("tokenPostfix: '.bqn'");
		expect(source).toContain("lineComment: '#'");
		expect(source).toContain("'•GetLine'");
	});

	it('registers a Janet Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'janet'");
		expect(source).toContain("extensions: ['.janet']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('janet'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('janet'");
		expect(source).toContain("tokenPostfix: '.janet'");
		expect(source).toContain("lineComment: '#'");
		expect(source).toContain("'getline'");
	});

	it('registers a Julia Monaco language with comments and tokenizer support', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'julia'");
		expect(source).toContain("extensions: ['.jl']");
		expect(source).toContain("monacoApi.languages.setLanguageConfiguration('julia'");
		expect(source).toContain("monacoApi.languages.setMonarchTokensProvider('julia'");
		expect(source).toContain("tokenPostfix: '.julia'");
		expect(source).toContain("'readline'");
	});
});
