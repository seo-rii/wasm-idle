import { describe, expect, it } from 'vitest';
import {
	editorDefaults,
	isEditorDefaultSource,
	isLegacyEditorDefaultSource,
	legacyBrokenTinyGoEditorDefault,
	resolveEditorDefaultSource,
	rustEditorDefaults
} from './editor-defaults';

describe('editor defaults', () => {
	it('keeps TinyGo starter escape sequences intact inside the Go source', () => {
		expect(editorDefaults.go).toContain("ReadString('\\n')");
		expect(editorDefaults.go).toContain('fmt.Printf("factorial_plus_bonus=%d\\n", factorial(n)+bonus)');
		expect(editorDefaults.go).not.toContain(`ReadString('
')`);
		expect(editorDefaults.go).not.toContain(`factorial_plus_bonus=%d
", factorial(n)+bonus)`);
		expect(legacyBrokenTinyGoEditorDefault).toContain(`ReadString('
')`);
		expect(legacyBrokenTinyGoEditorDefault).toContain(`factorial_plus_bonus=%d
", factorial(n)+bonus)`);
	});

	it('resolves the requested default source by language and rust target', () => {
		expect(resolveEditorDefaultSource('go', 'wasm32-wasip1')).toBe(editorDefaults.go);
		expect(resolveEditorDefaultSource('ocaml', 'wasm32-wasip1')).toBe(editorDefaults.ocaml);
		expect(resolveEditorDefaultSource('rust', 'wasm32-wasip2')).toBe(
			rustEditorDefaults['wasm32-wasip2']
		);
	});

	it('keeps the Elixir starter wired to stdin with a fallback value', () => {
		expect(editorDefaults.elixir).toContain('IO.gets("")');
		expect(editorDefaults.elixir).toContain('Integer.parse(String.trim(line))');
		expect(editorDefaults.elixir).toContain(':error -> 4');
		expect(editorDefaults.elixir).toContain(
			'IO.puts("factorial_plus_bonus=#{factorial(n) + @bonus}")'
		);
	});

	it('keeps the OCaml starter wired to stdin with a fallback value', () => {
		expect(editorDefaults.ocaml).toContain('read_line ()');
		expect(editorDefaults.ocaml).toContain('int_of_string value');
		expect(editorDefaults.ocaml).toContain('read_int_or_default 4');
		expect(editorDefaults.ocaml).toContain('factorial_plus_bonus=%d\\n%!');
	});

	it('recognizes bundled defaults and the legacy broken TinyGo starter separately', () => {
		expect(isEditorDefaultSource(editorDefaults.go)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.ocaml)).toBe(true);
		expect(isEditorDefaultSource(rustEditorDefaults['wasm32-wasip1'])).toBe(true);
		expect(isEditorDefaultSource('fn main() {}')).toBe(false);
		expect(isLegacyEditorDefaultSource(legacyBrokenTinyGoEditorDefault)).toBe(true);
		expect(isLegacyEditorDefaultSource(editorDefaults.go)).toBe(false);
	});
});
