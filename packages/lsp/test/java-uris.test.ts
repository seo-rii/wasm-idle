import { describe, expect, it } from 'vitest';
import { JavaDocumentUriError, JavaDocumentUris } from '../src/java/document-uris.js';

const MAIN = 'file:///workspace/src/Main.java';
const LOWER = MAIN.toLowerCase();

describe('Java document URI ownership', () => {
	it('rejects a second didOpen with distinct filename case and preserves the first document', () => {
		const documents = new JavaDocumentUris({});
		documents.registerOpen(MAIN);
		expect(() => documents.registerOpen(LOWER)).toThrow(JavaDocumentUriError);
		expect(
			documents.canonicalize({
				method: 'textDocument/documentSymbol',
				params: { textDocument: { uri: LOWER } }
			})
		).toMatchObject({ params: { textDocument: { uri: MAIN } } });
		expect(() => documents.registerOpen(MAIN)).not.toThrow();
	});

	it('accepts the first lowercased Monaco didOpen and keeps snapshot case for subsequent changes', () => {
		const documents = new JavaDocumentUris({ [LOWER]: MAIN });
		documents.registerOpen(LOWER);
		for (const method of [
			'textDocument/didChange',
			'textDocument/hover',
			'textDocument/didClose'
		])
			expect(
				documents.canonicalize({ method, params: { textDocument: { uri: LOWER } } })
			).toMatchObject({ params: { textDocument: { uri: MAIN } } });
		// A close/reopen of the same client URI keeps its canonical physical filename.
		expect(() => documents.registerOpen(LOWER)).not.toThrow();
		expect(() => documents.registerOpen(MAIN)).toThrow(/Ambiguous Java didOpen/);
	});

	it('matches decoded Unicode case and equivalent slash/percent encodings', () => {
		const canonical = 'file:///workspace/src/%C3%84.java';
		const documents = new JavaDocumentUris({ [canonical.toLowerCase()]: canonical });
		documents.registerOpen('file:///workspace/src//%C3%A4.java');
		expect(documents.canonicalize('file:///workspace/src%2f%C3%A4.java', 'uri')).toBe(
			canonical
		);
		expect(() => documents.registerOpen(canonical)).toThrow(/Ambiguous Java didOpen/);
	});

	it('normalizes an opened file before assigning its canonical URI', () => {
		const documents = new JavaDocumentUris({});
		documents.registerOpen('file:///workspace/src//%4dain.java/');
		expect(documents.canonicalize(LOWER, 'uri')).toBe(MAIN);
		expect(documents.canonicalize('file:///workspace', 'rootUri')).toBe('file:///workspace');
	});

	it.each([
		'https://example.test/Main.java',
		'file://elsewhere/workspace/Main.java',
		'file:///elsewhere/Main.java',
		'file:///workspace/',
		'file:///workspace/Main.java?query=1',
		'file:///workspace/Main.java#fragment',
		'file:///workspace/Main.java?',
		'file:///workspace/Main.java#',
		'file:///workspace/src%2f..%2fMain.java',
		'file:///workspace/src%5cMain.java',
		'file:///workspace/%00Main.java',
		'file:///workspace/%zzMain.java'
	])('rejects invalid dynamic source URIs: %s', (uri) => {
		const documents = new JavaDocumentUris({});
		expect(() => documents.registerOpen(uri)).toThrow(JavaDocumentUriError);
		documents.registerOpen(MAIN);
		expect(documents.canonicalize(LOWER, 'uri')).toBe(MAIN);
	});
});
