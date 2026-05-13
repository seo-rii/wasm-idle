import type { RustTargetTriple } from '$lib/playground/options';

export type EditorDefaultLanguage =
	| 'c'
	| 'cpp'
	| 'python'
	| 'java'
	| 'go'
	| 'elixir'
	| 'ocaml'
	| 'rust';

export const editorDefaults: Record<
	'c' | 'cpp' | 'python' | 'java' | 'go' | 'elixir' | 'ocaml',
	string
> = {
	c: `#include <stdio.h>

int main() {
    puts("Hello, WebAssembly!");
    return 0;
}`,
	cpp: `#include <iostream>

int main() {
    std::cout << "Hello, WebAssembly!" << std::endl;
    return 0;
}`,
	python: `print("Hello, WebAssembly!")`,
	java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, WebAssembly!");
    }
}`,
	go: String.raw`package main

import "fmt"

func main() {
    fmt.Println("Hello, WebAssembly!")
}`,
	elixir: `IO.puts("Hello, WebAssembly!")`,
	ocaml: `let () = print_endline "Hello, WebAssembly!"`
};

export const rustEditorDefaults: Record<RustTargetTriple, string> = {
	'wasm32-wasip1': `fn main() {
    println!("Hello, WebAssembly!");
}`,
	'wasm32-wasip2': `#[cfg(not(target_env = "p2"))]
compile_error!("This example requires wasm32-wasip2.");

fn main() {
    println!("Hello, WebAssembly!");
}`,
	'wasm32-wasip3': `#[cfg(not(target_env = "p3"))]
compile_error!("This example requires wasm32-wasip3.");

fn main() {
    println!("Hello, WebAssembly!");
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
		source === editorDefaults.c ||
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
	return language === 'rust'
		? rustEditorDefaults[rustTargetTriple]
		: editorDefaults[language] || '';
}
