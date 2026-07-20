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
		expect(editorDefaults.c).toContain('fibonacci=%d');
		expect(editorDefaults.cpp).toContain('std::cin >> n');
		expect(editorDefaults.python).toContain('fibonacci');
		expect(editorDefaults.java).toContain('Scanner scanner = new Scanner(System.in);');
		expect(editorDefaults.go).toContain("ReadString('\\n')");
		expect(editorDefaults.d).toContain('stdin.readln()');
		expect(editorDefaults.d).toContain('writeln("fibonacci="');
		expect(editorDefaults.csharp).toContain('Console.ReadLine()');
		expect(editorDefaults.fsharp).toContain('System.Console.ReadLine()');
		expect(editorDefaults.fsharp).toContain('commandLineArgs.Length > 1');
		expect(editorDefaults.fsharp).not.toContain('Array.skip');
		expect(editorDefaults.vbnet).toContain('Console.ReadLine()');
		expect(editorDefaults.vbnet).toContain('Sub Main(args As String())');
		expect(editorDefaults.elixir).toContain('IO.gets("")');
		expect(editorDefaults.erlang).toContain('io:get_line("")');
		expect(editorDefaults.erlang).toContain('io:format("fibonacci=~w"');
		expect(editorDefaults.prolog).toContain('read_line_to_string(user_input, Line)');
		expect(editorDefaults.gleam).toContain('import wasm_idle/stdin');
		expect(editorDefaults.gleam).toContain('stdin.read_line()');
		expect(editorDefaults.perl).toContain('my $line = <STDIN>;');
		expect(editorDefaults.pascal).toContain('ReadLn(Line);');
		expect(editorDefaults.forth).toContain('KEY DUP 10 <>');
		expect(editorDefaults.forth).toContain('fibonacci=');
		expect(editorDefaults.j).toContain('1!:1 [ 1');
		expect(editorDefaults.j).toContain('fibonacci=');
		expect(editorDefaults.bqn).toContain('•GetLine @');
		expect(editorDefaults.bqn).toContain('fibonacci');
		expect(editorDefaults.janet).toContain('(getline)');
		expect(editorDefaults.janet).toContain('fibonacci=');
		expect(editorDefaults.julia).toContain('readline()');
		expect(editorDefaults.julia).toContain('fibonacci=');
		expect(editorDefaults.nim).toContain('stdin.readLine()');
		expect(editorDefaults.nim).toContain('fibonacci=');
		expect(editorDefaults.clojurescript).toContain('[wasm-idle.runtime :as runtime]');
		expect(editorDefaults.clojurescript).toContain('(runtime/read-line)');
		expect(editorDefaults.clojurescript).toContain('(runtime/args)');
		expect(editorDefaults.ocaml).toContain('read_line ()');
		expect(editorDefaults.javascript).toContain("require('fs')");
		expect(editorDefaults.javascript).toContain('readLineSync(0)');
		expect(editorDefaults.typescript).toContain("import fs from 'node:fs'");
		expect(editorDefaults.typescript).toContain('const bonus: number = 3;');
		expect(editorDefaults.wat).toContain('(module');
		expect(editorDefaults.wat).toContain('(export "fibonacci")');
		expect(editorDefaults.lua).toContain('local function fibonacci');
		expect(editorDefaults.lua).toContain('io.read("*l")');
		expect(editorDefaults.haskell).toContain('fibonacci :: Int -> Int');
		expect(editorDefaults.haskell).toContain('putStrLn');
		expect(editorDefaults.r).toContain('readLines(stdin(), n = 1');
		expect(editorDefaults.r).toContain('fibonacci=%d');
		expect(editorDefaults.octave).toContain('fgetl(stdin)');
		expect(editorDefaults.octave).toContain('fibonacci=%d');
		expect(editorDefaults.cobol).toContain('accept input-value');
		expect(editorDefaults.cobol).toContain('display "fibonacci="');
		expect(editorDefaults.cobol).toContain('memo');
		expect(editorDefaults.cobol).toContain('cached-result');
		expect(editorDefaults.sqlite).toContain('WITH RECURSIVE memo');
		expect(editorDefaults.sqlite).toContain("'fibonacci='");
		expect(editorDefaults.duckdb).toContain('WITH RECURSIVE memo');
		expect(editorDefaults.duckdb).toContain("'fibonacci='");
		expect(editorDefaults.graphql).toContain('query Fibonacci');
		expect(editorDefaults.graphql).toContain('$n: Int = 4');
		expect(editorDefaults.graphql).toContain('fibonacci(n: $n)');
		expect(editorDefaults.php).toContain("file_get_contents('php://input')");
		expect(editorDefaults.php).toContain('fibonacci=');
		expect(editorDefaults.graphql).toContain('fibonacci');
		expect(editorDefaults.json).toContain('"lsp": true');
		expect(editorDefaults.json).toContain('"memo"');
		expect(editorDefaults.json).toContain('"bonus": 3');
		expect(editorDefaults.json).toContain('"outputTemplate": "fibonacci=%d"');
		expect(editorDefaults.yaml).toContain('lsp: true');
		expect(editorDefaults.yaml).toContain('memo:');
		expect(editorDefaults.yaml).toContain('bonus: 3');
		expect(editorDefaults.yaml).toContain('outputTemplate: "fibonacci=%d"');
		expect(editorDefaults.toml).toContain('lsp = true');
		expect(editorDefaults.toml).toContain('memo =');
		expect(editorDefaults.toml).toContain('bonus = 3');
		expect(editorDefaults.toml).toContain('outputTemplate = "fibonacci=%d"');
		expect(editorDefaults.html).toContain('<!doctype html>');
		expect(editorDefaults.css).toContain('font-family: system-ui');
		expect(editorDefaults.markdown).toContain('# wasm-idle');
		expect(editorDefaults.zig).toContain('std.io.getStdIn().reader()');
		expect(editorDefaults.zig).toContain('fibonacci={d}');
		expect(editorDefaults.lisp).toContain('(define (fibonacci n)');
		expect(editorDefaults.lisp).toContain('(display "fibonacci=")');
		expect(editorDefaults.haskell).toContain('fibonacci :: Int -> Int');
		expect(editorDefaults.haskell).toContain('putStrLn');
		expect(rustEditorDefaults['wasm32-wasip1']).toContain('io::stdin().read_line');
	});

	it('keeps legacy broken starters recognizable for migration', () => {
		expect(legacyBrokenTinyGoEditorDefault).toContain(`ReadString('
')`);
		expect(legacyBrokenTinyGoEditorDefault).toContain(`fibonacci=%d
", fibonacci(n)+bonus)`);
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
		expect(resolveEditorDefaultSource('julia', 'wasm32-wasip1')).toBe(editorDefaults.julia);
		expect(resolveEditorDefaultSource('nim', 'wasm32-wasip1')).toBe(editorDefaults.nim);
		expect(resolveEditorDefaultSource('clojurescript', 'wasm32-wasip1')).toBe(
			editorDefaults.clojurescript
		);
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
		expect(resolveEditorDefaultSource('cobol', 'wasm32-wasip1')).toBe(editorDefaults.cobol);
		expect(resolveEditorDefaultSource('sqlite', 'wasm32-wasip1')).toBe(editorDefaults.sqlite);
		expect(resolveEditorDefaultSource('php', 'wasm32-wasip1')).toBe(editorDefaults.php);
		expect(resolveEditorDefaultSource('json', 'wasm32-wasip1')).toBe(editorDefaults.json);
		expect(resolveEditorDefaultSource('yaml', 'wasm32-wasip1')).toBe(editorDefaults.yaml);
		expect(resolveEditorDefaultSource('toml', 'wasm32-wasip1')).toBe(editorDefaults.toml);
		expect(resolveEditorDefaultSource('html', 'wasm32-wasip1')).toBe(editorDefaults.html);
		expect(resolveEditorDefaultSource('css', 'wasm32-wasip1')).toBe(editorDefaults.css);
		expect(resolveEditorDefaultSource('markdown', 'wasm32-wasip1')).toBe(
			editorDefaults.markdown
		);
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
		expect(isEditorDefaultSource(editorDefaults.julia)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.nim)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.clojurescript)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.ocaml)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.javascript)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.typescript)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.wat)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.lua)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.haskell)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.r)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.octave)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.cobol)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.sqlite)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.php)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.json)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.yaml)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.toml)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.html)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.css)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.markdown)).toBe(true);
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
