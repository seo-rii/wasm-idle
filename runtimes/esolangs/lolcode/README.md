# LOLCODE WASI interpreter

This runtime compiles the original [Justin Meza lci interpreter](https://github.com/justinmeza/lci/tree/0b32ed1cc52abd1971d199db9bd77c387316cae1)
to WASI using wasi-sdk **33.0**. The seven C source files, six headers and
`COPYING` are verbatim upstream files pinned to tag `v1.3`, commit
`0b32ed1cc52abd1971d199db9bd77c387316cae1`. The lexer, tokenizer, parser,
interpreter, Unicode tables and command line run unchanged. There is no
replacement parser or instruction executor.

lci is licensed under **GPL-3.0-or-later**, as stated in the source headers.
The complete interpreter source and original `COPYING` are included here;
`static/wasm-lolcode/LICENSE.txt` is the same GPL license text. The build script
and this README supply the build instructions for the checked-in executable.
Source and license URLs, sizes and SHA256 hashes are pinned in
`scripts/build-esolang-runtimes.mjs` and recorded in
`static/wasm-lolcode/runtime-build.json`.

The playground mounts the active source file, normally `main.lol`, and invokes
`argv = ["lci", "/main.lol"]`. Program input stays on fd 0, separate from the
source file. Each execution creates a fresh WebAssembly instance and filesystem.
The interpreter supports the original LOLCODE 1.3 implementation, including
functions, recursion, loops, conditional control, casts, BUKKIT slots and
Unicode code point and normative-name escapes. The original command line's
version banner remains `v0.10.5`; it is not rewritten to match the tag name.

## Input and interpreter behavior

`GIMMEH` reads a line into a YARN and consumes its line terminator. EOF yields
an empty YARN; a final line without a newline is also accepted. The original
loop treats both CR and LF as terminators and stops on a NUL byte. UTF-8 bytes
in line input are preserved. `VISIBLE` adds a newline unless the statement
ends with `!`.

For example:

```text
HAI 1.3
I HAS A name
GIMMEH name
VISIBLE name
KTHXBYE
```

With stdin `한글🙂\n`, this prints `한글🙂\n`. With empty stdin, it prints
one newline. NUMBR uses signed 32-bit C integers under wasm32; NUMBAR uses
the original C `float` representation. YARN values are NUL-terminated C
strings, so a `:(0)` escape truncates subsequent string output.

Original diagnostics and exit statuses are preserved. Invalid source or an
undefined variable can produce a nonzero exit status and diagnostic; the
adapter reports this as a failed execution. The existing execution timeout,
output limit and cancellation handling also apply. The executable starts
with 2 MiB of linear memory, can grow to 64 MiB, and uses a 128 KiB C stack.

## Rebuild and verify

From the repository root, using wasi-sdk 33.0:

```sh
WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language lolcode --write

node scripts/build-esolang-runtimes.mjs --language lolcode --check

WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language lolcode
```

`--write` updates the selected executable, license, build receipt and shared
interpreter profile. `--check` verifies pinned source, licensing, artifact
hashes and the profile without a compiler. With neither flag, the script
rebuilds into a temporary directory and compares the executable and receipt
byte for byte. There is no network fetch or npm dependency installation.

The exact compiler command is:

```sh
"$WASI_SDK_PATH/bin/clang" --target=wasm32-wasip1 -std=c99 -O2 -fno-ident \
  -Wl,--strip-all -Wl,-z,stack-size=131072 -Wl,--initial-memory=2097152 \
  -Wl,--max-memory=67108864 \
  runtimes/esolangs/lolcode/vendor/main.c \
  runtimes/esolangs/lolcode/vendor/error.c \
  runtimes/esolangs/lolcode/vendor/interpreter.c \
  runtimes/esolangs/lolcode/vendor/lexer.c \
  runtimes/esolangs/lolcode/vendor/parser.c \
  runtimes/esolangs/lolcode/vendor/tokenizer.c \
  runtimes/esolangs/lolcode/vendor/unicode.c \
  -lm -o static/wasm-lolcode/lolcode.wasm
```

The only linked libraries are standard wasi-libc and libm. The build receipt
records exact inputs, flags, compiler and Wasm hash without a timestamp or
machine-specific output path. Native lci, Node WASI and the browser WASI shim
were compared using upstream input, function, recursion, loop and Unicode
fixtures, plus UTF-8/EOF/NUL input, BUKKIT slots, arithmetic and diagnostics.
