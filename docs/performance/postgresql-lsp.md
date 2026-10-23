# Original PostgreSQL language server in the browser

The provider uses `@postgres-language-server/wasm` **0.28.2**, released from upstream revision
`5c2f5d7140b7a9c99654f889c58b49f2d692ad77`. The JavaScript glue, WebAssembly module, parser,
linting, completion, hover, document state, and JSON-RPC handlers are upstream files. The SDK worker
only loads the server, reports startup, and relays each returned message with `postMessage`.
It deliberately does not use the repository's SQLite/DuckDB service or `WorkerLanguageService`.

## Assets and deployment

Run `pnpm sync:postgresql-lsp`. `scripts/postgresql-lsp-assets.lock.json` pins every served file's
decoded size and SHA-256. The sync script downloads original npm release files from a versioned
CDN URL and the MIT license from the matching source revision. Existing local assets are reused
only after receipt verification. These generated files live under ignored
`static/wasm-postgresql-lsp/` and are included by the Pages preparation path; no deployment or
infrastructure changes are needed to prepare them locally.

The browser entry is `dist/lsp.js`, which imports `dist/common.js`. The original common loader
imports `wasm/pgls.js` and locates `dist/pgls.wasm` next to itself. Preserve that directory layout.
The upstream WASM is 14,459,953 bytes before the website's existing gzip compression.

## Features and limitations

The upstream `initialize` response advertises full document sync (`textDocumentSync: 1`), completion,
and hover. Opening/changing documents publishes syntax and lint diagnostics. No custom capability
list or SQL parser is maintained here. Definition, rename, and formatting are absent from this
upstream LSP API and remain absent from the provider's capabilities.

Schema-aware completion and hover require an upstream `SchemaCache` JSON snapshot, produced by
`postgres-language-server schema-export`. Supply it through `postgresql.schema`,
`handle.setSchema(json)`, or a raw `pgls/setSchema` notification. `setSchema(null)` forwards
`pgls/clearSchema`. The upstream browser server cannot open database connections. The playground
does not run arbitrary SQL to infer schema, so its initial diagnostics work without a snapshot.
PGlite execution and the language-server worker have independent lifetimes and state.

## Verification

```sh
pnpm --dir packages/lsp build
pnpm --dir packages/lsp exec vitest run test/postgresql.test.ts test/registry.test.ts
pnpm test:lsp:browser:postgresql
WASM_IDLE_RUN_REAL_BROWSER_LSP=1 WASM_IDLE_LSP_BROWSER_LANGUAGES=POSTGRESQL pnpm exec vitest run src/routes/monaco-lsp.playwright.test.ts
```

The required Chromium test loads the actual synced upstream files under a CSP permitting
WebAssembly and same-origin scripts only. It checks that importing the SDK does not download the
server, verifies upstream capabilities, opens invalid SQL, changes it to valid SQL and observes
diagnostics clear, supplies a real schema snapshot, verifies table completion and column hover,
clears the snapshot, closes documents, shuts down, and disposes the worker. The shared Monaco
matrix also covers the user-facing LSP toggle, lazy requests, startup status, and error markers.
The focused unit tests cover cancellation, module failure cleanup, message ordering across
startup, repeated disposal, and forwarding of upstream extensions without a method whitelist.

The Monaco page was verified against its production bundle. The current repository's Vite dev
server returns 404 for package worker entry URLs for both this provider and the existing GraphQL
provider. That shared development-server behavior is separate from the upstream server and was
not changed here; use the production preview for page verification.

Upstream references:

- [Browser LSP API](https://pg-language-server.com/main/guides/browser/)
- [Pinned release source](https://github.com/supabase-community/postgres-language-server/tree/5c2f5d7140b7a9c99654f889c58b49f2d692ad77/packages/%40postgres-language-server/wasm)
