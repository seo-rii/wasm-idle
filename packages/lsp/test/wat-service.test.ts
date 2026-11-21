import { describe, expect, it, vi } from 'vitest';
import wabtFactory from 'wabt';

import { createWatWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

async function fixture(text: string) {
	const service = createWatWorkerService();
	const context: LspDocumentContext = {
		documents: new Map(),
		publishDiagnostics: vi.fn(),
		reportProgress: vi.fn()
	};
	const document: LspDocument = {
		uri: 'file:///workspace/main.wat',
		languageId: 'wat',
		version: 1,
		text
	};
	await service.initialize?.({}, context);
	return {
		diagnostics: (source = text) =>
			service.diagnostics!({ ...document, text: source }, context),
		format: async (source = text, insertSpaces = true) => {
			const edits = await service.formatting!(
				{ ...document, text: source },
				{ tabSize: 2, insertSpaces },
				context
			);
			return edits[0]?.newText ?? source;
		}
	};
}

async function instantiate(text: string) {
	const wabt = await wabtFactory();
	const module = wabt.parseWat('test.wat', new TextEncoder().encode(text));
	try {
		module.resolveNames();
		module.validate();
		const { instance } = await WebAssembly.instantiate(module.toBinary({}).buffer);
		return instance.exports;
	} finally {
		module.destroy();
	}
}

describe('createWatWorkerService', () => {
	it('preserves UTF-8 names and data when diagnosing and formatting WAT', async () => {
		const text =
			'(module (memory (export "mem") 1) (data (i32.const 0) "안녕🙂") (func (export "café🙂") (result i32) i32.const 42))';
		const service = await fixture(text);
		expect(await service.diagnostics()).toEqual([]);
		const formatted = await service.format();
		expect(formatted).not.toBe(text);
		const exports = await instantiate(formatted);
		expect((exports['café🙂'] as () => number)()).toBe(42);
		const bytes = new TextEncoder().encode('안녕🙂');
		expect(new Uint8Array((exports.mem as WebAssembly.Memory).buffer, 0, bytes.length)).toEqual(
			bytes
		);

		const invalid = '(module (func (export "안녕🙂") bogus))';
		const [diagnostic] = await service.diagnostics(invalid);
		expect(diagnostic.range.start).toEqual({ line: 0, character: invalid.indexOf('bogus') });
	});

	it('formats commented modules without changing comments, literals, or executable behavior', async () => {
		const block = '(; outer "quoted"\n(; nested note ;) end ;)';
		const text = [
			';; Reviewer  notes',
			'(module     ' + block + '   (memory (export "mem") 1) ;; trailing  note',
			'(data(i32.const 0) ";; (; \\" ;)")    (func(export "answer") (result i32) i32.const 42))'
		].join('\n');
		const service = await fixture(text);
		const formatted = await service.format();
		expect(formatted).not.toBe(text);
		expect(formatted).toContain(';; Reviewer  notes\n(module ' + block + '\n  (memory');
		expect(formatted).toContain('1) ;; trailing  note\n  (data');
		expect(formatted).toContain('";; (; \\" ;)"');
		expect(formatted).toContain('\n  (func (export "answer")');
		expect(await service.format(formatted)).toBe(formatted);
		expect(await service.format(text, false)).toContain('\n\t(data');
		expect(await service.format(text.replaceAll('\n', '\r'))).toContain(
			'1) ;; trailing  note\n  (data'
		);
		const exports = await instantiate(formatted);
		expect((exports.answer as () => number)()).toBe(42);
		const value = ';; (; " ;)';
		expect(
			new TextDecoder().decode(
				new Uint8Array((exports.mem as WebAssembly.Memory).buffer, 0, value.length)
			)
		).toBe(value);
	});

	it('keeps using the WABT printer when comment delimiters occur only in strings', async () => {
		const text = '(module (func (export ";; (; ;)")))';
		const service = await fixture(text);
		const formatted = await service.format();
		expect(formatted).toContain('(export ";; (; ;)" (func 0))');
		expect(await service.format(formatted)).toBe(formatted);
	});

	it('uses wabt for diagnostics, formatting, completion, and hover', async () => {
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const service = createWatWorkerService();

		await service.initialize?.({ features: { mutable_globals: true } }, context);

		const invalidDocument: LspDocument = {
			uri: 'file:///workspace/main.wat',
			languageId: 'wat',
			version: 1,
			text: '(module (func (result i32) i32.add))'
		};
		const diagnostics = await service.diagnostics?.(invalidDocument, context);

		expect(diagnostics?.[0]).toMatchObject({
			severity: 1,
			source: 'wabt'
		});
		expect(Number.isFinite(diagnostics?.[0]?.range.start.line)).toBe(true);
		expect(Number.isFinite(diagnostics?.[0]?.range.start.character)).toBe(true);

		const document: LspDocument = {
			uri: 'file:///workspace/main.wat',
			languageId: 'wat',
			version: 2,
			text: '(module (func (export "answer") (result i32) (i32.const 42)))'
		};
		const formatting = await service.formatting?.(
			document,
			{ tabSize: 2, insertSpaces: true },
			context
		);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 1 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 3 }, context);

		expect(formatting?.[0]?.newText).toContain('i32.const 42');
		expect(completions?.items.some((item) => item.label === 'local.get')).toBe(true);
		expect(hover?.contents.value).toContain('Defines a WebAssembly module');
		expect(context.reportProgress).toHaveBeenCalledWith('load-wabt');
	});
});
