// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { compile } =
	require('monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js') as {
		compile: (
			id: string,
			definition: object
		) => { tokenizer: { root: { regex: RegExp; action: string }[] } };
	};

it('compiles the installed wrapper languages without treating Objective-C keywords as attributes', async () => {
	const source = await readFile(
		join(dirname(require.resolve('@seorii/monaco/workers')), 'customLanguages.js'),
		'utf8'
	);
	// Use the published registration and tokenizers with the real Monarch compiler,
	// replacing only rendering APIs so the check does not need an editor or DOM.
	const lexers = new Map<string, ReturnType<typeof compile>>();
	const registered = new Set<string>();
	const monaco = {
		languages: {
			getLanguages: () => [...registered].map((id) => ({ id })),
			register: ({ id }: { id: string }) => registered.add(id),
			setLanguageConfiguration: () => ({ dispose() {} }),
			setMonarchTokensProvider: (id: string, definition: object) => {
				lexers.set(id, compile(id, definition));
				return { dispose() {} };
			}
		}
	};
	const register = runInThisContext(
		`(function (M) {${source
			.replace(/^import \* as M from 'monaco-editor';\s*$/m, '')
			.replace(/^export /gm, '')}\nreturn registerAonohakoLanguages;})`
	)(monaco) as () => void;
	expect(() => register()).not.toThrow();
	expect(lexers.size).toBe(registered.size);
	expect(lexers.size).toBeGreaterThan(40);
	const cppKeywords = lexers
		.get('objective-cpp')!
		.tokenizer.root.find((rule) => rule.regex.test('class'));
	expect(cppKeywords?.action).toBe('keyword');
	expect(cppKeywords?.regex.test('namespace')).toBe(true);
	expect(cppKeywords?.regex.test('className')).toBe(false);
});
