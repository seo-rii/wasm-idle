# Lean 4 browser execution

`LEAN4` runs programs with the real upstream Lean 4.34.1 (`leanprover/lean4@5045d005`) frontend
and IR interpreter: each run is `lean -j1 --run Main.lean [args...]`. The compiler is built for
wasm32 Emscripten (with pthreads) by
[`wasm-llvm/producer/lean-browser`](https://github.com/seo-rii/wasm-llvm/tree/5369745f777673710c25cd67c52310b004cfe41a/producer/lean-browser),
which also compiles the `Init` library with that wasm32 build (`.olean` files are pointer-size
specific). Lean is Apache-2.0; the statically linked libuv is MIT.

Select **Lean 4** or use `?lang=lean4` (`lean` is an alias).

## Assets

```sh
pnpm run sync:wasm-lean4      # download from the pinned wasm-llvm commit
pnpm run prepare:app
pnpm run test:browser:lean4
```

`sync:wasm-lean4` downloads every file from
`https://raw.githubusercontent.com/seo-rii/wasm-llvm/<revision>/artifacts/lean-browser/` with the
revision pinned in `scripts/wasm-lean4-assets.lock.json`. It checks each size and SHA-256 hash,
and the decoded hash of each gzip file, before replacing `static/wasm-lean4/` (ignored by Git).
`--source /path/to/wasm-llvm/artifacts/lean-browser` reads a local checkout instead. The generated
`src/lib/playground/wasmLean4Version.ts` binds the lock and the consumer Worker hash; a different
release requires a reviewed lock update. `page:build` runs the sync.

| Static file                                     |        Bytes |     Decoded |
| ----------------------------------------------- | -----------: | ----------: |
| `lean.mjs`                                      |      108,528 |             |
| `lean.wasm.gz.bin`                              |   20,239,874 | 113,033,667 |
| `lean-init-00…05.pack.gz.bin` (6 files)         |  122,381,720 | 276,581,368 |
| `lean-init.index.json`, `producer-receipt.json` | about 326 KB |             |

The first run downloads about 143 MB (cached afterwards by the runtime asset cache). The browser
verifies every asset before transferring it to a fresh module Worker. The Worker verifies the
assets again, inflates them, writes the 3,245 `Init` library files into Emscripten MEMFS, and
then calls `callMain`. `runtimeAssets.lean4.baseUrl` relocates the reviewed bundle.

## Supported execution contract

- Single-file programs with `def main : IO Unit` or `IO UInt32`, optionally taking
  `(args : List String)`; the process exit code is returned.
- `Init` is the only importable library. `import Std`, `import Lean`, and Lake packages are
  unavailable because those `.olean` files are not shipped.
- Stdin is streaming (`(← IO.getStdin).getLine` waits for terminal input; EOF yields `""`).
  Stdout is line-buffered like a native terminal, so call `(← IO.getStdout).flush` after a prompt
  without a newline.
- Elaboration messages are reported as editor diagnostics and kept in the output with the
  workspace prefix removed (`Main.lean:2:14: error: ...`).
- The page must be cross-origin isolated (SharedArrayBuffer for pthreads). The default Wasm
  memory limit is 1 GiB; importing `Init` grows memory to about 370 MiB, so the minimum is
  256 MiB initial and about 512 MiB in practice. A small program takes about 7-15 s per run in
  Chromium, mostly verification, inflation, and import.
