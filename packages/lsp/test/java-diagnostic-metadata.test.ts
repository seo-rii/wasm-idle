import { describe, expect, it } from 'vitest';
import { JavaDiagnosticMetadata } from '../src/java/diagnostic-metadata.js';

const uri = 'file:///workspace/Main.java';
const original = {
	range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
	message: 'cannot find symbol',
	severity: 1,
	code: 'compiler.err.cant.resolve.location',
	source: 'javac',
	tags: [1]
};
const omitted = { range: original.range, message: original.message, severity: original.severity };
const published = (diagnostics = [original], targetUri = uri) => ({
	jsonrpc: '2.0',
	method: 'textDocument/publishDiagnostics',
	params: { uri: targetUri, diagnostics }
});
const request = (diagnostic: unknown = omitted, targetUri = uri) => ({
	jsonrpc: '2.0',
	id: 1,
	method: 'textDocument/codeAction',
	params: {
		textDocument: { uri: targetUri },
		context: { diagnostics: [diagnostic], only: ['quickfix'] }
	}
});

describe('Java code-action diagnostic metadata', () => {
	it('restores the exact original diagnostic without changing the request or published objects', () => {
		const metadata = new JavaDiagnosticMetadata();
		const output = published();
		const input = request();
		metadata.observe(output);
		expect(metadata.prepare(input)).toEqual(request(original));
		expect(input).toEqual(request(omitted));
		expect(output).toEqual(published());
	});

	it('preserves explicitly supplied client metadata, including a different code and null source', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		const diagnostic = { ...omitted, code: 'client-code', source: null, tags: [] };
		expect(metadata.prepare(request(diagnostic))).toEqual(request(diagnostic));
	});

	it('restores metadata whose structured-clone properties are undefined and omitted on the JSON wire', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		expect(
			metadata.prepare(
				request({ ...omitted, code: undefined, source: undefined, tags: undefined })
			)
		).toEqual(request(original));
	});

	it.each([
		{ ...omitted, message: 'another message' },
		{ ...omitted, severity: 2 },
		{ ...omitted, severity: undefined },
		{ ...omitted, range: { ...omitted.range, start: { line: 3, character: 4 } } },
		{ ...omitted, range: { ...omitted.range, end: { line: 2, character: 11 } } }
	])('does not attach metadata to a different diagnostic: %j', (diagnostic) => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		expect(metadata.prepare(request(diagnostic))).toEqual(request(diagnostic));
	});

	it('does not match diagnostics from another URI or case-distinct file', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		for (const targetUri of ['file:///workspace/Other.java', uri.toLowerCase()])
			expect(metadata.prepare(request(omitted, targetUri))).toEqual(
				request(omitted, targetUri)
			);
	});

	it('replaces old diagnostics on every publication and clears empty publications', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		metadata.observe(published([{ ...original, message: 'new diagnostic' }]));
		expect(metadata.prepare(request())).toEqual(request());
		metadata.observe(published());
		metadata.observe(published([]));
		expect(metadata.prepare(request())).toEqual(request());
	});

	it.each(['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose'])(
		'invalidates diagnostics after %s until the server publishes again',
		(method) => {
			const metadata = new JavaDiagnosticMetadata();
			metadata.observe(published());
			const event = { method, params: { textDocument: { uri } } };
			expect(metadata.prepare(event)).toBe(event);
			expect(metadata.prepare(request())).toEqual(request());
			metadata.observe(published());
			expect(metadata.prepare(request())).toEqual(request(original));
		}
	);

	it('does not guess when multiple server diagnostics match the visible marker', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published([original, { ...original, code: 'another-code' }]));
		expect(metadata.prepare(request())).toEqual(request());
	});

	it('keeps an immutable snapshot of the actual server diagnostics', () => {
		const metadata = new JavaDiagnosticMetadata();
		const output = structuredClone(published());
		metadata.observe(output);
		output.params.diagnostics[0].code = 'modified';
		expect(metadata.prepare(request())).toEqual(request(original));
	});

	it('leaves unrelated messages and malformed diagnostics alone', () => {
		const metadata = new JavaDiagnosticMetadata();
		for (const event of [null, {}, { method: 'textDocument/hover' }, published([])]) {
			metadata.observe(event);
			expect(metadata.prepare(event)).toBe(event);
		}
		metadata.observe(published());
		expect(metadata.prepare(request(null))).toEqual(request(null));
	});
});
