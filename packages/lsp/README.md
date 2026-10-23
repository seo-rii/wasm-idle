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
- V runs the original v-analyzer in a Worker. Import `getVLanguageServer` from
  `@wasm-idle/lsp/v` and supply `rootUrl` or `v.baseUrl`; custom assets require all three
  `v.integrity` receipts. Compiler diagnostics and formatting require an external V process and
  are disabled in this profile. See [the producer and browser profile](../../docs/v-lsp.md).
- Java uses upstream javacs and the OpenJDK compiler compiled with TeaVM, in a dedicated worker.
  Deploy the verified producer assets separately and pass `java.baseUrl`; `rootUrl` resolves them
  under `wasm-java-lsp/`. The Java execution runtime has a separate asset configuration.
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

No WASM modules, compressed standard libraries, compiler archives, or runtime-engine worker assets are included in
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

## COBOL (SuperBOL Studio OSS)

`@wasm-idle/lsp/cobol` runs the original SuperBOL Studio OSS 0.3.0 parser and LSP handlers in a
browser worker. Prepare/deploy `static/wasm-cobol-lsp/` with `pnpm run sync:cobol-lsp`.

```ts
import { getCobolLanguageServer } from '@wasm-idle/lsp/cobol';

const cobol = await getCobolLanguageServer({
	cobol: {
		baseUrl: 'https://cdn.example.com/wasm-cobol-lsp/',
		workspaceFiles: [{ path: 'greeting.cpy', content: '       01 GREETING PIC X(5).\n' }]
	}
});
// Connect cobol.transport to an LSP client rooted at file:///workspace.
cobol.dispose();
```

The provider aliases are `cobol`, `cob` and `cbl`. An explicit `rootUrl` resolves `wasm-cobol-lsp/`
under that root. Cross-origin isolation and `SharedArrayBuffer` are required. Workspace files
are read-only snapshots; recreate the provider when closed files change.

The default dialect stays GnuCOBOL-compatible. Upstream 0.3.0 publishes diagnostics for an
explicit `cobol85` project (`superbol.toml`); its other dialects retain upstream's diagnostic
restriction. Completion, hover, copybook navigation, references, paragraph rename and symbols
use the original handlers. This release's optional persistent cache prevents reliable graceful
protocol shutdown; call `dispose()` to terminate the worker. See the [platform, license and
validation notes](../../docs/performance/cobol-lsp.md).

ReScript uses the original server, ReScript 12.3.1 compiler and matching editor analysis.
Pass `rescript.workspaceFiles` with the initial `.res`/`.resi` files; use root URI
`file:///workspace`. The verified browser profile supports plain projects and the standard
library. Run `pnpm run sync:rescript-lsp` and deploy `wasm-rescript-lsp/` separately.
See [the source pins, project limits and reproduction steps](../../docs/performance/rescript-lsp.md).

## Lean 4

`getLean4LanguageServer` from `@wasm-idle/lsp/lean4` hosts the unchanged upstream Lean 4.34.1 server.
The original watchdog supplies initialize capabilities; browser workers run its original
FileWorker handlers because native subprocess spawning is unavailable. The `Init` profile supports
one active document per handle, completion, hover, local definitions, semantic features and type
error diagnostics. Lake/package builds and watchdog project-wide operations are unavailable.

Provide `rootUrl` (assets under `wasm-lean4/`) or `lean4.baseUrl` pointing to the pinned distribution
prepared by `sync:wasm-lean4`. The first payload is about 143 MB and shares the execution asset
cache. This provider requires cross-origin isolation, SharedArrayBuffer, nested module workers,
and WebAssembly exceptions; Chromium is tested. It preallocates a bounded 64-thread pthread pool
and defaults to a 1 GiB Wasm ceiling per document. See [the host and profile details](../../docs/lean4.md#original-language-server).

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
## Java

```ts
import { getJavaLanguageServer } from '@wasm-idle/lsp/java';

const java = await getJavaLanguageServer({
	java: {
		baseUrl: 'https://cdn.example.com/wasm-java-lsp/',
		initialFiles: {
			'file:///workspace/Main.java': 'class Main { int answer = 42; }'
		}
	},
	signal: startupAbortController.signal
});
// Attach java.transport to the editor's JSON-RPC client, initialize at file:///workspace,
// then send the normal didOpen/didChange notifications. Upstream uses incremental edits.
// Stop the server and release its compiler, filesystem, and static state:
java.dispose();
```

`initialFiles` provides the original source text before initialize scans the workspace. Use local
file URIs under `file:///workspace/`; Java filenames are case sensitive. The total source snapshot
is limited to 16 MiB. Each server owns a worker and compiler instance. `signal` cancels startup;
`startupTimeoutMs` bounds startup; `dispose()` terminates the worker and is idempotent.

The worker verifies the loader, Wasm, and JDK API archive against pinned size/SHA-256 receipts before
executing them and reuses the shared verified asset cache. `persistentCache: false` disables that
cache. Custom builds can supply a complete `java.assets` receipt array. The browser profile supports
plain Java source projects with its shipped JDK APIs; it does not run Maven/Gradle or download
dependencies. See [producer and acceptance details](../../docs/performance/java-javacs-teavm-browser.md).

`pnpm run build:java-lsp` builds the pinned original server and compiler;
`pnpm run sync:java-lsp` verifies and copies their assets into `static/wasm-java-lsp/`.
The existing page build runs both before static asset compression and locking. The npm SDK
includes the Java host code and receipts; runtime binaries are prepared separately.
