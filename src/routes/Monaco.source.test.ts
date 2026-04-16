import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Monaco route source', () => {
	it('registers an OCaml Monaco language with a tokenizer and language configuration', async () => {
		const source = await readFile(path.resolve(process.cwd(), 'src/routes/Monaco.svelte'), 'utf8');

		expect(source).toContain("Monaco.languages.register({");
		expect(source).toContain("id: 'ocaml'");
		expect(source).toContain("Monaco.languages.setLanguageConfiguration('ocaml'");
		expect(source).toContain("Monaco.languages.setMonarchTokensProvider('ocaml'");
		expect(source).toContain("tokenPostfix: '.ocaml'");
		expect(source).toContain("blockComment: ['(*', '*)']");
	});
});
