# V language server

The editor runs the original [vlang/v-analyzer 0.0.6](https://github.com/vlang/v-analyzer/tree/925d4570d1668746762a2cdf0ecb9a25be704a67)
in an Emscripten Worker. Its Tree-sitter grammar, parser, type inference, method
dispatcher and semantic handlers remain upstream. Completion, hover, navigation,
references, rename, signatures, symbols, highlights, semantic tokens, inlay hints,
folding, code lenses and code actions come from that engine.

Native compiler diagnostics and formatting require an external V process and are
disabled in this browser profile. Formatting is not advertised. The existing V
Run action and compiler diagnostics continue to use the separate execution
runtime. No V analysis is implemented in JavaScript.

The original V 0.5.1 library sources that upstream indexes are mounted in the
Worker's filesystem, alongside opened editor documents. Document creation events
go to upstream's existing filesystem watcher handler. This profile cannot access
the user's disk or installed modules. It retains upstream's feature behavior,
including its workspace-symbol filtering and document lifecycle behavior.

The patch adds an in-memory stdio stream and serializes upstream indexing tasks
inside the Worker. Per-root progress callbacks use the browser path without
native machine-code closures. V's bundled BDWGC remains active: startup and
requests await Asyncify, and static roots are registered explicitly. The 64 KiB
global base respects V's existing null-page checks. The compiler's generated C
is checked for unsupported captured closure calls before linking.
The producer also replaces V's path-dependent embedded-file lookup keys with
deterministic identifiers, preserving the embedded bytes and their lookup links.

```sh
pnpm sync:v-lsp
pnpm --dir packages/lsp build
pnpm test:lsp:browser:v
```

The Linux x64 producer pins the server, Tree-sitter submodule, official V 0.5.1
compiler archive, Emscripten 6.0.0 binaries and transport patch by SHA-256. This V
version compiles the original analyzer without source compatibility changes.
Downloads and intermediate outputs stay in the ignored local cache; builds use
at most two jobs. Generated assets, provenance and license notices go to the
ignored `static/wasm-v-lsp/` directory. The normal page pipeline prepares them.

SDK consumers import `getVLanguageServer` from `@wasm-idle/lsp/v` and provide
`rootUrl` or `v.baseUrl`. Custom distributions provide all three `v.integrity`
receipts. The loader, WASM and compressed library are verified before creating a
Worker. Startup cancellation, timeout, persistent caching and idempotent disposal
follow the shared provider contract. Assets load when the V LSP switch is enabled.

The opt-in Chromium test compares real semantic replies against the unpatched
native server under a strict CSP, and checks cross-file navigation, edits with
real GC, original library navigation, early requests/cancellation, isolation,
integrity and disposal. The production Monaco matrix verifies a real hover.
