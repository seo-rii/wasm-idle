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
	| 'clojurescript'
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
	| 'cobol'
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
	| 'clojurescript'
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
	| 'cobol'
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

static int bonus = 3;
static int memo[64] = {1, 1};

int fibonacci(int n) {
    if (n <= 1) {
        return 1;
    }
    if (memo[n] != 0) {
        return memo[n];
    }
    int value = fibonacci(n - 1) + fibonacci(n - 2);
    memo[n] = value;
    return value;
}

int main() {
    int n = 4;
    if (scanf("%d", &n) != 1 || n < 0 || n >= 64) {
        n = 4;
    }
    printf("fibonacci=%d\\n", fibonacci(n) + bonus);
    return 0;
}`,
	cpp: `#include <iostream>
#include <unordered_map>

int bonus = 3;
std::unordered_map<int, int> memo = {{0, 1}, {1, 1}};

int fibonacci(int n) {
    auto cached = memo.find(n);
    if (cached != memo.end()) {
        return cached->second;
    }
    int value = n <= 1 ? 1 : fibonacci(n - 1) + fibonacci(n - 2);
    memo[n] = value;
    return value;
}

int main() {
    int n = 4;
    if (!(std::cin >> n)) n = 4;
    std::cout << "fibonacci=" << fibonacci(n) + bonus << "\\n";
}`,
	objectivec: `#include <stdio.h>
#include <objc/runtime.h>

static int memo[64] = {1, 1};

__attribute__((objc_root_class))
@interface FibonacciRunner {
    Class isa;
}
- (int)fibonacci:(int)n;
@end

@implementation FibonacciRunner
- (int)fibonacci:(int)n {
    if (n <= 1) {
        return 1;
    }
    if (memo[n] != 0) {
        return memo[n];
    }
    int value = [self fibonacci:n - 1] + [self fibonacci:n - 2];
    memo[n] = value;
    return value;
}
@end

int main(void) {
    int n = 4;
    if (scanf("%d", &n) != 1 || n < 0 || n >= 64) {
        n = 4;
    }
    id runner = class_createInstance(objc_getClass("FibonacciRunner"), 0);
    printf("fibonacci=%d\\n", [runner fibonacci:n] + 3);
    return 0;
}`,
	python: `from functools import lru_cache

BONUS = 3

@lru_cache(maxsize=None)
def fibonacci(n):
    return 1 if n <= 1 else fibonacci(n - 1) + fibonacci(n - 2)

tokens = input().split()
n = int(tokens[0]) if tokens else 4
print(f"fibonacci={fibonacci(n) + BONUS}")`,
java: `import java.util.HashMap;
import java.util.Map;
import java.util.Scanner;

public class Main {
    static int bonus = 3;
    static Map<Integer, Integer> memo = new HashMap<>();

    static {
        memo.put(0, 1);
        memo.put(1, 1);
    }

    static int fibonacci(int n) {
        Integer cached = memo.get(n);
        if (cached != null) {
            return cached;
        }
        int value = n <= 1 ? 1 : fibonacci(n - 1) + fibonacci(n - 2);
        memo.put(n, value);
        return value;
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int n = scanner.hasNextInt() ? scanner.nextInt() : 4;
        System.out.println("fibonacci=" + (fibonacci(n) + bonus));
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
var memo = map[int]int{0: 1, 1: 1}

func fibonacci(n int) int {
    if v, ok := memo[n]; ok {
        return v
    }
    v := 1
    if n > 1 {
        v = fibonacci(n - 1) + fibonacci(n - 2)
    }
    memo[n] = v
    return v
}

func main() {
    line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
    n, err := strconv.Atoi(strings.TrimSpace(line))
    if err != nil {
        n = 4
    }
    fmt.Printf("fibonacci=%d\n", fibonacci(n)+bonus)
}`,
d: `import std.stdio;
import std.conv;
import std.string;

enum bonus = 3;
int[int] memo = [0: 1, 1: 1];

int fibonacci(int n) {
    if (auto cached = n in memo) {
        return *cached;
    }
    int value = n <= 1 ? 1 : fibonacci(n - 1) + fibonacci(n - 2);
    memo[n] = value;
    return value;
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
    writeln("fibonacci=", fibonacci(n) + bonus);
}`,
csharp: `using System;
using System.Collections.Generic;

const int Bonus = 3;
static readonly Dictionary<int, int> Memo = new() { [0] = 1, [1] = 1 };

static int Fibonacci(int n)
{
    if (Memo.TryGetValue(n, out var cached))
    {
        return cached;
    }

    int value = n <= 1 ? 1 : Fibonacci(n - 1) + Fibonacci(n - 2);
    Memo[n] = value;
    return value;
}

var input = Console.ReadLine();
var commandLineArgs = Environment.GetCommandLineArgs();
var n = int.TryParse(input, out var stdinValue)
    ? stdinValue
    : commandLineArgs.Length > 1 && int.TryParse(commandLineArgs[1], out var argValue)
        ? argValue
        : 4;

Console.WriteLine($"fibonacci={Fibonacci(n) + Bonus}");`,
fsharp: `let bonus = 3

let memo = System.Collections.Generic.Dictionary<int, int>()

let rec fibonacci n =
    if n <= 1 then
        1
    else if memo.ContainsKey n then
        memo[n]
    else
        let value = fibonacci(n - 1) + fibonacci(n - 2)
        memo.Add(n, value)
        value

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

printfn "fibonacci=%d" (fibonacci n + bonus)`,
vbnet: `Imports System
Imports System.Collections.Generic

Module Program
    Const Bonus As Integer = 3
    Dim Memo As New Dictionary(Of Integer, Integer) From {
        {0, 1},
        {1, 1}
    }

    Function Fibonacci(n As Integer) As Integer
        If n <= 1 Then
            Return 1
        End If
        Dim cached As Integer
        If Memo.TryGetValue(n, cached) Then
            Return cached
        End If

        Dim value As Integer = Fibonacci(n - 1) + Fibonacci(n - 2)
        Memo.Add(n, value)
        Return value
    End Function

    Sub Main(args As String())
        Dim input = Console.ReadLine()
        Dim n As Integer = 4

        If Not String.IsNullOrWhiteSpace(input) Then
            Integer.TryParse(input.Trim(), n)
        ElseIf args.Length > 0 Then
            Integer.TryParse(args(0), n)
        End If

        Console.WriteLine("fibonacci={0}", Fibonacci(n) + Bonus)
    End Sub
End Module`,
elixir: `defmodule Demo do
  @bonus 3

  def run do
    Process.put(:fibonacci_cache, %{0 => 1, 1 => 1})

    line = IO.gets("") || ""

    n =
      case Integer.parse(String.trim(line)) do
        {value, _rest} -> value
        :error -> 4
      end

    IO.puts("fibonacci=#{fibonacci(n) + @bonus}")
    :ok
  end

  defp fibonacci(n) when n <= 1, do: 1
  defp fibonacci(n) do
    cache = Process.get(:fibonacci_cache, %{0 => 1, 1 => 1})
    case Map.get(cache, n) do
      nil ->
        value = fibonacci(n - 1) + fibonacci(n - 2)
        Process.put(:fibonacci_cache, Map.put(cache, n, value))
        value

      value ->
        value
    end
  end
end

Demo.run()`,
erlang: `ensure_fibonacci_cache() ->
    case ets:info(fibonacci_cache) of
        undefined ->
            ets:new(fibonacci_cache, [named_table, public, set]),
            ets:insert(fibonacci_cache, [{0, 1}, {1, 1}]),
            ok;
        _ ->
            ok
    end.

fibonacci(0) -> 1;
fibonacci(1) -> 1;
fibonacci(N) when N > 1 ->
    case ets:lookup(fibonacci_cache, N) of
        [{_, Value}] ->
            Value;
        [] ->
            Value = fibonacci(N - 1) + fibonacci(N - 2),
            ets:insert(fibonacci_cache, {N, Value}),
            Value
    end.

main() ->
    ensure_fibonacci_cache(),
    Line = io:get_line(""),
    N = case string:trim(Line, trailing, "\n") of
        "" -> 4;
        Value ->
            case string:to_integer(Value) of
                {Parsed, ""} when Parsed >= 0 -> Parsed;
                _ -> 4
            end
    end,
    io:format("fibonacci=~w~n", [fibonacci(N) + 3]).`,
	prolog: `:- use_module(library(readutil)).

bonus(3).

:- dynamic memo/2.
memo(0, 1).
memo(1, 1).

fibonacci(N, Value) :-
    memo(N, Value).
fibonacci(N, Value) :-
    N > 1,
    PrevN is N - 1,
    PrevNMinusTwo is N - 2,
    fibonacci(PrevN, Prev1),
    fibonacci(PrevNMinusTwo, Prev2),
    Value is Prev1 + Prev2,
    asserta(memo(N, Value)).

main :-
    read_line_to_string(user_input, Line),
    (number_string(N, Line) -> true ; N = 4),
    bonus(Bonus),
    fibonacci(N, Cached),
    Result is Cached + Bonus,
    format("fibonacci=~w~n", [Result]).`,
	gleam: `import gleam/int
import gleam/io
import wasm_idle/stdin

const bonus = 3

fn fibonacci(n: Int) -> Int {
  case n <= 1 {
    True -> 1
    False -> fibonacci(n - 1) + fibonacci(n - 2)
  }
}

pub fn main() {
  let n = case int.parse(stdin.read_line()) {
    Ok(value) -> value
    Error(_) -> 4
  }
  io.println("fibonacci=" <> int.to_string(fibonacci(n) + bonus))
}`,
perl: `use strict;
use warnings;

use constant BONUS => 3;
my %memo = (0 => 1, 1 => 1);

sub fibonacci {
    my ($n) = @_;
    return 1 if $n <= 1;
    return $memo{$n} if exists $memo{$n};
    my $value = fibonacci($n - 1) + fibonacci($n - 2);
    $memo{$n} = $value;
    return $value;
}

my $line = <STDIN>;
chomp($line //= "");
my $n = $line =~ /^-?\\d+$/ ? int($line) : 4;
print "fibonacci=", fibonacci($n) + BONUS, "\\n";`,
tcl: `set bonus 3
array set memo {0 1 1 1}

proc fibonacci {n} {
    global memo
    if {$n <= 1} {
        return 1
    }
    if {[info exists memo($n)]} {
        return $memo($n)
    }
    set memo($n) [expr {[fibonacci [expr {$n - 1}] + [fibonacci [expr {$n - 2}]]}]
    return $memo($n)
}

if {[gets stdin line] >= 0 && [string is integer -strict [string trim $line]]} {
    set n [string trim $line]
} else {
    set n 4
}

puts "fibonacci=[expr {[fibonacci $n] + $bonus}]"`,
awk: `BEGIN {
    bonus = 3
    memo[0] = 1
    memo[1] = 1
}

function fibonacci(n) {
    if (memo[n] != "") return memo[n]
    memo[n] = (n <= 1) ? 1 : fibonacci(n - 1) + fibonacci(n - 2)
    return memo[n]
}

{
    n = ($1 ~ /^-?[0-9]+$/) ? int($1) : 4
    print "fibonacci=" (fibonacci(n) + bonus)
    exit
}

	END {
	    if (NR == 0) {
	        print "fibonacci=" (fibonacci(4) + bonus)
	    }
	}`,
pascal: `program Main;

const
  Bonus = 3;

type
  TMemo = array [0..63] of Integer;

var
  Memo: TMemo = (1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

function Fibonacci(N: Integer): Integer;
begin
  if N <= 1 then
    Fibonacci := 1
  else if Memo[N] <> 0 then
    Fibonacci := Memo[N]
  else
    begin
      Memo[N] := Fibonacci(N - 1) + Fibonacci(N - 2);
      Fibonacci := Memo[N];
    end;
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
  if N < 0 then
    N := 4;
  WriteLn('fibonacci=', Fibonacci(N) + Bonus);
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

: FIBONACCI ( n -- n )
  1 SWAP
  BEGIN
    DUP 2 >
  WHILE
    TUCK + SWAP 1 -
  REPEAT
  DROP
;

: PRINT-UINT ( n -- )
  0 <# #S #> TYPE
;

: RUN
  READ-NUMBER FIBONACCI 3 + ." fibonacci=" PRINT-UINT CR
;

RUN`,
j: `input =: 1!:1 [ 1
n =: ". input
fib =: 3 : 0
  if. y < 2 do.
    1
  else.
    (fib y - 1) + (fib y - 2)
  end.
)
smoutput 'fibonacci=', ": 3 + fib n`,
	bqn: `bonus ← 3
fibonacci ← {𝕩 ≤ 1 ? 1 ; (fibonacci (𝕩 - 1)) + (fibonacci (𝕩 - 2))}
n ← •ParseFloat •GetLine @
bonus + fibonacci n`,
	janet: `(def bonus 3)

(defn fibonacci [n]
  (if (<= n 1)
    1
    (+ (fibonacci (- n 1)) (fibonacci (- n 2)))))

(def n (scan-number (string/trim (getline))))
(print "fibonacci=" (+ bonus (fibonacci n)))`,
julia: `const bonus = 3

memo = Dict(0 => 1, 1 => 1)

function fibonacci(n)
    if n <= 1
        return 1
    end

    if haskey(memo, n)
        return memo[n]
    end

    result = fibonacci(n - 1) + fibonacci(n - 2)
    memo[n] = result
    return result
end

line = readline()
n = tryparse(Int, strip(line))
if n === nothing
    n = 4
end

println("fibonacci=", fibonacci(n) + bonus)`,
nim: `import tables
import strutils

const bonus = 3
var memo = initTable[int, int]()
memo[0] = 1
memo[1] = 1

proc fibonacci(n: int): int =
  if n <= 1:
    1
  elif memo.hasKey(n):
    memo[n]
  else:
    let result = fibonacci(n - 1) + fibonacci(n - 2)
    memo[n] = result
    result

let line = stdin.readLine()
let n =
  try:
    parseInt(line.strip())
  except ValueError:
    4

echo "fibonacci=", fibonacci(n) + bonus`,
bash: `bonus=3
declare -A memo=( [0]=1 [1]=1 )

fibonacci() {
    local n=$1
    if (( n <= 1 )); then
        printf '1'
        return
    fi
    if [[ -n \${memo[$n]+set} ]]; then
        printf '%d' "\${memo[$n]}"
    else
        local value=$(( $(fibonacci "$(( n - 1 ))") + $(fibonacci "$(( n - 2 ))") ))
        memo[$n]=$value
        printf '%d' "$value"
    fi
}

IFS= read -r input || input=''
n="\${input:-\${1:-4}}"
printf 'fibonacci=%d\\n' "$(( $(fibonacci "$n") + bonus ))"`,
clojurescript: `(ns wasm-idle.main
  (:require [wasm-idle.runtime :as runtime]))

(def bonus 3)
(def memo (atom {0 1 1 1}))

(defn fibonacci [n]
  (if (<= n 1)
    1
    (if-let [cached (get @memo n)]
      cached
      (let [result (+ (fibonacci (dec n)) (fibonacci (dec (dec n))))]
        (swap! memo assoc n result)
        result))))

(let [line (runtime/read-line)
      arg (first (runtime/args))
      parsed (js/parseInt (or line arg "4") 10)
      n (if (js/isNaN parsed) 4 parsed)]
  (println (str "fibonacci=" (+ (fibonacci n) bonus))))`,
ocaml: `let bonus = 3

let memo = Hashtbl.create 16

let rec fibonacci n =
  if n <= 1 then
    1
  else if Hashtbl.mem memo n then
    Hashtbl.find memo n
  else
    let result = fibonacci(n - 1) + fibonacci(n - 2) in
    Hashtbl.add memo n result;
    result

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
  Printf.printf "fibonacci=%d\\n%!" (fibonacci n + bonus)`,
	javascript: `const fs = require('fs');

const bonus = 3;
const memo = new Map();

function fibonacci(n) {
    if (memo.has(n)) {
        return memo.get(n);
    }
    const value = n <= 1 ? 1 : fibonacci(n - 1) + fibonacci(n - 2);
    memo.set(n, value);
    return value;
}

const input = fs.readLineSync(0).trim();
const n = Number.parseInt(input || '4', 10);
console.log(\`fibonacci=\${fibonacci(Number.isNaN(n) ? 4 : n) + bonus}\`);`,
	typescript: `import fs from 'node:fs';

const bonus: number = 3;
const memo = new Map<number, number>();

function fibonacci(n: number): number {
    const cached = memo.get(n);
    if (cached !== undefined) {
        return cached;
    }
    const value = n <= 1 ? 1 : fibonacci(n - 1) + fibonacci(n - 2);
    memo.set(n, value);
    return value;
}

const input: string = (fs as any).readLineSync(0).trim();
const parsed = Number.parseInt(input || '4', 10);
const n = Number.isNaN(parsed) ? 4 : parsed;
console.log(\`fibonacci=\${fibonacci(n) + bonus}\`);`,
assemblyscript: `const bonus: i32 = 3;
const memo = new Int32Array(64);
memo[0] = 1;
memo[1] = 1;

function fibonacci(n: i32): i32 {
    if (n <= 1) {
        return 1;
    }
    if (memo[n] != 0) {
        return memo[n];
    }
    const value = fibonacci(n - 1) + fibonacci(n - 2);
    memo[n] = value;
    return value;
}

export function fibonacci(): i32 {
    return fibonacci(4) + bonus;
}`,
	wat: `(module
  (func $fibonacci (param $n i32) (result i32)
    local.get $n
    i32.const 1
    i32.le_s
    if (result i32)
      i32.const 1
    else
      local.get $n
      i32.const 1
      i32.sub
      call $fibonacci
      local.get $n
      i32.const 2
      i32.sub
      call $fibonacci
      i32.add
    end
  )

  (func (export "fibonacci") (result i32)
    i32.const 4
    call $fibonacci
    i32.const 3
    i32.add
  )
)`,
	wasm: `AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL`,
lua: `local bonus = 3

local memo = { [0] = 1, [1] = 1 }

local function fibonacci(n)
    if n <= 1 then
        return 1
    end
    if memo[n] ~= nil then
        return memo[n]
    end
    local value = fibonacci(n - 1) + fibonacci(n - 2)
    memo[n] = value
    return value
end

local input = io.read("*l")
local n = tonumber(input or "") or tonumber(arg[1] or "") or 4
print("fibonacci=" .. tostring(fibonacci(n) + bonus))`,
	zig: `const std = @import("std");

const bonus: i32 = 3;

fn fibonacci(n: i32) i32 {
    return if (n <= 1) 1 else fibonacci(n - 1) + fibonacci(n - 2);
}

pub fn main() !void {
    var buffer: [64]u8 = undefined;
    const stdin = std.io.getStdIn().reader();
    const input = (try stdin.readUntilDelimiterOrEof(&buffer, '\\n')) orelse "";
    const trimmed = std.mem.trim(u8, input, " \\t\\r\\n");
    const n = std.fmt.parseInt(i32, trimmed, 10) catch 4;
    const stdout = std.io.getStdOut().writer();
    try stdout.print("fibonacci={d}\\n", .{fibonacci(n) + bonus});
}`,
lisp: `(define bonus 3)
(define memo (make-hash-table))
(setf (gethash 0 memo) 1)
(setf (gethash 1 memo) 1)

(define (fibonacci n)
  (if (<= n 1)
      1
      (or (gethash n memo)
          (setf (gethash n memo) (+ (fibonacci (- n 1)) (fibonacci (- n 2)))))))

(defun read-int-or-4 ()
  (or
    (ignore-errors
      (let ((line (read-line)))
        (parse-integer (string-trim '(#\Space #\Tab #\Newline #\Return) line))))
    4))

(display "fibonacci=")
(display (+ (fibonacci (read-int-or-4)) bonus))
(newline)`,
ruby: `BONUS = 3

$cache = { 0 => 1, 1 => 1 }

def fibonacci(n)
  return $cache[n] if $cache.key?(n)
  $cache[n] = fibonacci(n - 1) + fibonacci(n - 2)
  $cache[n]
end

input = STDIN.gets&.strip
n = Integer(input || ARGV[0] || 4, exception: false) || 4
puts "fibonacci=#{fibonacci(n) + BONUS}"`,
haskell: `import Text.Read (readMaybe)

bonus :: Int
bonus = 3

memoizedFibonacci :: [Int]
memoizedFibonacci = 1 : 1 : zipWith (+) (tail memoizedFibonacci) (tail $ tail memoizedFibonacci)

fibonacci :: Int -> Int
fibonacci n = memoizedFibonacci !! n

main :: IO ()
main = do
  input <- getContents
  let n = case words input of
        (token : _) ->
          case readMaybe token of
            Just value -> value
            Nothing -> 4
        [] -> 4
  putStrLn ("fibonacci=" ++ show (fibonacci n + bonus))`,
	r: `bonus <- 3

memo <- c(1, 1)
fibonacci <- function(n) {
    if (n <= 1) {
        return(1)
    }
    if (n + 1 <= length(memo) && !is.na(memo[n + 1])) {
        return(memo[n + 1])
    }
    if (n + 1 > length(memo)) {
        memo <<- c(memo, rep(NA, n + 1 - length(memo)))
    }
    memo[n + 1] <<- fibonacci(n - 1) + fibonacci(n - 2)
    return(memo[n + 1])
}

line <- readLines(stdin(), n = 1, warn = FALSE)
n <- suppressWarnings(as.integer(if (length(line)) trimws(line[[1]]) else ""))
if (is.na(n)) n <- 4

cat(sprintf("fibonacci=%d\\n", fibonacci(n) + bonus))`,
octave: `bonus = 3;

global memo;
memo = [1, 1];

function value = fibonacci(n)
    global memo;
    if (n <= 1)
        value = 1;
    else
        if (numel(memo) >= n + 1 && memo(n + 1) != 0)
            value = memo(n + 1);
        else
            memo(n + 1) = fibonacci(n - 1) + fibonacci(n - 2);
            value = memo(n + 1);
    endif
endfunction

line = fgetl(stdin);
n = str2double(line);
if (isnan(n))
    n = 4;
endif

	printf("fibonacci=%d\\n", fibonacci(n) + bonus);`,
fortran: `      PROGRAM MAIN
      INTEGER BONUS, N, RESULT
      INTEGER IO_STAT
      INTEGER MEMO(0:63)
      SAVE MEMO
      DATA MEMO /1, 1, 62*0/

      BONUS = 3
      READ (*, *, IOSTAT=IO_STAT) N
      IF (IO_STAT .NE. 0 .OR. N .LT. 0 .OR. N .GT. 63) THEN
          N = 4
      END IF
      RESULT = FIBONACCI(N)
      PRINT *, 'fibonacci=', RESULT + BONUS
      END

      INTEGER FUNCTION FIBONACCI(N)
      INTEGER N
      INTEGER MEMO(0:63)
      INTEGER VALUE
      SAVE MEMO

      IF (N .LE. 1) THEN
          VALUE = 1
      ELSE IF (MEMO(N) .NE. 0) THEN
          VALUE = MEMO(N)
      ELSE
          VALUE = FIBONACCI(N - 1) + FIBONACCI(N - 2)
          MEMO(N) = VALUE
      END IF

      FIBONACCI = VALUE
      END`,
	cobol: `identification division.
program-id. main.
data division.
working-storage section.
01 input-value pic x(16).
01 n pic s9(4) value 4.
01 index pic s9(4).
01 counter pic s9(4).
01 memo-value.
   05 memo pic s9(9) occurs 65 times.
01 cached-result pic s9(9).
01 result-value pic z(9)9.
procedure division.
accept input-value.
if input-value not = spaces
    move function numval(input-value) to n
end-if.
if n < 0 or n > 63
    move 4 to n
end-if.
move 1 to memo(1).
move 1 to memo(2).
if memo(n + 1) = 0 and n > 1
    perform varying counter from 3 by 1 until counter > n + 1
        compute memo(counter) = memo(counter - 1) + memo(counter - 2)
    end-perform
end-if.
compute index = n + 1.
move memo(index) to cached-result.
if cached-result = 0
    compute cached-result = 1
end-if.
compute result-value = cached-result + 3.
display "fibonacci=" result-value.
stop run.`,
	graphql: `# memo cache: 0 => 1, 1 => 1
query Fibonacci($n: Int = 4) {
  fibonacci(n: $n)
}`,
duckdb: `WITH RECURSIVE memo(n, prev, curr) AS (
    SELECT 0, 1, 1
    UNION ALL
    SELECT n + 1, curr, prev + curr
    FROM memo
    WHERE n < 4
)
SELECT 'fibonacci=' || CAST(curr + 3 AS VARCHAR) AS result
FROM memo
WHERE n = 4
LIMIT 1;`,
sqlite: `WITH RECURSIVE memo(n, prev, curr) AS (
    SELECT 0, 1, 1
    UNION ALL
    SELECT n + 1, curr, prev + curr
    FROM memo
    WHERE n < 4
)
SELECT 'fibonacci=' || CAST(curr + 3 AS TEXT) AS result
FROM memo
WHERE n = 4
LIMIT 1;`,
php: `<?php
const BONUS = 3;
$memo = [
    0 => 1,
    1 => 1,
];

function fibonacci(int $n): int {
    global $memo;
    if (isset($memo[$n])) {
        return $memo[$n];
    }
    $value = $n <= 1 ? 1 : fibonacci($n - 1) + fibonacci($n - 2);
    $memo[$n] = $value;
    return $value;
}

	$input = trim(file_get_contents('php://input'));
	$n = is_numeric($input) ? intval($input) : (isset($argv[1]) ? intval($argv[1]) : 4);
	echo "fibonacci=" . (fibonacci($n) + BONUS) . "\\n";
	`,
	json: `{
  "name": "wasm-idle",
  "languages": ["JSON", "YAML", "TOML"],
  "lsp": true,
  "memo": {
    "0": 1,
    "1": 1
  },
  "bonus": 3,
  "input": {
    "n": 4
  },
  "outputTemplate": "fibonacci=%d"
}`,
	yaml: `name: wasm-idle
languages:
  - JSON
  - YAML
  - TOML
lsp: true
memo:
  "0": 1
  "1": 1
bonus: 3
input:
  n: 4
outputTemplate: "fibonacci=%d"
`,
	toml: `name = "wasm-idle"
languages = ["JSON", "YAML", "TOML"]
lsp = true
memo = { "0" = 1, "1" = 1 }
bonus = 3
outputTemplate = "fibonacci=%d"

[input]
n = 4
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
use std::collections::HashMap;

static BONUS: i32 = 3;

fn fibonacci(n: i32, memo: &mut HashMap<i32, i32>) -> i32 {
    if n <= 1 {
        return 1;
    }
    if let Some(value) = memo.get(&n) {
        return *value;
    }
    let value = fibonacci(n - 1, memo) + fibonacci(n - 2, memo);
    memo.insert(n, value);
    value
}

fn main() {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    let mut memo = HashMap::new();
    memo.insert(0, 1);
    memo.insert(1, 1);
    println!("fibonacci={}", fibonacci(n, &mut memo) + BONUS);
}`,
	'wasm32-wasip2': `#[cfg(not(target_env = "p2"))]
compile_error!("This example requires wasm32-wasip2.");

use std::env;
use std::io;
use std::collections::HashMap;

// Pass an optional label through Args to prove preview2 CLI args are wired.
static BONUS: i32 = 3;

fn fibonacci(n: i32, memo: &mut HashMap<i32, i32>) -> i32 {
    if n <= 1 {
        return 1;
    }
    if let Some(value) = memo.get(&n) {
        return *value;
    }
    let value = fibonacci(n - 1, memo) + fibonacci(n - 2, memo);
    memo.insert(n, value);
    value
}

fn main() {
    let preview2_label = env::args().nth(1).unwrap_or_else(|| "preview2-cli".to_string());
    let mut memo = HashMap::new();
    memo.insert(0, 1);
    memo.insert(1, 1);
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview2_component={}", preview2_label);
    println!("fibonacci={}", fibonacci(n, &mut memo) + BONUS);
}`,
	'wasm32-wasip3': `#[cfg(not(target_env = "p3"))]
compile_error!("This example requires wasm32-wasip3.");

use std::env;
use std::io;
use std::collections::HashMap;

// wasm32-wasip3 is currently a transitional component target in the browser runtime.
static BONUS: i32 = 3;

fn fibonacci(n: i32, memo: &mut HashMap<i32, i32>) -> i32 {
    if n <= 1 {
        return 1;
    }
    if let Some(value) = memo.get(&n) {
        return *value;
    }
    let value = fibonacci(n - 1, memo) + fibonacci(n - 2, memo);
    memo.insert(n, value);
    value
}

fn main() {
    let preview3_label = env::args()
        .nth(1)
        .unwrap_or_else(|| "preview3-transition".to_string());
    let mut memo = HashMap::new();
    memo.insert(0, 1);
    memo.insert(1, 1);
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview3_transition={}", preview3_label);
    println!("fibonacci={}", fibonacci(n, &mut memo) + BONUS);
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

func fibonacci(n int) int {
    if n <= 1 {
        return 1
    }
    return fibonacci(n - 1) + fibonacci(n - 2)
}

func main() {
    line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
    n, err := strconv.Atoi(strings.TrimSpace(line))
    if err != nil {
        n = 4
    }
    fmt.Printf("fibonacci=%d\n", fibonacci(n)+bonus)
}`;

export const legacyBrokenFsharpEditorDefault = `let bonus = 3

let rec fibonacci n =
    if n <= 1 then 1 else fibonacci(n - 1) + fibonacci(n - 2)

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

printfn "fibonacci=%d" (fibonacci n + bonus)`;

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
		source === editorDefaults.clojurescript ||
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
		source === editorDefaults.cobol ||
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
