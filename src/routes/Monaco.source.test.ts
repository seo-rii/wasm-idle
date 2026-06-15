import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Monaco route source', () => {
	it('loads Monaco basic language contributions used by the playground', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		for (const language of [
			'cpp',
			'csharp',
			'elixir',
			'go',
			'java',
			'javascript',
			'php',
			'python',
			'r',
			'ruby',
			'rust',
			'sql',
			'typescript',
			'vb'
		]) {
			expect(source).toContain(
				`monaco-editor/esm/vs/basic-languages/${language}/${language}.contribution.js`
			);
		}
	});

	it('registers an OCaml Monaco language with a tokenizer and language configuration', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain('Monaco.languages.register({');
		expect(source).toContain("id: 'ocaml'");
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('ocaml'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('ocaml'");
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
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('haskell'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('haskell'");
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
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('wat'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('wat'");
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
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('lua'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('lua'");
		expect(source).toContain("tokenPostfix: '.lua'");
		expect(source).toContain("lineComment: '--'");
		expect(source).toContain("blockComment: ['--[[', ']]']");
	});

	it('registers D and Zig Monaco languages with tokenizers', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'd'");
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('d'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('d'");
		expect(source).toContain("tokenPostfix: '.d'");
		expect(source).toContain("blockComment: ['/*', '*/']");
		expect(source).toContain("id: 'zig'");
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('zig'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('zig'");
		expect(source).toContain("tokenPostfix: '.zig'");
		expect(source).toContain("lineComment: '//'");
	});
});
