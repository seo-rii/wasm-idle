# Original bc WASI producer

The pinned `vendor/bc-7.0.3.tar.xz` is the original BSD-2-Clause release from
Gavin Howard. Its exact size and SHA-256 are checked before extraction. The only
source patch adapts unavailable asynchronous signals and signal masks to WASI;
native Wasm exception handling preserves the original setjmp/longjmp control flow.
No language parser, evaluator or numeric operation is replaced.

Use wasi-sdk 33.0 (Clang 22.1.0), a native C compiler for the upstream string
generator, POSIX `sh`, `make`, `patch`, and Python 3.11 or newer:

```sh
python3 runtimes/wasm-bc/build.py --build-dir ./out/bc-build
node scripts/sync-wasm-bc.mjs --source runtimes/wasm-bc/dist
node scripts/sync-wasm-bc.mjs --check
```

Each checkout uses its own build directory. Source paths are remapped to stable
prefixes. Website builds verify committed artifacts without downloading or building
a toolchain. History, native line editors, NLS and documentation generation are off;
GNU extensions and the math library remain enabled.

The static runtime includes bc's original license and the wasi-libc/compiler-rt
license texts. wasi-libc sources correspond to wasi-sdk 33's submodule revision
`161b3195fc2558d2b1ba3eb9ffae3b2b47407623`; compiler-rt texts come from LLVM 22.1.0.
The build receipt hashes the original archive, platform patch, recipe and notices.
See [the execution contract](../../docs/bc.md).
