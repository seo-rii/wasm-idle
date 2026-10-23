# PHP language server

The PHP editor runs the unmodified [PHPantom 0.11.1 WASI reactor](https://github.com/PHPantom-dev/phpantom_lsp/blob/0.11.1/docs/wasm.md)
in a dedicated Web Worker. Its Rust parser, type engine, embedded phpstorm-stubs and
JSON-RPC dispatcher are all upstream code. The host only supplies WASI and copies
JSON between Worker messages and the reactor's `lsp_alloc`/`lsp_handle` ABI.
The release omits the optional `_initialize` export; WASI initialization supports
this without changing the upstream module.

Supported upstream requests are completion, completion resolve, hover, definition,
document highlight, rename and signature help. Full-text `didOpen`, `didChange`
and `didClose` go directly to the original dispatcher. The Worker and all its
document state are discarded when LSP is disabled or the editor changes language.

The upstream WASM dispatcher does **not** publish diagnostics or index Composer
projects from disk. The existing PHP execution engine still reports its compiler
errors after running a program. The editor does not advertise PHP LSP diagnostics.

## Prepare assets

```sh
pnpm sync:phpantom-lsp
```

The preparer checks the upstream archive, extracted module and MIT license
against `scripts/phpantom-lsp-assets.lock.json`, checks reactor exports, and writes
`static/wasm-phpantom-lsp/`. These generated assets are not committed. Preparation must
run before serving or building the playground. Browser downloads are verified
against the SDK's pinned module receipt before creating a Worker; the existing
persistent asset cache can reuse verified bytes. Nothing is fetched until PHP LSP
is enabled.

SDK consumers can use `getPhpLanguageServer({ rootUrl, currentUrl })` from
`@wasm-idle/lsp/php`, or configure `php.wasmUrl` explicitly. A custom build must
also supply `php.wasmReceipt` with its SHA-256 and byte count.

## Verify real upstream behavior

```sh
pnpm --dir packages/core build
pnpm --dir packages/llvm-core build
pnpm --dir packages/lsp build
pnpm test:lsp:browser:php
```

The opt-in Chromium test builds the actual SDK client and Worker, loads the pinned
upstream WASM, asserts real semantic results and edit handling, and compares
completion, hover and definition against the native PHPantom **same-version**
Linux x86-64 release. It also checks integrity failure, abort, Worker disposal and
fresh-session isolation. It downloads and verifies both upstream artifacts when
needed. It requires Linux x86-64 for the native comparison; it does not substitute
a mock server on other platforms.
