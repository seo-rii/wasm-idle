# Brainfuck WASI interpreter

This runtime runs [Susam Pal's bfc interpreter](https://github.com/susam/bfc) in the browser.
`vendor/bfc.c` and `LICENSE.md` are verbatim upstream files pinned to
`b1b92fc552707bbea50b396f6f6a3e3c1e51cb55` under the MIT license.
The source and license URLs and SHA256 hashes are pinned in
`scripts/build-esolang-runtimes.mjs` and recorded in `static/wasm-brainfuck/runtime-build.json`.

The playground mounts source at `main.bf` and starts the executable with
`argv = ["bfi", "main.bf"]`. The upstream executable selects interpreter mode from the
`bfi` command name. Its compiler mode requires native subprocesses and is not exposed.
`wasi-process.c` supplies the missing `system()` ABI symbol with an ENOSYS result;
it does not change the interpreter or execute subprocesses.

The upstream interpreter uses a fixed tape of 30,000 zero-initialized unsigned 8-bit
cells, wrapping modulo 256. It starts at the first cell and supports 256 nested active
loops. Non-command source characters are ignored. `,` reads one byte from stdin and
stores zero at EOF; `.` writes the cell byte to stdout. The browser worker supplies
stdin, captures stdout/stderr, and enforces cancellation and time limits.

The interpreter's stdout/stderr transport preserves a leading UTF-8 BOM as output data.

## Rebuild and verify

Use wasi-sdk **33.0**, including its bundled Clang, linker, and wasi-libc sysroot.
There is no npm dependency or network fetch in the builder. From the repository root:

```sh
WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language brainfuck --write

node scripts/build-esolang-runtimes.mjs --language brainfuck --check

WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language brainfuck
```

`--write` updates the checked-in executable, license copy, build receipt, and generated
WASI interpreter profile. `--check` verifies all pinned inputs and checked-in artifacts
without requiring an SDK. Building without either flag recompiles into a temporary
directory and verifies that the executable and receipt reproduce byte for byte.

The recorded compiler command is equivalent to:

```sh
"$WASI_SDK_PATH/bin/clang" --target=wasm32-wasip1 -std=c99 -O2 -fno-ident \
  -Wl,--strip-all -Wl,-z,stack-size=131072 -Wl,--initial-memory=262144 \
  -Wl,--max-memory=67108864 \
  runtimes/esolangs/brainfuck/vendor/bfc.c \
  runtimes/esolangs/brainfuck/wasi-process.c \
  -o static/wasm-brainfuck/brainfuck.wasm
```

The receipt has no build timestamp or machine-specific output path. It records the
SDK revision, compiler version, exact flags, upstream commit, input hashes, and final
Wasm byte count and SHA256. The generated profile pins the same final artifact.
