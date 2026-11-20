import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import { applyContentChanges, offsetAt, positionAt } from '../src/lsp.js';

describe('LSP line endings', () => {
	it.each(['\r', '\r\n', '\n'])('applies ranged edits on the second line after %j', (eol) => {
		expect(
			applyContentChanges('first' + eol + 'old', [
				{
					range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
					text: 'new'
				}
			])
		).toBe('first' + eol + 'new');
	});

	it('matches TextDocument at line boundaries and UTF-16 offsets', () => {
		const text = '😀\r\nb\rc\n\r';
		const document = TextDocument.create('file:///main.txt', 'text', 1, text);
		for (let offset = -1; offset <= text.length + 1; offset++) {
			expect(positionAt(text, offset)).toEqual(document.positionAt(offset));
		}
		for (let line = -1; line <= document.lineCount; line++) {
			for (const character of [-1, 0, 1, 2, 32]) {
				const position = { line, character };
				expect(offsetAt(text, position)).toBe(document.offsetAt(position));
			}
		}
	});
});
