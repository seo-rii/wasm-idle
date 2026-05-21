import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Monaco route source', () => {
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
	it('registers a Zig Monaco language for source files', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'zig'");
		expect(source).toContain("aliases: ['Zig', 'zig']");
		expect(source).toContain("extensions: ['.zig']");
	});

	it('registers a Haskell Monaco language with a tokenizer and language configuration', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/routes/Monaco.svelte'),
			'utf8'
		);

		expect(source).toContain("id: 'haskell'");
		expect(source).toContain("aliases: ['Haskell', 'haskell']");
		expect(source).toContain("extensions: ['.hs', '.lhs']");
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('haskell'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('haskell'");
		expect(source).toContain("tokenPostfix: '.haskell'");
		expect(source).toContain("lineComment: '--'");
		expect(source).toContain("blockComment: ['{-', '-}']");
	});
});
