import type { RustTargetTriple } from '$lib/playground/options';

export type EditorDefaultLanguage = 'cpp' | 'python' | 'java' | 'go' | 'elixir' | 'ocaml' | 'rust';

export const editorDefaults: Record<'cpp' | 'python' | 'java' | 'go' | 'elixir' | 'ocaml', string> = {
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

export function isEditorDefaultSource(source: string) {
	return (
		source === editorDefaults.cpp ||
		source === editorDefaults.python ||
		source === editorDefaults.java ||
		source === editorDefaults.go ||
		source === editorDefaults.elixir ||
		source === editorDefaults.ocaml ||
		source === rustEditorDefaults['wasm32-wasip1'] ||
		source === rustEditorDefaults['wasm32-wasip2'] ||
		source === rustEditorDefaults['wasm32-wasip3']
	);
}

export function isLegacyEditorDefaultSource(source: string) {
	return source === legacyBrokenTinyGoEditorDefault;
}

export function resolveEditorDefaultSource(
	language: EditorDefaultLanguage,
	rustTargetTriple: RustTargetTriple
) {
	return language === 'rust' ? rustEditorDefaults[rustTargetTriple] : editorDefaults[language] || '';
}
