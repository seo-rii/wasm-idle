# Whitespace WASI interpreter

This runtime runs [koturn's Whitespace interpreter](https://github.com/koturn/Whitespace),
including the version 0.3 copy and slide instructions. `vendor/whitespace.c` and
`LICENSE` are verbatim MIT-licensed upstream files pinned to
`22a57aab21ff4a0307642383b0eb3660e1bb412d`. No handwritten language parser or
instruction executor is used. The build applies the documented two-line
`fix-zero-dividend.patch` to a temporary copy of that original source.

The source and license URLs and SHA256 hashes are pinned in
`scripts/build-esolang-runtimes.mjs` and recorded in
`static/wasm-whitespace/runtime-build.json`.

The playground mounts source at `main.ws` and runs
`argv = ["whitespace", "/main.ws"]`. The source is a filesystem file;
program stdin remains a separate stream. Non-whitespace source characters are
ignored by the original interpreter. Source files are limited to **65,535 UTF-8
bytes**, leaving a NUL terminator in its 65,536-byte source buffer. This limit
counts comments and other non-whitespace characters as well.

The original runtime has a 1 MiB bytecode buffer and 65,536-element data stack,
heap and call stack. Stack and heap values are signed 32-bit integers under wasm32.
Its `getchar` instruction reads a byte into the heap and stores -1 at EOF;
character output writes a byte, allowing UTF-8 text to be echoed byte for byte.
Numeric input and output use the upstream `scanf("%d")` and `printf("%d")`
behavior. Arithmetic division and remainder follow signed C integer operations. The build
patch corrects the original divide/remainder guards to check the divisor (`a`)
instead of the dividend (`b`). Thus zero divided by a nonzero integer returns
zero, while a zero divisor still aborts with the original assertion handling.
Each browser execution starts with a new WebAssembly instance and receives the
existing worker's stdin, output and cancellation handling.

The interpreter retains its original diagnostics and assertions. Undefined
commands can print a diagnostic while execution continues; invalid stack or heap
access can abort the WASI program. Its halt instruction ends execution without
adding text to stdout. The browser adapter does not reinterpret malformed source
or replace these behaviors.

## Rebuild and verify

Use wasi-sdk **33.0**. From the repository root:

```sh
WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language whitespace --write

node scripts/build-esolang-runtimes.mjs --language whitespace --check

WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language whitespace
```

`--write` updates only the selected runtime's executable, license and build receipt,
then regenerates the shared interpreter profile. `--check` verifies pinned inputs
and checked-in artifacts without requiring an SDK. Building with neither flag
recompiles into a temporary directory and checks byte-for-byte reproducibility.
The system `patch` command is required; no npm dependency or network fetch is required.
The build verifies the patch SHA256, applies it with zero fuzz to a temporary
source copy, and records both original and patched-source hashes in the receipt.
Clang reads the patched source through stdin so assertion file names and the
resulting WASM do not contain machine-specific temporary paths.

The compiler command is:

```sh
cp runtimes/esolangs/whitespace/vendor/whitespace.c /tmp/whitespace.c
patch --batch --fuzz=0 --silent /tmp/whitespace.c \
  runtimes/esolangs/whitespace/fix-zero-dividend.patch

"$WASI_SDK_PATH/bin/clang" --target=wasm32-wasip1 -std=c99 -O2 -fno-ident \
  -Wl,--strip-all -Wl,-z,stack-size=131072 -Wl,--initial-memory=3145728 \
  -Wl,--max-memory=67108864 -x c - \
  -o static/wasm-whitespace/whitespace.wasm < /tmp/whitespace.c
```

Only standard wasi-libc APIs are linked, including `getopt_long` for the original
command line. The 3 MiB initial memory accommodates the original fixed-size
source, bytecode, stacks and heap without reducing their capacity. The receipt
records the SDK revision, compiler version, exact flags, upstream pin, input
hashes, Wasm size and SHA256 without a timestamp or machine-specific output path.
