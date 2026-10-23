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

For browser hosts using TypeScript, JavaScript, WAT, or document-language workers, use the
client-only entry points so the language engine is bundled only into its worker:

```ts
import { getTypeScriptLanguageServer } from '@wasm-idle/lsp/typescript/client';
import { getWatLanguageServer } from '@wasm-idle/lsp/wat/client';
import { getJsonLanguageServer } from '@wasm-idle/lsp/document/client';
```

`@wasm-idle/lsp/javascript/client` is also available. The original provider entry points remain
available, including their `create*WorkerService` exports for custom worker hosts.

## Nim (original nimlsp and embedded nimsuggest)

`@wasm-idle/lsp/nim` runs PMunch/nimlsp with the original Nim 2.2.4 compiler/nimsuggest
in a WebAssembly worker. Build/deploy `static/wasm-nim-lsp/` with `pnpm run sync:nim-lsp`.

```ts
import { getNimLanguageServer } from '@wasm-idle/lsp/nim';

const nim = await getNimLanguageServer({
	nim: {
		baseUrl: 'https://cdn.example.com/wasm-nim-lsp/',
		workspaceFiles: [{ path: 'helpers.nim', content: 'proc square*(n: int): int = n * n\n' }]
	}
});
// Connect nim.transport to an LSP client rooted at file:///workspace.
// Original nimlsp computes diagnostics on textDocument/didSave.
nim.dispose();
```

An explicit `rootUrl` resolves `wasm-nim-lsp/` under that root. Cross-origin isolation
and `SharedArrayBuffer` are required. Opened/saved editor documents are mirrored into
an in-memory project; recreate the provider when other workspace snapshots change.
`nim.autoSave: true` additionally sends standard `didSave` after `didOpen` and full
`didChange` notifications for autosaving hosts; the default preserves the client's
original notification stream. The Playground enables this option and normalizes Monaco's
ranged edit events to the original server's Full sync contract using the actual editor snapshot.

Diagnostics, completion, hover, definition, references, rename, signature help and
symbols use the original handlers. External Nimble/other subprocesses are unavailable;
include dependency source in `workspaceFiles`. See the [build and validation notes](../../docs/performance/nim-lsp.md).
