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
const withoutDiagnostics = (message = request()) => ({
	...message,
	params: { ...message.params, context: { ...message.params.context, diagnostics: [] } }
});
const equivalentUris = [
	['file:///workspace/Foo$Bar.java', 'file:///workspace/Foo%24Bar.java'],
	[
		'file:///workspace/build;generated/Foo$Bar.java',
		'file:///workspace/build%3bgenerated/%46oo%24Bar.java'
	]
];

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

	it.each(equivalentUris)(
		'restores metadata across equivalent URI encodings in both directions: %s, %s',
		(left, right) => {
			for (const [publishedUri, requestedUri] of [
				[left, right],
				[right, left]
			]) {
				const metadata = new JavaDiagnosticMetadata();
				const output = published([original], publishedUri);
				const input = request(omitted, requestedUri);
				metadata.observe(output);
				expect(metadata.prepare(input)).toEqual(request(original, requestedUri));
				expect(input).toEqual(request(omitted, requestedUri));
				expect(output).toEqual(published([original], publishedUri));
			}
		}
	);

	it.each(['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose'])(
		'invalidates equivalent URI encodings after %s in both directions',
		(method) => {
			for (const [left, right] of equivalentUris) {
				for (const [publishedUri, changedUri] of [
					[left, right],
					[right, left]
				]) {
					const metadata = new JavaDiagnosticMetadata();
					metadata.observe(published([original], publishedUri));
					const event = { method, params: { textDocument: { uri: changedUri } } };
					expect(metadata.prepare(event)).toBe(event);
					for (const targetUri of [publishedUri, changedUri]) {
						const input = request(omitted, targetUri);
						expect(metadata.prepare(input)).toEqual(withoutDiagnostics(input));
					}
					metadata.observe(published([original], changedUri));
					expect(metadata.prepare(request(omitted, publishedUri))).toEqual(
						request(original, publishedUri)
					);
				}
			}
		}
	);

	it.each(equivalentUris)(
		'replaces and clears diagnostics across equivalent URI encodings: %s, %s',
		(left, right) => {
			for (const [publishedUri, nextUri] of [
				[left, right],
				[right, left]
			]) {
				const metadata = new JavaDiagnosticMetadata();
				metadata.observe(published([original], publishedUri));
				const replacement = { ...original, code: 'new-code' };
				metadata.observe(published([replacement], nextUri));
				expect(metadata.prepare(request(omitted, publishedUri))).toEqual(
					request(replacement, publishedUri)
				);
				metadata.observe(published([], publishedUri));
				for (const targetUri of [publishedUri, nextUri]) {
					const input = request(omitted, targetUri);
					expect(metadata.prepare(input)).toEqual(withoutDiagnostics(input));
				}
			}
		}
	);

	it('does not merge case-distinct physical files when URI encodings differ', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published([original], 'file:///workspace/Foo$Bar.java'));
		const input = request(omitted, 'file:///workspace/foo%24bar.java');
		expect(metadata.prepare(input)).toEqual(withoutDiagnostics(input));
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
	])(
		'excludes an uncoded marker that does not match the current diagnostic: %j',
		(diagnostic) => {
			const metadata = new JavaDiagnosticMetadata();
			metadata.observe(published());
			expect(metadata.prepare(request(diagnostic))).toEqual(
				withoutDiagnostics(request(diagnostic))
			);
		}
	);

	it('does not match diagnostics from another URI or case-distinct file', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		for (const targetUri of ['file:///workspace/Other.java', uri.toLowerCase()])
			expect(metadata.prepare(request(omitted, targetUri))).toEqual(
				withoutDiagnostics(request(omitted, targetUri))
			);
	});

	it('replaces old diagnostics on every publication and clears empty publications', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		metadata.observe(published([{ ...original, message: 'new diagnostic' }]));
		expect(metadata.prepare(request())).toEqual(withoutDiagnostics());
		metadata.observe(published());
		metadata.observe(published([]));
		expect(metadata.prepare(request())).toEqual(withoutDiagnostics());
	});

	it.each(['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose'])(
		'invalidates diagnostics after %s until the server publishes again',
		(method) => {
			const metadata = new JavaDiagnosticMetadata();
			metadata.observe(published());
			const event = { method, params: { textDocument: { uri } } };
			expect(metadata.prepare(event)).toBe(event);
			expect(metadata.prepare(request())).toEqual(withoutDiagnostics());
			metadata.observe(published());
			expect(metadata.prepare(request())).toEqual(request(original));
		}
	);

	it('does not guess when multiple server diagnostics match the visible marker', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published([original, { ...original, code: 'another-code' }]));
		expect(metadata.prepare(request())).toEqual(withoutDiagnostics());
	});

	it('excludes uncoded markers before any diagnostic publication', () => {
		const metadata = new JavaDiagnosticMetadata();
		expect(metadata.prepare(request())).toEqual(withoutDiagnostics());
		expect(metadata.prepare(request({ ...omitted, code: undefined }))).toEqual(
			withoutDiagnostics()
		);
	});

	it.each(['client-code', '', 0, null])(
		'preserves explicitly coded unknown diagnostics: %j',
		(code) => {
			const metadata = new JavaDiagnosticMetadata();
			const input = request({ ...omitted, code });
			expect(metadata.prepare(input)).toEqual(input);
		}
	);

	it('filters only delayed uncoded markers while preserving the request range and context', () => {
		const metadata = new JavaDiagnosticMetadata();
		metadata.observe(published());
		const explicit = { ...omitted, code: 'other-provider', message: 'another provider' };
		const input = {
			...request(),
			params: {
				...request().params,
				range: { start: { line: 2, character: 8 }, end: { line: 2, character: 8 } },
				context: {
					only: ['quickfix'],
					triggerKind: 2,
					diagnostics: [omitted, { ...omitted, message: 'stale marker' }, explicit]
				}
			}
		};
		expect(metadata.prepare(input)).toEqual({
			...input,
			params: {
				...input.params,
				context: { ...input.params.context, diagnostics: [original, explicit] }
			}
		});
	});

	it('drops a delayed typing marker after a newer publication moves its range', () => {
		const metadata = new JavaDiagnosticMetadata();
		const old = {
			...original,
			code: 'unused_local',
			message: "'answer' is not used",
			severity: 3,
			range: { start: { line: 2, character: 7 }, end: { line: 2, character: 13 } }
		};
		metadata.observe(published([old]));
		const delayed = request({ range: old.range, message: old.message, severity: old.severity });
		metadata.observe(
			published([
				{
					...old,
					range: {
						start: { line: 2, character: 8 },
						end: { line: 2, character: 14 }
					}
				}
			])
		);
		expect(metadata.prepare(delayed)).toEqual(withoutDiagnostics(delayed));
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
