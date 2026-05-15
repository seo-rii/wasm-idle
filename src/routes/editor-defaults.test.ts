import { describe, expect, it } from 'vitest';
import {
	editorDefaults,
	isEditorDefaultSource,
	isLegacyEditorDefaultSource,
	legacyBrokenFsharpEditorDefault,
	legacyBrokenTinyGoEditorDefault,
	resolveEditorDefaultSource,
	rustEditorDefaults
} from './editor-defaults';

describe('editor defaults', () => {
	it('keeps each starter wired for the current browser runtime path', () => {
		expect(editorDefaults.c).toContain('puts("Hello, WebAssembly!")');
		expect(editorDefaults.cpp).toContain('std::cin >> n');
		expect(editorDefaults.python).toContain('factorial_plus_bonus');
		expect(editorDefaults.java).toContain('Scanner scanner = new Scanner(System.in);');
		expect(editorDefaults.go).toContain("ReadString('\\n')");
		expect(editorDefaults.csharp).toContain('Console.ReadLine()');
		expect(editorDefaults.fsharp).toContain('System.Console.ReadLine()');
		expect(editorDefaults.fsharp).toContain('commandLineArgs.Length > 1');
		expect(editorDefaults.fsharp).not.toContain('Array.skip');
		expect(editorDefaults.elixir).toContain('IO.gets("")');
		expect(editorDefaults.ocaml).toContain('read_line ()');
		expect(editorDefaults.javascript).toContain("require('fs')");
		expect(editorDefaults.javascript).toContain("readFileSync('/dev/stdin', 'utf8')");
		expect(editorDefaults.typescript).toContain("import fs from 'node:fs'");
		expect(editorDefaults.typescript).toContain('const bonus: number = 3;');
		expect(rustEditorDefaults['wasm32-wasip1']).toContain('io::stdin().read_line');
	});

	it('keeps legacy broken starters recognizable for migration', () => {
		expect(legacyBrokenTinyGoEditorDefault).toContain(`ReadString('
')`);
		expect(legacyBrokenTinyGoEditorDefault).toContain(`factorial_plus_bonus=%d
", factorial(n)+bonus)`);
		expect(legacyBrokenFsharpEditorDefault).toContain('Array.skip 1');
	});

	it('resolves the requested default source by language and rust target', () => {
		expect(resolveEditorDefaultSource('c', 'wasm32-wasip1')).toBe(editorDefaults.c);
		expect(resolveEditorDefaultSource('go', 'wasm32-wasip1')).toBe(editorDefaults.go);
		expect(resolveEditorDefaultSource('fsharp', 'wasm32-wasip1')).toBe(editorDefaults.fsharp);
		expect(resolveEditorDefaultSource('ocaml', 'wasm32-wasip1')).toBe(editorDefaults.ocaml);
		expect(resolveEditorDefaultSource('javascript', 'wasm32-wasip1')).toBe(
			editorDefaults.javascript
		);
		expect(resolveEditorDefaultSource('typescript', 'wasm32-wasip1')).toBe(
			editorDefaults.typescript
		);
		expect(resolveEditorDefaultSource('rust', 'wasm32-wasip2')).toBe(
			rustEditorDefaults['wasm32-wasip2']
		);
	});

	it('recognizes bundled defaults and the legacy broken TinyGo starter separately', () => {
		expect(isEditorDefaultSource(editorDefaults.go)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.fsharp)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.ocaml)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.javascript)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.typescript)).toBe(true);
		expect(isEditorDefaultSource(rustEditorDefaults['wasm32-wasip1'])).toBe(true);
		expect(isEditorDefaultSource('fn main() {}')).toBe(false);
		expect(isLegacyEditorDefaultSource(legacyBrokenTinyGoEditorDefault)).toBe(true);
		expect(isLegacyEditorDefaultSource(legacyBrokenFsharpEditorDefault)).toBe(true);
		expect(isLegacyEditorDefaultSource(editorDefaults.go)).toBe(false);
		expect(isLegacyEditorDefaultSource(editorDefaults.fsharp)).toBe(false);
	});
});
