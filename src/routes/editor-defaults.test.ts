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
	it('keeps each starter focused on a minimal hello world program', () => {
		expect(editorDefaults.c).toContain('puts("Hello, WebAssembly!")');
		expect(editorDefaults.cpp).toContain('std::cout << "Hello, WebAssembly!"');
		expect(editorDefaults.python).toBe('print("Hello, WebAssembly!")');
		expect(editorDefaults.java).toContain('System.out.println("Hello, WebAssembly!")');
		expect(editorDefaults.go).toContain('fmt.Println("Hello, WebAssembly!")');
		expect(editorDefaults.elixir).toBe('IO.puts("Hello, WebAssembly!")');
		expect(editorDefaults.ocaml).toBe('let () = print_endline "Hello, WebAssembly!"');
		expect(rustEditorDefaults['wasm32-wasip1']).toContain('println!("Hello, WebAssembly!")');
	});

	it('keeps the legacy broken TinyGo starter recognizable for migration', () => {
		expect(legacyBrokenTinyGoEditorDefault).toContain(`ReadString('
')`);
		expect(legacyBrokenTinyGoEditorDefault).toContain(`factorial_plus_bonus=%d
", factorial(n)+bonus)`);
	});

	it('resolves the requested default source by language and rust target', () => {
		expect(resolveEditorDefaultSource('c', 'wasm32-wasip1')).toBe(editorDefaults.c);
		expect(resolveEditorDefaultSource('go', 'wasm32-wasip1')).toBe(editorDefaults.go);
		expect(resolveEditorDefaultSource('ocaml', 'wasm32-wasip1')).toBe(editorDefaults.ocaml);
		expect(resolveEditorDefaultSource('rust', 'wasm32-wasip2')).toBe(
			rustEditorDefaults['wasm32-wasip2']
		);
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
