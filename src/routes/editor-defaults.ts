import type { RustTargetTriple } from '$lib/playground/options';

export type EditorDefaultLanguage =
	| 'c'
	| 'cpp'
	| 'objectivec'
	| 'python'
	| 'java'
	| 'go'
	| 'd'
	| 'csharp'
	| 'fsharp'
	| 'vbnet'
	| 'elixir'
	| 'erlang'
	| 'prolog'
	| 'gleam'
	| 'perl'
	| 'tcl'
	| 'awk'
	| 'pascal'
	| 'forth'
	| 'j'
	| 'bqn'
	| 'janet'
	| 'julia'
	| 'nim'
	| 'bash'
	| 'ocaml'
	| 'javascript'
	| 'typescript'
	| 'assemblyscript'
	| 'wat'
	| 'wasm'
	| 'lua'
	| 'zig'
	| 'lisp'
	| 'ruby'
	| 'haskell'
	| 'r'
	| 'octave'
	| 'fortran'
	| 'graphql'
	| 'duckdb'
	| 'sqlite'
	| 'php'
	| 'json'
	| 'yaml'
	| 'toml'
	| 'html'
	| 'css'
	| 'markdown'
	| 'rust';

export const editorDefaults: Record<
	| 'c'
	| 'cpp'
	| 'objectivec'
	| 'python'
	| 'java'
	| 'go'
	| 'd'
	| 'csharp'
	| 'fsharp'
	| 'vbnet'
	| 'elixir'
	| 'erlang'
	| 'prolog'
	| 'gleam'
	| 'perl'
	| 'tcl'
	| 'awk'
	| 'pascal'
	| 'forth'
	| 'j'
	| 'bqn'
	| 'janet'
	| 'julia'
	| 'nim'
	| 'bash'
	| 'ocaml'
	| 'javascript'
	| 'typescript'
	| 'assemblyscript'
	| 'wat'
	| 'wasm'
	| 'lua'
	| 'zig'
	| 'lisp'
	| 'ruby'
	| 'haskell'
	| 'r'
	| 'octave'
	| 'fortran'
	| 'graphql'
	| 'duckdb'
	| 'sqlite'
	| 'php'
	| 'json'
	| 'yaml'
	| 'toml'
	| 'html'
	| 'css'
	| 'markdown',
	string
> = {
	c: `#include <stdio.h>

int main() {
    puts("Hello, WebAssembly!");
    return 0;
}`,
	cpp: `#include <iostream>

int bonus = 3;

int factorial(int n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

int main() {
    int n = 4;
    if (!(std::cin >> n)) n = 4;
    std::cout << "factorial_plus_bonus=" << factorial(n) + bonus << "\\n";
}`,
	objectivec: `#include <stdio.h>
#include <objc/runtime.h>

__attribute__((objc_root_class))
@interface FactorialRunner {
    Class isa;
}
- (int)factorial:(int)n;
@end

@implementation FactorialRunner
- (int)factorial:(int)n {
    return n <= 1 ? 1 : n * [self factorial:n - 1];
}
@end

int main(void) {
    int n = 4;
    if (scanf("%d", &n) != 1) {
        n = 4;
    }
    id runner = class_createInstance(objc_getClass("FactorialRunner"), 0);
    printf("factorial_plus_bonus=%d\\n", [runner factorial:n] + 3);
    return 0;
}`,
	python: `BONUS = 3

def factorial(n):
    return 1 if n <= 1 else n * factorial(n - 1)

tokens = input().split()
n = int(tokens[0]) if tokens else 4
print(f"factorial_plus_bonus={factorial(n) + BONUS}")`,
	java: `import java.util.Scanner;

public class Main {
    static int bonus = 3;

    static int factorial(int n) {
        return n <= 1 ? 1 : n * factorial(n - 1);
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int n = scanner.hasNextInt() ? scanner.nextInt() : 4;
        System.out.println("factorial_plus_bonus=" + (factorial(n) + bonus));
    }
}`,
	go: String.raw`package main

import (
    "bufio"
    "fmt"
    "os"
    "strconv"
    "strings"
)

const bonus = 3

func factorial(n int) int {
    if n <= 1 {
        return 1
    }
    return n * factorial(n-1)
}

func main() {
    line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
    n, err := strconv.Atoi(strings.TrimSpace(line))
    if err != nil {
        n = 4
    }
    fmt.Printf("factorial_plus_bonus=%d\n", factorial(n)+bonus)
}`,
	d: `import std.stdio;
import std.conv;
import std.string;

enum bonus = 3;

int factorial(int n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

void main() {
    auto line = stdin.readln();
    int n = 4;
    if (line.length) {
        try {
            n = to!int(line.strip());
        } catch (Exception) {
            n = 4;
        }
    }
    writeln("factorial_plus_bonus=", factorial(n) + bonus);
}`,
	csharp: `using System;

const int Bonus = 3;

static int Factorial(int n)
{
    return n <= 1 ? 1 : n * Factorial(n - 1);
}

var input = Console.ReadLine();
var commandLineArgs = Environment.GetCommandLineArgs();
var n = int.TryParse(input, out var stdinValue)
    ? stdinValue
    : commandLineArgs.Length > 1 && int.TryParse(commandLineArgs[1], out var argValue)
        ? argValue
        : 4;

Console.WriteLine($"factorial_plus_bonus={Factorial(n) + Bonus}");`,
	fsharp: `let bonus = 3

let rec factorial n =
    if n <= 1 then 1 else n * factorial (n - 1)

let input = System.Console.ReadLine()

let n =
    match System.Int32.TryParse input with
    | true, parsed -> parsed
    | false, _ ->
        let commandLineArgs = System.Environment.GetCommandLineArgs()
        let arg =
            if commandLineArgs.Length > 1 then commandLineArgs[1] else ""

        match System.Int32.TryParse arg with
        | true, parsed -> parsed
        | false, _ -> 4

printfn "factorial_plus_bonus=%d" (factorial n + bonus)`,
	vbnet: `Imports System

Module Program
    Const Bonus As Integer = 3

    Function Factorial(n As Integer) As Integer
        If n <= 1 Then
            Return 1
        End If

        Return n * Factorial(n - 1)
    End Function

    Sub Main(args As String())
        Dim input = Console.ReadLine()
        Dim n As Integer = 4

        If Not String.IsNullOrWhiteSpace(input) Then
            Integer.TryParse(input.Trim(), n)
        ElseIf args.Length > 0 Then
            Integer.TryParse(args(0), n)
        End If

        Console.WriteLine("factorial_plus_bonus={0}", Factorial(n) + Bonus)
    End Sub
End Module`,
	elixir: `defmodule Demo do
  @bonus 3

  def factorial(0), do: 1
  def factorial(1), do: 1
  def factorial(n), do: n * factorial(n - 1)

  def run do
    line = IO.gets("") || ""

    n =
      case Integer.parse(String.trim(line)) do
        {value, _rest} -> value
        :error -> 4
      end

    IO.puts("factorial_plus_bonus=#{factorial(n) + @bonus}")
    :ok
  end
end

Demo.run()`,
	erlang: `Line = io:get_line(""),
case Line of
    eof -> io:format("stdin=~s~n", [""]);
    _ -> io:format("stdin=~s", [Line])
end.`,
	prolog: `:- use_module(library(readutil)).

bonus(3).

factorial(N, Value) :-
    N =< 1,
    Value is 1.
factorial(N, Value) :-
    N > 1,
    Next is N - 1,
    factorial(Next, Previous),
    Value is N * Previous.

main :-
    read_line_to_string(user_input, Line),
    (number_string(N, Line) -> true ; N = 4),
    bonus(Bonus),
    factorial(N, Factorial),
    Result is Factorial + Bonus,
    format("factorial_plus_bonus=~w~n", [Result]).`,
	gleam: `import gleam/int
import gleam/io
import wasm_idle/stdin

const bonus = 3

fn factorial(n: Int) -> Int {
  case n <= 1 {
    True -> 1
    False -> n * factorial(n - 1)
  }
}

pub fn main() {
  let n = case int.parse(stdin.read_line()) {
    Ok(value) -> value
    Error(_) -> 4
  }
  io.println("factorial_plus_bonus=" <> int.to_string(factorial(n) + bonus))
}`,
	perl: `use strict;
use warnings;

use constant BONUS => 3;

sub factorial {
    my ($n) = @_;
    return 1 if $n <= 1;
    return $n * factorial($n - 1);
}

my $line = <STDIN>;
chomp($line //= "");
my $n = $line =~ /^-?\\d+$/ ? int($line) : 4;
print "factorial_plus_bonus=", factorial($n) + BONUS, "\\n";`,
	tcl: `set bonus 3

proc factorial {n} {
    if {$n <= 1} {
        return 1
    }
    return [expr {$n * [factorial [expr {$n - 1}]]}]
}

if {[gets stdin line] >= 0 && [string is integer -strict [string trim $line]]} {
    set n [string trim $line]
} else {
    set n 4
}

puts "factorial_plus_bonus=[expr {[factorial $n] + $bonus}]"`,
	awk: `BEGIN {
    bonus = 3
}

function factorial(n) {
    return n <= 1 ? 1 : n * factorial(n - 1)
}

{
    n = ($1 ~ /^-?[0-9]+$/) ? int($1) : 4
    print "factorial_plus_bonus=" (factorial(n) + bonus)
    exit
}

	END {
	    if (NR == 0) {
	        print "factorial_plus_bonus=" (factorial(4) + bonus)
	    }
	}`,
	pascal: `program Main;

const
  Bonus = 3;

function Factorial(N: Integer): Integer;
begin
  if N <= 1 then
    Factorial := 1
  else
    Factorial := N * Factorial(N - 1);
end;

var
  Line: String;
  Code: Integer;
  N: Integer;

begin
  ReadLn(Line);
  Val(Line, N, Code);
  if Code <> 0 then
    N := 4;
  WriteLn('factorial_plus_bonus=', Factorial(N) + Bonus);
end.`,
	forth: `: READ-NUMBER ( -- n )
  0
  BEGIN
    KEY DUP 10 <> OVER 13 <> AND
  WHILE
    48 - SWAP 10 * +
  REPEAT
  DROP
;

: FACTORIAL ( n -- n! )
  1 SWAP
  BEGIN
    DUP 1 >
  WHILE
    TUCK * SWAP 1 -
  REPEAT
  DROP
;

: PRINT-UINT ( n -- )
  0 <# #S #> TYPE
;

: RUN
  READ-NUMBER FACTORIAL 3 + ." factorial_plus_bonus=" PRINT-UINT CR
;

RUN`,
	j: `input =: 1!:1 [ 1
n =: ". input
smoutput 'factorial_plus_bonus=', ": 3 + ! n`,
	bqn: `bonus ← 3
Factorial ← {𝕩≤1 ? 1 ; 𝕩 × 𝕊 𝕩-1}
n ← •ParseFloat •GetLine @
bonus + Factorial n`,
	janet: `(def bonus 3)

(defn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))

(def n (scan-number (string/trim (getline))))
(print "factorial_plus_bonus=" (+ bonus (factorial n)))`,
	julia: `const bonus = 3

function factorial(n)
    n <= 1 ? 1 : n * factorial(n - 1)
end

line = readline()
n = tryparse(Int, strip(line))
if n === nothing
    n = 4
end

println("factorial_plus_bonus=", factorial(n) + bonus)`,
	nim: `import strutils

const bonus = 3

proc factorial(n: int): int =
  if n <= 1: 1 else: n * factorial(n - 1)

let line = stdin.readLine()
let n =
  try:
    parseInt(line.strip())
  except ValueError:
    4

echo "factorial_plus_bonus=", factorial(n) + bonus`,
	bash: `bonus=3

factorial() {
    if (( $1 <= 1 )); then
        printf '1'
    else
        printf '%d' "$(( $1 * $(factorial $(( $1 - 1 ))) ))"
    fi
}

IFS= read -r input || input=''
n="\${input:-\${1:-4}}"
printf 'factorial_plus_bonus=%d\\n' "$(( $(factorial "$n") + bonus ))"`,
	ocaml: `let bonus = 3

let rec factorial n =
  if n <= 1 then 1 else n * factorial (n - 1)

let read_int_or_default default =
  try
    match String.trim (read_line ()) with
    | "" -> default
    | value -> int_of_string value
  with
  | End_of_file
  | Failure _ -> default

let () =
  let n = read_int_or_default 4 in
  Printf.printf "factorial_plus_bonus=%d\\n%!" (factorial n + bonus)`,
	javascript: `const fs = require('fs');

const bonus = 3;

function factorial(n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

const input = fs.readLineSync(0).trim();
const n = Number.parseInt(input || '4', 10);
console.log(\`factorial_plus_bonus=\${factorial(Number.isNaN(n) ? 4 : n) + bonus}\`);`,
	typescript: `import fs from 'node:fs';

const bonus: number = 3;

function factorial(n: number): number {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

const input: string = (fs as any).readLineSync(0).trim();
const parsed = Number.parseInt(input || '4', 10);
const n = Number.isNaN(parsed) ? 4 : parsed;
console.log(\`factorial_plus_bonus=\${factorial(n) + bonus}\`);`,
	assemblyscript: `const bonus: i32 = 3;

function factorial(n: i32): i32 {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

export function factorial_plus_bonus(): i32 {
    return factorial(4) + bonus;
}`,
	wat: `(module
  (func $factorial (param $n i32) (result i32)
    local.get $n
    i32.const 1
    i32.le_s
    if (result i32)
      i32.const 1
    else
      local.get $n
      local.get $n
      i32.const 1
      i32.sub
      call $factorial
      i32.mul
    end
  )

  (func (export "factorial_plus_bonus") (result i32)
    i32.const 4
    call $factorial
    i32.const 3
    i32.add
  )
)`,
	wasm: `AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL`,
	lua: `local bonus = 3

local function factorial(n)
    if n <= 1 then
        return 1
    end
    return n * factorial(n - 1)
end

local input = io.read("*l")
local n = tonumber(input or "") or tonumber(arg[1] or "") or 4
print("factorial_plus_bonus=" .. tostring(factorial(n) + bonus))`,
	zig: `const std = @import("std");

const bonus: i32 = 3;

fn factorial(n: i32) i32 {
    return if (n <= 1) 1 else n * factorial(n - 1);
}

pub fn main() !void {
    var buffer: [64]u8 = undefined;
    const stdin = std.io.getStdIn().reader();
    const input = (try stdin.readUntilDelimiterOrEof(&buffer, '\\n')) orelse "";
    const trimmed = std.mem.trim(u8, input, " \\t\\r\\n");
    const n = std.fmt.parseInt(i32, trimmed, 10) catch 4;
    const stdout = std.io.getStdOut().writer();
    try stdout.print("factorial_plus_bonus={d}\\n", .{factorial(n) + bonus});
}`,
	lisp: `(define bonus 3)

(define (factorial n)
  (if (<= n 1)
      1
      (* n (factorial (- n 1)))))

(display "factorial_plus_bonus=")
(display (+ (factorial 4) bonus))
(newline)`,
	ruby: `BONUS = 3

def factorial(n)
  n <= 1 ? 1 : n * factorial(n - 1)
end

input = STDIN.gets&.strip
n = Integer(input || ARGV[0] || 4, exception: false) || 4
puts "factorial_plus_bonus=#{factorial(n) + BONUS}"`,
	haskell: `bonus :: Int
bonus = 3

factorial :: Int -> Int
factorial n =
  if n <= 1 then 1 else n * factorial (n - 1)

main :: IO ()
main =
  putStrLn ("factorial_plus_bonus=" ++ show (factorial 4 + bonus))`,
	r: `bonus <- 3

factorial <- function(n) {
    if (n <= 1) {
        return(1)
    }
    n * factorial(n - 1)
}

line <- readLines(stdin(), n = 1, warn = FALSE)
n <- suppressWarnings(as.integer(if (length(line)) trimws(line[[1]]) else ""))
if (is.na(n)) n <- 4

cat(sprintf("factorial_plus_bonus=%d\\n", factorial(n) + bonus))`,
	octave: `bonus = 3;

function value = factorial(n)
    if (n <= 1)
        value = 1;
    else
        value = n * factorial(n - 1);
    endif
endfunction

line = fgetl(stdin);
n = str2double(line);
if (isnan(n))
    n = 4;
endif

	printf("factorial_plus_bonus=%d\\n", factorial(n) + bonus);`,
	fortran: `      PROGRAM MAIN
      INTEGER BONUS
      BONUS = 3
      PRINT *, 'factorial_plus_bonus=', 24 + BONUS
      END`,
	graphql: `query Greeting {
    hello
}`,
	duckdb: `WITH numbers AS (
    SELECT range AS n
    FROM range(1, 5)
)
SELECT 'factorial_plus_bonus=' || CAST(24 + 3 AS VARCHAR) AS result
FROM numbers
LIMIT 1;`,
	sqlite: `CREATE TABLE numbers (n INTEGER NOT NULL);
INSERT INTO numbers VALUES (1), (2), (3), (4);

WITH RECURSIVE factorial(n, value) AS (
    SELECT 1, 1
    UNION ALL
    SELECT n + 1, value * (n + 1)
    FROM factorial
    WHERE n < (SELECT max(n) FROM numbers)
)
SELECT 'factorial_plus_bonus=' || (value + 3) AS result
FROM factorial
ORDER BY n DESC
LIMIT 1;`,
	php: `<?php
const BONUS = 3;

function factorial(int $n): int {
    return $n <= 1 ? 1 : $n * factorial($n - 1);
}

	$input = trim(file_get_contents('php://input'));
	$n = is_numeric($input) ? intval($input) : (isset($argv[1]) ? intval($argv[1]) : 4);
	echo "factorial_plus_bonus=" . (factorial($n) + BONUS) . "\\n";
	`,
	json: `{
    "name": "wasm-idle",
    "languages": ["JSON", "YAML", "TOML"],
    "lsp": true
}`,
	yaml: `name: wasm-idle
languages:
  - JSON
  - YAML
  - TOML
lsp: true
`,
	toml: `name = "wasm-idle"
languages = ["JSON", "YAML", "TOML"]
lsp = true
`,
	html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>wasm-idle</title>
  </head>
  <body>
    <main>
      <h1>Hello from wasm-idle</h1>
    </main>
  </body>
</html>`,
	css: `:root {
  color-scheme: light dark;
}

main {
  max-width: 64rem;
  margin: 0 auto;
  font-family: system-ui, sans-serif;
}`,
	markdown: `# wasm-idle

Edit Markdown with browser-hosted LSP features.

## Links

[Project](#wasm-idle)
`
};

export const rustEditorDefaults: Record<RustTargetTriple, string> = {
	'wasm32-wasip1': `use std::io;

static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`,
	'wasm32-wasip2': `#[cfg(not(target_env = "p2"))]
compile_error!("This example requires wasm32-wasip2.");

use std::env;
use std::io;

// Pass an optional label through Args to prove preview2 CLI args are wired.
static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let preview2_label = env::args().nth(1).unwrap_or_else(|| "preview2-cli".to_string());
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview2_component={}", preview2_label);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`,
	'wasm32-wasip3': `#[cfg(not(target_env = "p3"))]
compile_error!("This example requires wasm32-wasip3.");

use std::env;
use std::io;

// wasm32-wasip3 is currently a transitional component target in the browser runtime.
static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let preview3_label = env::args()
        .nth(1)
        .unwrap_or_else(|| "preview3-transition".to_string());
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview3_transition={}", preview3_label);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`
};

export const legacyBrokenTinyGoEditorDefault = `package main

import (
    "bufio"
    "fmt"
    "os"
    "strconv"
    "strings"
)

const bonus = 3

func factorial(n int) int {
    if n <= 1 {
        return 1
    }
    return n * factorial(n-1)
}

func main() {
    line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
    n, err := strconv.Atoi(strings.TrimSpace(line))
    if err != nil {
        n = 4
    }
    fmt.Printf("factorial_plus_bonus=%d\n", factorial(n)+bonus)
}`;

export const legacyBrokenFsharpEditorDefault = `let bonus = 3

let rec factorial n =
    if n <= 1 then 1 else n * factorial (n - 1)

let input = System.Console.ReadLine()

let n =
    match System.Int32.TryParse input with
    | true, parsed -> parsed
    | false, _ ->
        System.Environment.GetCommandLineArgs()
        |> Array.skip 1
        |> Array.tryHead
        |> Option.bind (fun value ->
            match System.Int32.TryParse value with
            | true, parsed -> Some parsed
            | false, _ -> None)
        |> Option.defaultValue 4

printfn "factorial_plus_bonus=%d" (factorial n + bonus)`;

export function isEditorDefaultSource(source: string) {
	return (
		source === editorDefaults.c ||
		source === editorDefaults.cpp ||
		source === editorDefaults.python ||
		source === editorDefaults.java ||
		source === editorDefaults.go ||
		source === editorDefaults.d ||
		source === editorDefaults.csharp ||
		source === editorDefaults.fsharp ||
		source === editorDefaults.vbnet ||
		source === editorDefaults.elixir ||
		source === editorDefaults.erlang ||
		source === editorDefaults.prolog ||
		source === editorDefaults.gleam ||
		source === editorDefaults.perl ||
		source === editorDefaults.tcl ||
		source === editorDefaults.awk ||
		source === editorDefaults.pascal ||
		source === editorDefaults.forth ||
		source === editorDefaults.j ||
		source === editorDefaults.bqn ||
		source === editorDefaults.janet ||
		source === editorDefaults.julia ||
		source === editorDefaults.nim ||
		source === editorDefaults.bash ||
		source === editorDefaults.ocaml ||
		source === editorDefaults.javascript ||
		source === editorDefaults.typescript ||
		source === editorDefaults.assemblyscript ||
		source === editorDefaults.wat ||
		source === editorDefaults.wasm ||
		source === editorDefaults.lua ||
		source === editorDefaults.zig ||
		source === editorDefaults.lisp ||
		source === editorDefaults.ruby ||
		source === editorDefaults.haskell ||
		source === editorDefaults.r ||
		source === editorDefaults.octave ||
		source === editorDefaults.fortran ||
		source === editorDefaults.graphql ||
		source === editorDefaults.duckdb ||
		source === editorDefaults.sqlite ||
		source === editorDefaults.php ||
		source === editorDefaults.json ||
		source === editorDefaults.yaml ||
		source === editorDefaults.toml ||
		source === editorDefaults.html ||
		source === editorDefaults.css ||
		source === editorDefaults.markdown ||
		source === rustEditorDefaults['wasm32-wasip1'] ||
		source === rustEditorDefaults['wasm32-wasip2'] ||
		source === rustEditorDefaults['wasm32-wasip3']
	);
}

export function isLegacyEditorDefaultSource(source: string) {
	return source === legacyBrokenTinyGoEditorDefault || source === legacyBrokenFsharpEditorDefault;
}

export function resolveEditorDefaultSource(
	language: EditorDefaultLanguage,
	rustTargetTriple: RustTargetTriple
) {
	return language === 'rust'
		? rustEditorDefaults[rustTargetTriple]
		: editorDefaults[language] || '';
}
