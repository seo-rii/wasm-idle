# Befunge-93 WASI interpreter

This runtime runs language author Chris Pressey's [Befunge-93 reference interpreter](https://github.com/catseye/Befunge-93).
`vendor/bef.c` and `LICENSE` are verbatim upstream files pinned to
`8fe4065c0415b6f6fa6f699798fa9b64737aadc1`. The interpreter source uses the
BSD-3-Clause license documented in the upstream license's `src` section.
The other upstream documentation and examples are not included in this runtime.

The source and license URLs and SHA256 hashes are pinned in
`scripts/build-esolang-runtimes.mjs` and recorded in
`static/wasm-befunge93/runtime-build.json`. No handwritten language parser or
instruction executor is used.

The playground mounts source at `main.b93` and runs
`argv = ["bef", "-q", "./main.b93"]`. `-q` suppresses the upstream startup banner.
The source path is the final argument; program stdin remains a separate stream.
The original interpreter copies that path into a 128-byte buffer. The browser profile
limits source paths to 125 UTF-8 bytes, leaving space for the `./` prefix and the
terminating NUL byte. The prefix resolves under the WASI root preopen and supplies a
dot even for extensionless filenames, avoiding the original CLI's automatic `.bf`
suffix without changing the interpreter source.

The interpreter executes the original 80-column by 25-row torus, including
two-dimensional movement, string mode, stack operations, arithmetic, random direction,
and self-modifying `p`/`g` instructions. Cells on its stack are signed 32-bit `long`
values under wasm32. `&` reads a signed decimal number and returns -1 on invalid input
or EOF. `~` reads a byte, and `,` emits a byte; UTF-8 text can be echoed byte for byte.
`.` emits a decimal integer followed by a space. Each browser execution starts with
a new WebAssembly instance and receives the existing worker's stdin, output and
cancellation handling.

## Rebuild and verify

Use wasi-sdk **33.0**. From the repository root:

```sh
WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language befunge93 --write

node scripts/build-esolang-runtimes.mjs --language befunge93 --check

WASI_SDK_PATH="$HOME/.local/share/wasi-sdk-33" TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language befunge93
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
  -Wl,--max-memory=67108864 -D_POSIX_C_SOURCE=200809L \
  runtimes/esolangs/befunge93/vendor/bef.c \
  -o static/wasm-befunge93/befunge93.wasm
```

Only standard wasi-libc APIs are linked. The POSIX definition follows the upstream
Makefile and selects its `nanosleep` implementation for debugger delay; the browser
profile runs without the debugger. The receipt records the SDK revision, compiler
version, exact flags, upstream pin, input hashes, Wasm size and SHA256 without a
timestamp or machine-specific output path.
