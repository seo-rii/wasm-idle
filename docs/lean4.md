# Lean 4 browser execution and language server

`LEAN4` runs programs with the real upstream Lean 4.34.1 (`leanprover/lean4@5045d005`) frontend
and IR interpreter: each run is `lean -j1 --run Main.lean [args...]`. The compiler is built for
wasm32 Emscripten (with pthreads) by
[`wasm-llvm/producer/lean-browser`](https://github.com/seo-rii/wasm-llvm/tree/14ea5ecbc514b0c87338aebf8f2b567020be5750/producer/lean-browser),
which also compiles the `Init` library with that wasm32 build (`.olean` files are pointer-size
specific). Lean is Apache-2.0; the statically linked libuv is MIT.

Select **Lean 4** or use `?lang=lean4` (`lean` is an alias).

## Assets

```sh
pnpm run sync:wasm-lean4      # download from the pinned wasm-llvm commit
pnpm run compress:static-runtimes # refresh the playground Service Worker delivery manifest
pnpm run prepare:app
pnpm run test:browser:lean4
```

`sync:wasm-lean4` downloads every file from
`https://raw.githubusercontent.com/seo-rii/wasm-llvm/<revision>/artifacts/lean-browser/` with the
revision pinned in `scripts/wasm-lean4-assets.lock.json`. It checks each size and SHA-256 hash,
and the decoded hash of each gzip file with a bounded output size, before replacing
`static/wasm-lean4/` (ignored by Git). The sync also requires the runtime independently of the
producer receipt and validates the exact receipt asset set, library chunk/file ranges, complete
module parts, and combined library digest.
`--source /path/to/wasm-llvm/artifacts/lean-browser` reads a local checkout instead. The generated
`packages/lsp/src/bundledLean4Runtime.ts` binds the lock and the execution Worker hash;
`src/lib/playground/wasmLean4Version.ts` re-exports this shared profile; a different
release requires a reviewed lock update. `page:build` runs the sync.

The pinned release includes the stricter validation from wasm-llvm PR #43. Its receipt records
`same-byte-repackage` and retains the original receipt: the compiler and all eleven runtime,
library, and notice files are byte-identical to the previous release. This update requalifies
those files without claiming a new compiler build.

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

## Original language server

Enable **LSP** with Lean 4 selected to use the original 4.34.1 language server in the browser.
The editor reuses the same reviewed compiler and `Init` assets as execution. No alternative parser,
compiler-output diagnostic adapter, remote server, or replacement language handler is involved.

```ts
import { getLean4LanguageServer } from '@wasm-idle/lsp/lean4';

const server = await getLean4LanguageServer({
	currentUrl: location.href,
	rootUrl: '/wasm-idle/'
	// Optional relocation of the unchanged, receipt-pinned distribution:
	// lean4: { baseUrl: 'https://cdn.example.com/wasm-lean4/' }
});
// Pass server.transport to an LSP client; dispose it when the editor closes.
```

The browser host starts the original `--server` watchdog to obtain its real `initialize` response.
The native watchdog cannot spawn child processes in Emscripten (`ENOSYS`, error 52), so the host
then launches the original `lean -j4 --worker <document-uri>` in a dedicated Web Worker for each
active document process. FileWorker consumes the original initialize parameters and didOpen, then
its original request handlers perform hover, completion, definition, document symbols, semantic
features and diagnostics through the original `Content-Length` stdin/stdout protocol. The host
tracks client/server request IDs independently and aligns case variants of the active document URI
for Monaco. Native-watchdog
workspace symbols, references, rename, call hierarchy and experimental project capabilities are
removed from the original capability response and return a standard unsupported-method error.

Only the Emscripten platform glue is adapted: pthreads receive the shared stdin ring, fd 0 reads
that ring without blocking other FS/stdout proxies, and completed pthreads return to the pool
through Emscripten's native proxy queue. The pthread pool is preallocated to 64, and the actual
WASI process-exit event is forwarded even when Emscripten keepalive suppresses its optional
`onExit` callback. An SDK supervisor owns every physical process and pthread Worker and explicitly
terminates them on disposal, startup abort, and process replacement; it does not rely on nested Worker
termination cascading automatically.
Lean's original [ServerTask](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/Lean/Server/ServerTask.lean)
uses dedicated threads. Pools of 16 and 32 exhausted during elaboration; the browser test uses
45–53 initial thread spawns without a late worker allocation. Subsequent tasks reuse completed
threads. Exceeding the fixed pool fails explicitly.
The Wasm bytes, compiler, elaborator and language handlers are unchanged. A document's MEMFS copies
the shared library source bytes so user evaluation cannot modify another process's library pack.

The supported editor profile is one active `.lean` buffer per handle, with `Init` imports. Opening
another buffer replaces the previous process. No Lake builds, package downloads, Mathlib, `Std`
or `Lean` library imports, or project-wide reference index are supplied. Changing the import header
uses the original FileWorker restart signal (exit 2) and relaunches with the current full buffer.
Cross-origin isolation, module/nested workers, WebAssembly exceptions and pthreads are required;
Chromium is the tested browser. The default per-process Wasm limit is 1 GiB, configurable through
`lean4.maxMemoryBytes`. The first download is about 143 MB; verified persistent assets are shared
with execution. The SDK ships only host code, while `sync:wasm-lean4` prepares the pinned assets.
The original Apache-2.0 and libuv MIT notices remain in the distribution.

Verification commands:

```sh
pnpm --filter @wasm-idle/lsp build
WASM_IDLE_LEAN4_LSP_BROWSER=1 node --test scripts/lean4-lsp-browser.test.mjs
WASM_IDLE_RUN_REAL_BROWSER_LSP=1 WASM_IDLE_LSP_BROWSER_LANGUAGES=LEAN4 \
  pnpm exec vitest run src/routes/monaco-lsp.playwright.test.ts
```

The SDK browser test checks original initialize, a request before didOpen, completion, hover,
local definition, versioned type diagnostics, correction, import restart, repeated edits, UTF-8
frames and UTF-16 edits, unsupported project requests, cache reuse, timeout/startup abort and
complete process/pthread disposal. The Monaco matrix checks the production editor path
and SHA-pinned lazy assets. Browser tests are opt-in; ordinary Node test discovery does not start a
browser or import browser tooling.
