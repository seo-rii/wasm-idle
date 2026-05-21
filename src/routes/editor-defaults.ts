import type { RustTargetTriple } from '$lib/playground/options';

export type EditorDefaultLanguage =
	| 'c'
	| 'cpp'
	| 'python'
	| 'java'
	| 'kotlin'
	| 'scala'
	| 'go'
	| 'csharp'
	| 'fsharp'
	| 'elixir'
	| 'ocaml'
	| 'rust';

export const editorDefaults: Record<
	'c' | 'cpp' | 'python' | 'java' | 'kotlin' | 'scala' | 'go' | 'csharp' | 'fsharp' | 'elixir' | 'ocaml',
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
	kotlin: `const val BONUS = 3

fun factorial(n: Int): Int =
    if (n <= 1) 1 else n * factorial(n - 1)

fun main(args: Array<String>) {
    val input = readlnOrNull()
    val n =
        input?.trim()?.toIntOrNull()
            ?: args.firstOrNull()?.toIntOrNull()
            ?: 4

    println("factorial_plus_bonus=\${factorial(n) + BONUS}")
}`,
	scala: `object Main {
    val bonus = 3

    def factorial(n: Int): Int =
        if (n <= 1) 1 else n * factorial(n - 1)

    def main(args: Array[String]): Unit = {
        val input = scala.io.StdIn.readLine()
        val n =
            try {
                if (input == null || input.trim.isEmpty) 4 else input.trim.toInt
            } catch {
                case _: NumberFormatException =>
                    args.headOption.flatMap(value => scala.util.Try(value.toInt).toOption).getOrElse(4)
            }

        println(s"factorial_plus_bonus=\${factorial(n) + bonus}")
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
  Printf.printf "factorial_plus_bonus=%d\\n%!" (factorial n + bonus)`
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
		source === editorDefaults.kotlin ||
		source === editorDefaults.scala ||
		source === editorDefaults.go ||
		source === editorDefaults.csharp ||
		source === editorDefaults.fsharp ||
		source === editorDefaults.elixir ||
		source === editorDefaults.ocaml ||
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
