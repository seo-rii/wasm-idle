import source from './ocaml.ts?raw';
import { describe, expect, it } from 'vitest';

describe('OCaml worker source', () => {
	it('keeps partial stdin bytes buffered instead of dropping the rest of a chunk', () => {
		const normalizedSource = source.replace(/\s+/g, ' ');
		expect(source).toContain("const hasExplicitStdinOcaml = typeof stdin === 'string';");
		expect(normalizedSource).toContain(
			'let stdinChunkOcaml = hasExplicitStdinOcaml ? stdinEncoder.encode(stdin) : new Uint8Array(0);'
		);
		expect(source).toContain('let stdinChunkOffsetOcaml = 0;');
		expect(source).toContain('const readOcamlStdinBytes = (requestedBytes: number) => {');
		expect(source).toContain('if (hasExplicitStdinOcaml) return null;');
		expect(source).toContain('stdinChunkOcaml = stdinEncoder.encode(chunk);');
		expect(source).toContain('stdinChunkOffsetOcaml = end;');
		expect(source).toContain('const encoded = readOcamlStdinBytes(length);');
	});

	it('does not emit OCaml stdin debug logs into the terminal transcript', () => {
		expect(source).not.toContain('[wasm-idle:ocaml-stdin]');
	});
});
