# Standard ML browser runtime

This producer compiles Andreas Rossberg's original HaMLet 2.0.1 Standard ML
implementation to WASI using MLton 20241230 and GMP 6.3.0. The original parser,
elaborator, evaluator and Standard Basis sources execute in the browser. The
adapter does not implement or translate SML syntax.

The embedding patch exposes a quiet, failure-reporting file entry point using
HaMLet's existing compilation and execution functions. Basis source files are
embedded in the executable and created in a reserved private directory before
the user program is loaded. Stdin and stdout use MLton's native WASI TextIO. A separate, narrow MLton
WASI pointer patch preserves signed stack displacements with LLVM 22; it fixes
a startup trap that also affects an ordinary MLton hello-world program.

Build inputs and output artifacts are pinned by SHA-256. The producer uses a
separate scratch directory for each physical checkout. Website builds verify
the committed artifacts and do not rebuild the toolchain.

See `docs/sml.md` for the public execution contract.

Use wasi-sdk 33 and a dedicated scratch directory:

```sh
python3 runtimes/wasm-sml/build.py --scratch-dir ./out/sml-build --wasi-sdk /path/to/wasi-sdk-33
node scripts/sync-wasm-sml.mjs --source runtimes/wasm-sml/dist
node scripts/sync-wasm-sml.mjs --check
```

The recipe downloads pinned original archives, builds GMP and the MLton WASI
runtime, then compiles the original HaMLet sources with the two recorded port
patches and host wrapper. It uses a native MLton compiler only during production;
the browser receives the standalone interpreter and embedded Basis library.
GMP is distributed under its GPL-2.0-or-later option; dependency copyright and
license texts accompany the browser assets.
