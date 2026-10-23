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
- PostgreSQL runs the original `@postgres-language-server/wasm/lsp` server in its worker. Deploy
  that release's `dist/lsp.js`, `dist/common.js`, `dist/pgls.wasm`, and `wasm/pgls.js` together;
  pass `postgresql.moduleUrl` pointing to `dist/lsp.js`. The SDK does not ship the upstream WASM.
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

## PostgreSQL

The PostgreSQL provider forwards JSON-RPC messages to upstream `LanguageServer.handleMessage`
without replacing its analysis or LSP handlers. Its current browser API provides full document
sync, syntax/lint diagnostics, schema completion, and hover. It does not advertise definition,
rename, or formatting support. The browser server cannot connect directly to PostgreSQL/PGlite.

```ts
import { getPostgresqlLanguageServer } from '@wasm-idle/lsp/postgresql';

const server = await getPostgresqlLanguageServer({
	postgresql: { moduleUrl: 'https://cdn.example.com/pgls/dist/lsp.js' }
});
// Connect server.transport to your editor's LSP client as usual.
// Optional: JSON produced by `postgres-language-server schema-export`.
await server.setSchema(await fetch('/schema.json').then((response) => response.text()));
// Updating or clearing a schema republishes diagnostics for open documents upstream.
await server.setSchema(null);
server.dispose();
```

An initial snapshot can also be supplied as `postgresql.schema`. The provider registry accepts
`postgresql`, `postgres`, and `pgsql`. `rootUrl` uses the layout
`<rootUrl>/wasm-postgresql-lsp/dist/lsp.js`.

In this repository, `pnpm sync:postgresql-lsp` prepares the pinned upstream 0.28.2 release and
license with size/SHA-256 verification. Generated assets stay outside Git and the SDK tarball.
The Pages build runs that preparation through `sync:page-runtimes` before its existing static
compression and asset-lock steps. The playground starts the provider only when PostgreSQL is
selected and LSP is enabled. Schema snapshots are available through the SDK; the playground does
not infer a database schema by executing the editor's SQL.

## Bash (original language server)

The Bash provider runs the original `bash-language-server@5.8.1` analyzer and LSP handlers with
its bundled Tree-sitter Bash grammar. Browser adapters supply JSON-RPC transport and a virtual
filesystem; the provider does not implement a second Bash analyzer.

```ts
import { getBashLanguageServer } from '@wasm-idle/lsp/bash';

const bash = await getBashLanguageServer({
	bash: {
		moduleUrl: 'https://cdn.example.com/wasm-bash-lsp/runtime.mjs',
		files: { 'lib.sh': 'greet() { printf "hello\\n"; }\n' }
	}
});
// Connect bash.transport to an LSP client, using file:///workspace as its root URI.
// Dispose when switching languages or closing the editor.
bash.dispose();
```

`getEditorLanguageServer('bash' | 'shell' | 'sh', options)` uses the same provider. An explicit
`rootUrl` resolves `wasm-bash-lsp/runtime.mjs` beneath that root. `bash.files` is a snapshot of
UTF-8 workspace text files, with paths relative to `/workspace`; recreate the server to update
closed files. Open documents are synchronized through the original LSP document manager.

Run `pnpm run sync:bash-lsp` to reproduce the external bundle from the frozen, isolated producer
lockfile. `pnpm run test:lsp:assets:bash` prepares that producer and checks reproducibility.
Deploy the whole `static/wasm-bash-lsp/` directory together, including all three Wasm
binaries and `THIRD_PARTY_NOTICES.txt`. These assets are excluded from Git and the SDK tarball.

Completion, hover, definitions, references, rename, document/workspace symbols and unresolved
`source` information diagnostics use upstream behavior. ShellCheck, shfmt and explainshell are
disabled: this browser profile provides no ShellCheck syntax/lint diagnostics, formatting or
external-command metadata. See [the build and validation notes](../../docs/performance/bash-lsp.md).
