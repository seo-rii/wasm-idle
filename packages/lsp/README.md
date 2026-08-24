# @wasm-idle/lsp

Framework-neutral browser language-server hosts for wasm-idle. The npm package contains code only.
Language tools and standard-library data must be deployed separately and passed as HTTP(S) URLs.

## Installation

`@wasm-idle/lsp` is an optional editor plugin and is not a dependency of the root `wasm-idle`
package. Installing `wasm-idle` does not install this package transitively; applications that want
editor LSP support must install it explicitly:

```bash
pnpm add @wasm-idle/lsp
```

In particular:

- TypeScript and JavaScript require `typescript.libUrl` or `javascript.libUrl` unless the host
  supplies `libFiles` directly.
- AssemblyScript, SQLite, and DuckDB load page-owned runtime modules from their respective
  `moduleUrl` option. The modules provide the package glue and default WASM or worker asset URLs.
  Hosts may still override `sql.wasmUrl` or `sql.duckdbBundles`.
- Ruby requires one complete runtime profile: identity, manifest/module/Wasm receipts, and canonical
  URLs. The page host verifies and transfers all three assets before its worker starts; incomplete
  URL-only overrides fail closed.
- Python and R load their externally deployed Pyodide and WebR trees from `python.baseUrl` and
  `r.baseUrl`.
- Clangd and other compiler-backed language servers use their corresponding runtime asset config.

Clangd and Python deliberately have no document-relative fallback. Supply their individual asset
configuration or one explicit deployment root before creating the provider:

```ts
import { getEditorLanguageServer } from '@wasm-idle/lsp';

const python = await getEditorLanguageServer('python', {
	rootUrl: 'https://cdn.example.com/wasm-idle'
});
```

Missing Clangd or Python asset configuration fails with
`LanguageServerAssetConfigurationError` before a worker starts or an asset request is issued.

No WASM modules, compressed standard libraries, compiler archives, or worker assets are included in
the package tarball.

Pure JavaScript provider engines are optional peer dependencies. Install only the providers used by
the application: `typescript` for TypeScript/JavaScript, `graphql` for GraphQL, `wabt` for WAT, and
the corresponding VS Code language-service packages for document languages. Importing
`@wasm-idle/lsp` does not load these providers; the selected provider is imported when its language
server is initialized. The wasm-idle Pages app keeps `@wasm-idle/lsp` as a dev dependency and
dynamically imports each provider only after LSP is enabled and its language is selected, so
provider chunks are not downloaded before they are needed.
