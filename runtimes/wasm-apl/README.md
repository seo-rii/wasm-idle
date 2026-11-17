# GNU APL browser producer

This producer compiles the official GNU APL 2.0 release to a standalone WASI
console. The original parser, operators, traditional functions and XML workspace
archive engine execute in the browser.

The pinned release is
[`apl-2.0.tar.gz`](https://ftp.gnu.org/gnu/apl/apl-2.0.tar.gz): 5,128,916 bytes,
SHA-256 `24bbb744fce47e62837234a053bdeecee51b9ea61c82c79f7cc191bc6a54c0a1`.
`source-pins.json` records the toolchain revision and third-party notices.

Use the existing wasi-sdk 33.0 release and a fresh private scratch directory:

```sh
python3 runtimes/wasm-apl/build.py \
  --scratch-dir /path/to/apl-build \
  --wasi-sdk /path/to/wasi-sdk-33 \
  --output-dir runtimes/wasm-apl/dist
node scripts/sync-wasm-apl.mjs --source runtimes/wasm-apl/dist
node scripts/sync-wasm-apl.mjs --check
```

The recipe verifies the original source and licenses, configures the original
single-core CLI without optional native libraries, and compiles the upstream
sources with standard Wasm C++ exceptions. It explicitly disables Clang's
implicit external Binaryen invocation. Build metadata, file paths and timestamps
are normalized. The scratch limit defaults to 80 MiB, with an additional stop
before free storage falls below 32 MiB. No native compiler bootstrap is needed.

`wasi-platform.patch` contains only host portability and batch status reporting:
the original custom output handlers use `std::streambuf` with libc++, fd 3 stays
a WASI workspace preopen, memory reporting uses the Wasm ceiling, terminal
queries report unavailable, and already-reported uncaught errors mark failure.
`port/` supplies explicit unavailable-operation results for native host APIs.
It preserves GNU APL's parser, evaluator and function semantics.

Committed browser assets include the executable, build receipt, GPL text and
complete dependency notices. Website builds verify their exact hashes and
producer inputs without downloading or compiling a toolchain. See
[`docs/apl.md`](../../docs/apl.md) for execution behavior and host limitations.
