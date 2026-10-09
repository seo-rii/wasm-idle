# Malbolge WASI interpreter

This runtime runs Ben Olmstead's original 1998 Malbolge interpreter, preserved by
[Try It Online](https://github.com/TryItOnline/malbolge). `vendor/malbolge.c` is the
verbatim upstream file pinned to `b08698709872be370c050a825f4f3c0b224e0be8`.
Its opening comment places the interpreter in the public domain. `LICENSE` is an
exact extraction of that source header, including its original notice; the build
script verifies the extraction against the pinned source. The build receipt uses
`LicenseRef-Public-Domain` to describe this notice. No handwritten language parser
or instruction executor is used.

The source URL and SHA256 hash are pinned in `scripts/build-esolang-runtimes.mjs`
and recorded in `static/wasm-malbolge/runtime-build.json`. The license receipt links
to the original source and explicitly records that it is a source-header extraction.

The playground mounts source at `main.mal` and runs
`argv = ["malbolge", "/main.mal"]`. The source is a filesystem file;
program stdin remains a separate stream. The original loader skips the six ASCII
C whitespace characters: space, tab, newline, vertical tab, form feed and carriage
return. The browser rejects source with fewer than two remaining UTF-8 bytes before
invoking the interpreter, because the original memory initializer reads the last
two loaded source cells. This is a loader precondition, not a replacement parser.
All instruction validation and execution remain in the original C implementation.

The interpreter has 59,049 memory cells and uses unsigned 16-bit values under
wasm32. It retains the original positional instruction mapping, ternary crazy
operation, rotation, jumps and self-modifying instruction encryption. Input reads
one byte with `getc` and sets the accumulator to 59,048 at EOF. Output writes the
accumulator's low byte with `putc`; UTF-8 text can be echoed byte for byte. A halt
instruction adds no output. The original loader reports invalid printable source
and more than 59,049 significant source bytes as failures. Each browser execution
starts with a new WebAssembly instance and receives the existing worker's stdin,
output and cancellation handling.

## Rebuild and verify

Use wasi-sdk **33.0**. From the repository root:

```sh
WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language malbolge --write

node scripts/build-esolang-runtimes.mjs --language malbolge --check

WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language malbolge
```

`--write` updates only the selected runtime's executable, license and build receipt,
then regenerates the shared interpreter profile. `--check` verifies pinned inputs
and checked-in artifacts without requiring an SDK. Building with neither flag
recompiles into a temporary directory and checks byte-for-byte reproducibility.
No npm dependency or network fetch is required.

The compiler command is:

```sh
"$WASI_SDK_PATH/bin/clang" --target=wasm32-wasip1 -std=c99 -O2 -fno-ident \
  -Wl,--strip-all -Wl,-z,stack-size=131072 -Wl,--initial-memory=262144 \
  -Wl,--max-memory=67108864 runtimes/esolangs/malbolge/vendor/malbolge.c \
  -o static/wasm-malbolge/malbolge.wasm
```

Only standard wasi-libc APIs are linked. Its `malloc.h` include is provided by the
SDK and needs no compatibility shim. The receipt records the SDK revision,
compiler version, exact flags, upstream pin, input hashes, Wasm size and SHA256
without a timestamp or machine-specific output path.
