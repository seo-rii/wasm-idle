# Original Bash language server in the browser

The Bash provider preserves the npm release `bash-language-server@5.8.1` from upstream commit
[`dd90f3d2c10ddce889b456a9ac4a1d0f079a9558`](https://github.com/bash-lsp/bash-language-server/tree/dd90f3d2c10ddce889b456a9ac4a1d0f079a9558).
Its original server, analyzer, parser initialization, language feature handlers and document
manager are bundled unchanged. The distributed grammar is Tree-sitter Bash commit
`a06c2e4415e9bc0346c6b86d401879ffb44058f7`, parser ABI 15, paired with the release's
`web-tree-sitter@0.27.0` runtime.

## Platform boundary

The adapter replaces native stdio with the original VS Code browser JSON-RPC transport and
provides a Node-compatible virtual filesystem for supplied workspace text files. Original
fast-glob discovery and source resolution run against that filesystem. Open LSP document
contents are mirrored before upstream analysis; closed files come from the immutable startup
snapshot. SDK hosts use `file:///workspace` as the root URI and relative `bash.files` paths.
The playground snapshots other text files and restarts its worker when those files change.

Node path, streams, URL, Buffer, process scheduling and utility compatibility use pinned browser
polyfills. Narrow filesystem, OS and child-process adapters describe the browser environment.
The original editorconfig dependency and its real INI Wasm are preserved. No replacement Bash
parser, completion engine or diagnostic rule is implemented.

ShellCheck, shfmt and explainshell cannot run in this profile. Their configuration is forced off
at initialization and later configuration boundaries. The advertised formatting capability is
false. Without ShellCheck, upstream does not publish general Bash syntax/lint diagnostics;
this provider enables upstream's optional unresolved-source information diagnostics. External
executable discovery sees an empty `/bin`, so executable-specific metadata is unavailable.

## Reproduce and deploy

```sh
pnpm run sync:bash-lsp
pnpm run test:lsp:browser:bash
node --test scripts/sync-bash-lsp.test.mjs
```

The isolated producer in `producers/bash-language-server` pins all npm dependency versions and
integrities in its own lockfile. `scripts/bash-lsp-assets.lock.json` additionally verifies the
original server/analyzer/parser/grammar bytes and both original licenses. The producer bundles
only browser transport/platform substitutions with esbuild and writes:

| External asset            | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `runtime.mjs`             | Original server and JavaScript dependencies, about 746 KB |
| `tree-sitter-bash.wasm`   | Original release grammar, 1,358,679 bytes                 |
| `web-tree-sitter.wasm`    | Matching upstream parser runtime, 209,613 bytes           |
| `one_ini_bg.wasm`         | Original editorconfig INI parser, 89,224 bytes            |
| `THIRD_PARTY_NOTICES.txt` | Licenses for bundled dependencies and grammar             |
| `runtime-manifest.json`   | Upstream identity and SHA-256/size receipts               |

The total is about 2.5 MB before HTTP compression, within the optional 4 MB static asset budget.
Deploy the complete generated `static/wasm-bash-lsp/` tree alongside the page. The page runtime
sync command prepares it automatically. The SDK tarball contains only the small client/worker
host, and imports request no server or parser assets until the Bash LSP is enabled. An explicit
module URL or deployment root is required; initialization failures propagate to the normal LSP
error state. Worker disposal terminates all original parser state and background discovery.

## Validation

The Chromium test starts the pinned original native CLI over stdio, then runs the same protocol
fixture against the real browser worker. It compares results after normalizing only workspace
paths and the intentionally disabled formatting capability. The fixture exercises unresolved
source diagnostics, clearing diagnostics after edits, completion, hover, cross-file definition,
references, rename, document symbols, close diagnostics and shutdown. No mock language engine
or precomputed responses participate in this comparison.

Focused SDK tests cover startup failures, cancellation, disposal, arbitrary JSON-RPC forwarding
and virtual filesystem behavior. The producer test builds twice and checks matching receipts.
The Monaco browser matrix has a Bash case that checks lazy loading, real information markers
and marker clearing after the source statement is corrected.
