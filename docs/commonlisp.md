# Common Lisp browser integration

`COMMONLISP` (aliases `CL`, `COMMON_LISP`, `COMMON-LISP`, `ECL`) runs upstream
[Embeddable Common-Lisp](https://ecl.common-lisp.dev/) **26.5.5** (LGPL-2.1-or-later) compiled to
WebAssembly by the separate
[`wasm-llvm/producer/ecl-browser`](https://github.com/seo-rii/wasm-llvm/tree/main/producer/ecl-browser)
producer. The reader, bytecode compiler/interpreter, CLOS, conditions, bignums, `LOAD` and the
Boehm collector are ECL's own code; nothing is translated or emulated. The existing `LISP` id is
unchanged and still selects Puppy Scheme.

## Assets

`scripts/wasm-commonlisp-assets.lock.json` pins one wasm-llvm commit plus the size and SHA-256 of
the release files `ecl.mjs`, `ecl.wasm.gz` and `producer-receipt.json`, and of the decompressed
`ecl.wasm` (`runtime`). `pnpm sync:wasm-commonlisp` downloads exactly those bytes from
`https://raw.githubusercontent.com/seo-rii/wasm-llvm/<commit>/artifacts/ecl-browser/`, checks the
producer receipt (ECL source commit, Node and Chromium acceptance, gzip delivery hash), checks that
`ecl.wasm.gz` decompresses to the pinned `ecl.wasm`, and writes the ignored
`static/wasm-commonlisp/` directory (the Wasm is stored as `ecl.wasm.gz.bin` so static hosts never
add `Content-Encoding`) with the generated `runner-worker.js`. The code-pinned
`src/lib/playground/wasmCommonLispVersion.ts` profile is regenerated from the same lock.
`--source /path/to/wasm-llvm/artifacts/ecl-browser` syncs from a local producer checkout instead;
the bytes must still match the lock. `pnpm page:build` runs the sync before layering and
compressing static runtimes. `runtimeAssets.commonlisp.baseUrl` relocates the bundle.

The browser downloads the gzip-compressed Wasm (`ecl.wasm.gz.bin`, see the lock for the exact size;
about 4.6 MB decompressed) plus an 80 KB loader. The host preflights every file against the pinned
receipts, decompresses the Wasm with `DecompressionStream('gzip')` into an exactly sized buffer and
verifies the logical `ecl.wasm` hash, then transfers owned bytes to a fresh module Worker, which
verifies them again before instantiating ECL.

## Execution

Each run creates a new Worker and a new ECL instance with a caller-owned memory (64 MiB initial,
bounded by `limits.maxWasmMemoryBytes`, at most 2 GiB). Workspace files are written to
`/workspace`, which is also the current directory, so `(load "helpers.lisp")` works. ECL is
invoked as `ecl --norc --eval <form>`, where the form `LOAD`s the active file inside
`HANDLER-BIND` on `SERIOUS-CONDITION`, after setting `*LOAD-VERBOSE*` and `*COMPILE-VERBOSE*` to
`NIL` so nested `LOAD`s of workspace files do not print `;;; Loading` notes. An unhandled condition prints
`;;; Unhandled <type>: <condition>` to stderr and fails the run with a runtime error, so ECL never
enters its interactive debugger and never consumes program input.

Terminal input streams through the shared stdin ring when the page is cross-origin isolated
(`READ-LINE`, `READ`, `READ-CHAR`, EOF via Ctrl+D or the EOF button). Partial reads return
available bytes immediately so prompts flushed with `FINISH-OUTPUT` appear before input. Without
`SharedArrayBuffer`, prebuffered `stdin` is used and followed by EOF.

## Limitations

- Only ECL's bytecode compiler is available (no C compiler in the browser). Contrib modules such
  as ASDF and sockets are not bundled; there are no threads and no program arguments.
- ECL's `-O0` Emscripten build uses large engine frames, and V8 first runs Wasm with its baseline
  (Liftoff) compiler, whose frames are larger still. In a Chromium Worker, interpreted non-tail
  recursion deeper than about 150 levels exhausts the JavaScript call stack before ECL's own
  guard can signal `STACK-OVERFLOW` (Node's main thread reaches about 1000); the run then fails
  with a "Common Lisp stack overflow" runtime error. Prefer iteration (`LOOP`, `DO`) or
  accumulator-style recursion for deep data.

## Tests

```sh
pnpm sync:wasm-commonlisp
pnpm exec vitest run src/lib/playground/commonlisp.test.ts src/lib/sync-wasm-commonlisp.test.ts
pnpm test:browser:commonlisp
```

The Chromium suite drives the real sandbox (delayed `READ-LINE`/`READ` input and EOF, unhandled
conditions, reader errors, workspace `LOAD`, CLOS and bignums, recursion overflow, cancellation,
output/memory/time limits) and the playground UI (language selector, default editor sample and
delayed terminal input).

The synced runtime includes `THIRD_PARTY_NOTICES.txt` with the copyright notices and
licenses of ECL, its bundled GMP and Boehm GC, and the Emscripten runtime.
