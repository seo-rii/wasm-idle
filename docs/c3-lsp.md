# C3 language server

The editor runs the original [tonis2/lsp 0.4.0](https://github.com/tonis2/lsp/tree/466764b2fe4faf3818cf5fe230228b8a651e28ca)
in a dedicated Emscripten Worker. The original method dispatcher, semantic handlers,
tokenizer and dependency lexer are preserved. A small source patch replaces stdio
with an allocation ABI, adds the Emscripten build target, and excludes native
subprocess entry points. No language analysis is implemented in JavaScript.

Completion, hover, definition/declaration, references, rename, signatures, symbols,
document highlights, semantic tokens, folding, call hierarchy and code actions are
handled by upstream. Original lexer diagnostics update while typing. Compiler
errors and warnings require a native subprocess and are unavailable in this LSP
profile. The existing C3 Run action still reports real compiler diagnostics.

The original C3 0.8.3 standard library is mounted in the Worker's virtual filesystem.
The server sees documents opened by its client and that standard library; it has no
access to the user's disk or project.json files. Runtime-specific byte ABI imports
remain the responsibility of the existing execution profile.

```sh
pnpm sync:c3-lsp
pnpm --dir packages/lsp build
pnpm test:lsp:browser:c3
```

The Linux x64 source producer pins the server, its two submodules, official static
C3 compiler 0.8.3, and Emscripten 6.0.0 binaries by SHA-256. It verifies the transport
patch and every resulting asset against the qualified receipts. Downloads, sources,
toolchains and intermediate files stay in the ignored worktree-local cache; builds
use at most two compiler jobs. It does not install or modify system toolchains.

Generated assets, provenance and upstream license notices are written to the ignored
`static/wasm-c3-lsp/` directory. The page build prepares them, and the existing
compression, runtime lock and asset budget pipeline recognizes the directory.
The SDK verifies the loader, WASM and standard library before creating a Worker.
Assets load only after the C3 LSP switch is enabled.

SDK consumers import `getC3LanguageServer` from `@wasm-idle/lsp/c3` and provide
`rootUrl` or `c3.baseUrl`. A custom distribution supplies `c3.integrity` for all
three assets. Abort, startup timeout, persistent verified caching and idempotent
disposal follow the shared provider contract.

The opt-in Chromium suite runs the actual reactor under a strict CSP and compares
semantic responses and lexer diagnostics against the unpatched native server.
It covers edits, cross-file navigation, diagnostic clearing, standard-library
loading, early requests before didOpen, close, session isolation, integrity and
abort. The production playground matrix checks an original lexer diagnostic.
