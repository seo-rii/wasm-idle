# Original nimlsp browser producer

`python3 producers/nim-lsp/build.py` downloads the size/SHA-256 pinned inputs in
`scripts/nim-lsp-assets.lock.json`, builds PMunch/nimlsp with Nim 2.2.4 and Emscripten
6.0.0, and writes `.cache/nim-lsp/browser/`. Linux x86_64, Python 3.10+, curl, Node.js,
a C compiler for the optional native oracle, and enough disk for the SDK are required.
All compilation uses at most two jobs. No global Nimble packages are consulted.

The compiler's original `compiler/`, `nimsuggest/`, `lib/`, `config/`, and all LSP
handlers are preserved. Two checked platform edits select nimlsp's existing synchronous
stdio branch and make the unused asynchronous process-wait adapter report unavailable
subprocesses. The browser uses Nim's official ORC/malloc memory runtime; conservative
mark-and-sweep stack scanning is unsuitable for this WebAssembly build. Native builds
retain upstream's original memory manager and source files.

`--native` builds an unmodified original CLI in `.cache/nim-lsp/original-native/` for
the shared browser parity fixture. `--force`, `--cache-dir`, and `--out-dir` are available.
Producer outputs carry their own receipts and a source/recipe identity. Input archives
are verified before extraction; browser snapshots are generated from the pinned source.

For local builds an already installed, read-only Emscripten 6.0.0 SDK can be supplied
as `WASM_IDLE_NIM_LSP_EMSDK_UPSTREAM`. Without that override the pinned official release
archive is downloaded and verified. Mutable Emscripten configuration and caches stay
inside this producer's cache directory.

`pnpm run sync:nim-lsp` verifies the producer outputs against the committed logical
and compressed delivery receipts before writing ignored `static/wasm-nim-lsp/`.
Maintainers intentionally updating the pinned producer use
`node scripts/sync-nim-lsp.mjs --update-lock`, review the lock/profile changes, and run
the native/Chromium parity test. The SDK package contains only host code and receipts.

Reproducible builds require Linux, `bubblewrap` (`bwrap`), and enabled unprivileged
user/mount namespaces. Each browser build creates a private mount namespace with the
original verified inputs mounted at `/tmp/nim-lsp-build` and its output at
`/tmp/nim-lsp-output`. The host's filesystem paths and mounts stay unchanged. This
preserves the original compiler's path-sensitive type signature hashing and assertion
filenames while producing identical bytes across different physical checkouts.
No generated C or analyzer logic is rewritten. The asset qualification rebuilds from
independently extracted inputs and compares every compressed and decoded receipt.
