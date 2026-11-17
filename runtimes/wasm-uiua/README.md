# Original Uiua console interpreter

This producer embeds the upstream Uiua 0.19.1 compiler and interpreter in a small
console host. It compiles original `.ua` files inside the browser's WASI Worker;
standard input/output, arguments and workspace files use the original `NativeSys`
implementation. The wrapper preserves reports, exit codes and final stack output.

The crate archive is pinned by byte count and SHA-256 in `build.py`, and dependency
versions and checksums are pinned in `Cargo.lock`. Only `native_sys` is enabled;
optional native multimedia, FFI, networking and battery libraries are outside this
text execution profile. `patches/wasi-clock.patch` changes two platform selections
so WASI uses its real system clock instead of requiring browser JavaScript. It
does not replace language parsing, compilation or evaluation.

Use Rust 1.94.0 with its `wasm32-wasip1` target installed. From the repository root:

```sh
python3 runtimes/wasm-uiua/build.py --target-dir ./out/uiua-build
node scripts/sync-wasm-uiua.mjs --source runtimes/wasm-uiua/dist
node scripts/sync-wasm-uiua.mjs --check
```

Each physical checkout must use its own target directory. The producer maps local
source paths to stable prefixes, so interpreter panic strings do not embed the
developer's home directory. Builds use one Cargo job and no incremental cache.
The default output is the ignored producer `dist/` directory. Website builds verify
the committed runtime and do not require compiling Rust again.

`runtime-build.json` records the upstream source, toolchain, enabled features,
wrapper, lockfile and platform patch hashes and each distributed artifact.
`LICENSE.txt` preserves Uiua's MIT license; `THIRD_PARTY_NOTICES.txt` preserves
compiled dependencies and Rust standard-library notices. Highway 1.3.0 omits its
license from the crate archive, so the exact original license is retained under
`licenses/` from upstream commit `680018dd521955907bb5749343abf96c2029aab4`.

The public execution contract and supported host features are documented in
[`docs/uiua.md`](../../docs/uiua.md).
