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
		expect(editorDefaults.d).toContain('stdin.readln()');
		expect(editorDefaults.d).toContain('writeln("factorial_plus_bonus="');
		expect(editorDefaults.csharp).toContain('Console.ReadLine()');
		expect(editorDefaults.fsharp).toContain('System.Console.ReadLine()');
		expect(editorDefaults.fsharp).toContain('commandLineArgs.Length > 1');
		expect(editorDefaults.fsharp).not.toContain('Array.skip');
		expect(editorDefaults.vbnet).toContain('Console.ReadLine()');
		expect(editorDefaults.vbnet).toContain('Sub Main(args As String())');
		expect(editorDefaults.elixir).toContain('IO.gets("")');
		expect(editorDefaults.erlang).toContain('io:get_line("")');
		expect(editorDefaults.erlang).toContain('io:format("stdin=~s"');
		expect(editorDefaults.prolog).toContain('read_line_to_string(user_input, Line)');
		expect(editorDefaults.gleam).toContain('import wasm_idle/stdin');
		expect(editorDefaults.gleam).toContain('stdin.read_line()');
		expect(editorDefaults.perl).toContain('my $line = <STDIN>;');
		expect(editorDefaults.pascal).toContain('ReadLn(Line);');
		expect(editorDefaults.forth).toContain('KEY DUP 10 <>');
		expect(editorDefaults.forth).toContain('factorial_plus_bonus=');
		expect(editorDefaults.j).toContain('1!:1 [ 1');
		expect(editorDefaults.j).toContain('factorial_plus_bonus=');
		expect(editorDefaults.bqn).toContain('•GetLine @');
		expect(editorDefaults.bqn).toContain('Factorial');
		expect(editorDefaults.janet).toContain('(getline)');
		expect(editorDefaults.janet).toContain('factorial_plus_bonus=');
		expect(editorDefaults.ocaml).toContain('read_line ()');
		expect(editorDefaults.javascript).toContain("require('fs')");
		expect(editorDefaults.javascript).toContain('readLineSync(0)');
		expect(editorDefaults.typescript).toContain("import fs from 'node:fs'");
		expect(editorDefaults.typescript).toContain('const bonus: number = 3;');
		expect(editorDefaults.wat).toContain('(module');
		expect(editorDefaults.wat).toContain('(export "factorial_plus_bonus")');
		expect(editorDefaults.lua).toContain('local function factorial');
		expect(editorDefaults.lua).toContain('io.read("*l")');
		expect(editorDefaults.haskell).toContain('factorial :: Int -> Int');
		expect(editorDefaults.haskell).toContain('putStrLn');
		expect(editorDefaults.r).toContain('readLines(stdin(), n = 1');
		expect(editorDefaults.r).toContain('factorial_plus_bonus=%d');
		expect(editorDefaults.octave).toContain('fgetl(stdin)');
		expect(editorDefaults.octave).toContain('factorial_plus_bonus=%d');
		expect(editorDefaults.sqlite).toContain('CREATE TABLE numbers');
		expect(editorDefaults.sqlite).toContain('factorial_plus_bonus=');
		expect(editorDefaults.php).toContain("file_get_contents('php://input')");
		expect(editorDefaults.php).toContain('factorial_plus_bonus=');
		expect(editorDefaults.zig).toContain('std.io.getStdIn().reader()');
		expect(editorDefaults.zig).toContain('factorial_plus_bonus={d}');
		expect(editorDefaults.lisp).toContain('(define (factorial n)');
		expect(editorDefaults.lisp).toContain('(display "factorial_plus_bonus=")');
		expect(editorDefaults.haskell).toContain('factorial :: Int -> Int');
		expect(editorDefaults.haskell).toContain('putStrLn');
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
		expect(resolveEditorDefaultSource('d', 'wasm32-wasip1')).toBe(editorDefaults.d);
		expect(resolveEditorDefaultSource('fsharp', 'wasm32-wasip1')).toBe(editorDefaults.fsharp);
		expect(resolveEditorDefaultSource('vbnet', 'wasm32-wasip1')).toBe(editorDefaults.vbnet);
		expect(resolveEditorDefaultSource('erlang', 'wasm32-wasip1')).toBe(editorDefaults.erlang);
		expect(resolveEditorDefaultSource('prolog', 'wasm32-wasip1')).toBe(editorDefaults.prolog);
		expect(resolveEditorDefaultSource('gleam', 'wasm32-wasip1')).toBe(editorDefaults.gleam);
		expect(resolveEditorDefaultSource('perl', 'wasm32-wasip1')).toBe(editorDefaults.perl);
		expect(resolveEditorDefaultSource('pascal', 'wasm32-wasip1')).toBe(editorDefaults.pascal);
		expect(resolveEditorDefaultSource('forth', 'wasm32-wasip1')).toBe(editorDefaults.forth);
		expect(resolveEditorDefaultSource('j', 'wasm32-wasip1')).toBe(editorDefaults.j);
		expect(resolveEditorDefaultSource('bqn', 'wasm32-wasip1')).toBe(editorDefaults.bqn);
		expect(resolveEditorDefaultSource('janet', 'wasm32-wasip1')).toBe(editorDefaults.janet);
		expect(resolveEditorDefaultSource('ocaml', 'wasm32-wasip1')).toBe(editorDefaults.ocaml);
		expect(resolveEditorDefaultSource('javascript', 'wasm32-wasip1')).toBe(
			editorDefaults.javascript
		);
		expect(resolveEditorDefaultSource('typescript', 'wasm32-wasip1')).toBe(
			editorDefaults.typescript
		);
		expect(resolveEditorDefaultSource('wat', 'wasm32-wasip1')).toBe(editorDefaults.wat);
		expect(resolveEditorDefaultSource('lua', 'wasm32-wasip1')).toBe(editorDefaults.lua);
		expect(resolveEditorDefaultSource('haskell', 'wasm32-wasip1')).toBe(editorDefaults.haskell);
		expect(resolveEditorDefaultSource('r', 'wasm32-wasip1')).toBe(editorDefaults.r);
		expect(resolveEditorDefaultSource('octave', 'wasm32-wasip1')).toBe(editorDefaults.octave);
		expect(resolveEditorDefaultSource('sqlite', 'wasm32-wasip1')).toBe(editorDefaults.sqlite);
		expect(resolveEditorDefaultSource('php', 'wasm32-wasip1')).toBe(editorDefaults.php);
		expect(resolveEditorDefaultSource('zig', 'wasm32-wasip1')).toBe(editorDefaults.zig);
		expect(resolveEditorDefaultSource('lisp', 'wasm32-wasip1')).toBe(editorDefaults.lisp);
		expect(resolveEditorDefaultSource('haskell', 'wasm32-wasip1')).toBe(editorDefaults.haskell);
		expect(resolveEditorDefaultSource('rust', 'wasm32-wasip2')).toBe(
			rustEditorDefaults['wasm32-wasip2']
		);
	});

	it('recognizes bundled defaults and the legacy broken TinyGo starter separately', () => {
		expect(isEditorDefaultSource(editorDefaults.go)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.d)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.fsharp)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.vbnet)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.erlang)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.prolog)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.gleam)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.perl)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.pascal)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.forth)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.j)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.bqn)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.janet)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.ocaml)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.javascript)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.typescript)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.wat)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.lua)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.haskell)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.r)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.octave)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.sqlite)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.php)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.zig)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.lisp)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.haskell)).toBe(true);
		expect(isEditorDefaultSource(rustEditorDefaults['wasm32-wasip1'])).toBe(true);
		expect(isEditorDefaultSource('fn main() {}')).toBe(false);
		expect(isLegacyEditorDefaultSource(legacyBrokenTinyGoEditorDefault)).toBe(true);
		expect(isLegacyEditorDefaultSource(legacyBrokenFsharpEditorDefault)).toBe(true);
		expect(isLegacyEditorDefaultSource(editorDefaults.go)).toBe(false);
		expect(isLegacyEditorDefaultSource(editorDefaults.fsharp)).toBe(false);
	});
});
