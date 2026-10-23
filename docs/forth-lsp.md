# Forth language server

The editor runs [forth-lsp 0.9.0](https://github.com/alexanderbrevig/forth-lsp/tree/cbb3df83efd683d2c40693731c23e27efb05f451)
in a dedicated WASI Web Worker. All upstream lexer, parser, dictionary, formatting,
diagnostic and request-handler files are unchanged.

The source patch extracts the original synchronous main-loop state and dispatch
into a reusable object. A WASI reactor replaces the native stdio threads with an
in-memory `lsp-server` connection and drains its outgoing messages, including
the original diagnostics. The browser host copies JSON through an allocation ABI.
The transport also releases buffers and indices on close, handles shutdown and
returns JSON-RPC errors for unsupported requests.
The Worker briefly queues document requests that Monaco sends before `didOpen`,
then forwards them to the original handlers after the buffer has been opened.

Available features include completion, hover, definition, references, rename,
signature help, document/workspace symbols, semantic tokens, formatting, code
actions and diagnostics. The browser indexes documents opened by its client; it
does not have access to the user's disk or `.forth-lsp.toml` files. Its built-in
dictionary is the original Forth dictionary, so it can report WAForth-specific
extensions as undefined words.

## Prepare assets

```sh
pnpm sync:forth-lsp
```

The producer downloads the pinned source archive, verifies its SHA-256 and
`Cargo.lock`, applies the checked-in transport patch, builds with Rust 1.94.0 and
`--locked`, and verifies the resulting module against the qualified receipt.
It installs the minimal pinned Rust toolchain and WASI standard library when
needed. Project, registry and sysroot paths are remapped for reproducibility.
Each physical source copy has its own Cargo target and intermediate directory.

Generated assets and upstream MIT license are written to `static/wasm-forth-lsp/`
and are not committed. The existing compression, runtime-lock and size-budget
pipeline recognizes this directory. `page:build` prepares the assets before
building the website. Browser downloads are hash-verified before starting a
Worker, and can reuse the persistent verified-asset cache.

SDK consumers import `getForthLanguageServer` from `@wasm-idle/lsp/forth`, providing
`rootUrl` or `forth.wasmUrl`. Custom modules require their own `forth.wasmReceipt`.
The module is only requested when Forth LSP is enabled.

## Verify original behavior

```sh
pnpm --dir packages/core build
pnpm --dir packages/llvm-core build
pnpm --dir packages/lsp build
pnpm test:lsp:browser:forth
```

The opt-in Chromium test builds the original, unpatched native server separately
and compares real browser diagnostics and semantic responses with that server.
It covers cross-file definition, edits, diagnostic removal, symbols, formatting,
semantic tokens, session isolation, close, abort, integrity rejection and disposal.
The production playground matrix includes a Forth undefined-word diagnostic case.
